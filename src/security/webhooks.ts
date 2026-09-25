import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inbound webhook signatures: `t=<unix seconds>,v1=<hex hmac-sha256("t.body")>`.
 * Timestamp tolerance blocks replay of old deliveries; event-id dedupe (in the
 * FLOW store) blocks replay within the window.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signWebhook(secret: string, body: string, timestampSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export type WebhookVerification = { ok: true; timestamp: number } | { ok: false; reason: string };

export function verifyWebhook(secret: string | undefined, body: string, header: string | null, nowSeconds = Math.floor(Date.now() / 1000)): WebhookVerification {
  if (!secret) return { ok: false, reason: "webhook secret not configured" };
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, reason: "malformed signature" };
  if (Math.abs(nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature mismatch" };
  return { ok: true, timestamp: t };
}
