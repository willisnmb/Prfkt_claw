/**
 * Pure owner-authorization decision (SECURITY.md → Admin). No I/O, so it can
 * be tested exhaustively. Inputs must come from a server-verified user
 * (supabase.auth.getUser()), never from cookies, headers or query strings.
 */

export interface VerifiedUser {
  id: string;
  email: string | null | undefined;
  /** ISO timestamp from Supabase; absent/empty means unconfirmed. */
  emailConfirmedAt: string | null | undefined;
}

export type OwnerDecision =
  | { allowed: true; principal: { userId: string; email: string } }
  | { allowed: false; reason: "unauthenticated" | "email-unconfirmed" | "no-owners-configured" | "not-owner" };

/** Canonical comparison form: trimmed + lower-cased. No plus-address or dot folding. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAdminEmails(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter((e) => /^[^\s@]+@[^\s@]+$/.test(e));
}

export function decideOwnerAccess(user: VerifiedUser | null | undefined, adminEmails: readonly string[]): OwnerDecision {
  if (!user || !user.id) return { allowed: false, reason: "unauthenticated" };
  if (!user.email || !user.emailConfirmedAt) return { allowed: false, reason: "email-unconfirmed" };
  const owners = new Set(adminEmails.map(normalizeEmail).filter((e) => e.includes("@")));
  if (owners.size === 0) return { allowed: false, reason: "no-owners-configured" };
  const email = normalizeEmail(user.email);
  if (!owners.has(email)) return { allowed: false, reason: "not-owner" };
  return { allowed: true, principal: { userId: user.id, email } };
}

/** Only same-origin relative paths are accepted as post-login destinations (open-redirect guard). */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(next) || next.includes("\\")) return fallback;
  try {
    const u = new URL(next, "http://localhost");
    if (u.origin !== "http://localhost") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
