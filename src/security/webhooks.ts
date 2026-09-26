import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound webhook signatures: `t=<unix seconds>,v1=<hex hmac-sha256("t.body")>`.
 * This is Stripe's `Stripe-Signature` scheme, so the same verifier serves the
 * PRFKT-signed fake providers and Stripe. Several `v1` entries may be present
 * (Stripe sends one per active endpoint secret while a secret is being rolled);
 * any one matching is enough. Other schemes (`v0`) are ignored.
 * Timestamp tolerance blocks replay of old deliveries; event-id dedupe (in the
 * FLOW store) blocks replay within the window.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signWebhook(secret: string, body: string, timestampSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export type WebhookVerification = { ok: true; timestamp: number } | { ok: false; reason: string };

const MAX_SIGNATURES = 8;

function parseSignatureHeader(header: string): { t: number; v1: string[] } {
  let t = Number.NaN;
  const v1: string[] = [];
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i <= 0) continue;
    const key = kv.slice(0, i).trim();
    const value = kv.slice(i + 1).trim();
    if (key === "t" && Number.isNaN(t)) t = /^\d{1,12}$/.test(value) ? Number(value) : Number.NaN;
    else if (key === "v1" && /^[0-9a-f]{64}$/.test(value) && v1.length < MAX_SIGNATURES) v1.push(value);
  }
  return { t, v1 };
}

export function verifyWebhook(secret: string | undefined, body: string, header: string | null, nowSeconds = Math.floor(Date.now() / 1000)): WebhookVerification {
  if (!secret) return { ok: false, reason: "webhook secret not configured" };
  if (!header) return { ok: false, reason: "missing signature" };
  const { t, v1 } = parseSignatureHeader(header);
  if (!Number.isInteger(t) || v1.length === 0) return { ok: false, reason: "malformed signature" };
  if (Math.abs(nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  // Compare against every candidate (no early exit) so timing does not reveal which one matched.
  let matched = false;
  for (const candidate of v1) {
    const given = Buffer.from(candidate, "hex");
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: "signature mismatch" };
  return { ok: true, timestamp: t };
}
