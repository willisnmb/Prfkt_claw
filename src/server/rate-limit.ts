import "server-only";
import { createHash } from "node:crypto";
import type { Sql } from "./db/sql";

/**
 * Durable fixed-window rate limiting backed by public.rate_limit_buckets
 * (public abuse controls). Keys are hashed so raw IPs/emails are not stored.
 */
export interface RateLimitRule {
  /** Namespaced bucket, e.g. "intake:ip". */
  scope: string;
  windowSeconds: number;
  max: number;
}

export const RATE_LIMITS = {
  intakePerIp: { scope: "intake:ip", windowSeconds: 3600, max: 5 },
  intakePerEmail: { scope: "intake:email", windowSeconds: 86_400, max: 3 },
  configurationPerUser: { scope: "configuration:user", windowSeconds: 3600, max: 30 },
  deploymentRequestPerUser: { scope: "deployment:user", windowSeconds: 3600, max: 10 },
  exportPerUser: { scope: "export:user", windowSeconds: 3600, max: 10 },
} as const satisfies Record<string, RateLimitRule>;

export function rateLimitKey(scope: string, subject: string): string {
  const digest = createHash("sha256").update(subject.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `${scope}:${digest}`;
}

/** Returns true when the call is allowed. Counts the attempt either way. */
export async function hitRateLimit(sql: Sql, rule: RateLimitRule, subject: string): Promise<boolean> {
  const rows = await sql.query<{ allowed: boolean }>("select app.rate_limit_hit($1, $2, $3) as allowed", [
    rateLimitKey(rule.scope, subject),
    rule.windowSeconds,
    rule.max,
  ]);
  return rows[0]?.allowed === true;
}

/**
 * Best-effort client IP from proxy headers. Only meaningful behind a proxy
 * that overwrites X-Forwarded-For (Vercel, Cloudflare, Fly); documented in
 * docs as a deployment assumption.
 */
export function clientIpFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "unknown";
}
