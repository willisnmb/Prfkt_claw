import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { hostAllowed } from "./blast-radius";

/**
 * Outbound network guard (SSRF). HTTPS only, allowlisted hosts only, no
 * credentials in URLs, and every resolved address must be public. Redirects
 * are followed manually so every hop is re-checked.
 */
export class NetworkViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkViolation";
  }
}

export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (kind === 6) {
    const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? x.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    const hexMapped = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16);
      const lo = parseInt(hexMapped[2]!, 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(x.split(":")[0] || "0", 16);
    return (
      (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 || // fe80::/10 link local
      (first & 0xff00) === 0xff00 || // multicast
      x.startsWith("64:ff9b:") || // NAT64
      x.startsWith("2001:db8:") // documentation
    );
  }
  return true; // not an IP: treat as unsafe
}

export interface OutboundPolicy {
  allowedHosts: readonly string[];
  resolver?: Resolver;
}

export async function checkOutboundUrl(raw: string, policy: OutboundPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetworkViolation("invalid URL");
  }
  if (url.protocol !== "https:") throw new NetworkViolation("only https is allowed");
  if (url.username || url.password) throw new NetworkViolation("credentials in URL are not allowed");
  if (url.port && url.port !== "443") throw new NetworkViolation("non-standard port");
  // WHATWG URL normalises decimal/octal/hex IPv4 forms to dotted quads, so
  // "https://2130706433/" arrives here as 127.0.0.1.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    throw new NetworkViolation("IP-literal hosts are not allowed");
  }
  if (!hostAllowed(host, policy.allowedHosts)) throw new NetworkViolation(`host ${host} is not allowlisted`);
  const addresses = await (policy.resolver ?? systemResolver)(host);
  if (addresses.length === 0) throw new NetworkViolation("host did not resolve");
  if (addresses.some(isPrivateAddress)) throw new NetworkViolation("host resolves to a private or reserved address");
  return url;
}

/**
 * fetch with SSRF checks on every hop. Note: a DNS answer can change between
 * check and connect (rebinding); production egress must also be enforced by
 * the cell's network policy. Tracked in docs/FINDINGS.md.
 */
export async function guardedFetch(
  raw: string,
  policy: OutboundPolicy & { maxRedirects?: number; fetchImpl?: typeof fetch; timeoutMs?: number },
  init: RequestInit = {},
): Promise<Response> {
  const f = policy.fetchImpl ?? fetch;
  let current = raw;
  for (let hop = 0; hop <= (policy.maxRedirects ?? 3); hop++) {
    const url = await checkOutboundUrl(current, policy);
    const res = await f(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(policy.timeoutMs ?? 10_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    return res;
  }
  throw new NetworkViolation("too many redirects");
}
