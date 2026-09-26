import { describe, expect } from "vitest";
import { redclaw } from "./redclaw";
import { checkOutboundUrl, guardedFetch, isPrivateAddress, NetworkViolation, type Resolver } from "@/security/ssrf";

const dns: Record<string, string[]> = {
  "api.partner.test": ["93.184.216.34"],
  "rebind.partner.test": ["10.0.0.5"],
  "mixed.partner.test": ["93.184.216.34", "127.0.0.1"],
  "v6.partner.test": ["::ffff:169.254.169.254"],
};
const resolver: Resolver = async (h) => dns[h] ?? [];
const policy = { allowedHosts: ["api.partner.test", "rebind.partner.test", "mixed.partner.test", "v6.partner.test", "*.partner.test"], resolver };

describe("SSRF", () => {
  redclaw("ssrf", "metadata, loopback, private and IP-literal URLs are rejected", async () => {
    for (const u of [
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://0x7f000001/",
      "https://0177.0.0.1/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "http://api.partner.test/",
      "https://user:pass@api.partner.test/",
      "https://api.partner.test:8443/",
      "file:///etc/passwd",
      "gopher://api.partner.test/",
    ]) {
      await expect(checkOutboundUrl(u, policy), u).rejects.toThrow(NetworkViolation);
    }
  });

  redclaw("ssrf", "allowlisted hosts that resolve to private addresses are rejected", async () => {
    await expect(checkOutboundUrl("https://rebind.partner.test/x", policy)).rejects.toThrow(/private/);
    await expect(checkOutboundUrl("https://mixed.partner.test/x", policy)).rejects.toThrow(/private/);
    await expect(checkOutboundUrl("https://v6.partner.test/x", policy)).rejects.toThrow(/private/);
    await expect(checkOutboundUrl("https://evil.test/x", policy)).rejects.toThrow(/allowlisted/);
    await expect(checkOutboundUrl("https://api.partner.test/ok", policy)).resolves.toBeInstanceOf(URL);
  });

  redclaw("ssrf", "redirects to internal targets are re-checked and blocked", async () => {
    const fetchImpl = (async (url: URL | string) => {
      const u = String(url);
      if (u.startsWith("https://api.partner.test/")) return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } });
      return new Response("should not reach");
    }) as typeof fetch;
    await expect(guardedFetch("https://api.partner.test/start", { ...policy, fetchImpl })).rejects.toThrow(NetworkViolation);
  });

  redclaw("ssrf", "private-range classifier covers v4 and v6 reserved space", () => {
    for (const ip of ["10.1.2.3", "172.31.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "fd00::1", "fe80::1", "::1", "::ffff:7f00:1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
