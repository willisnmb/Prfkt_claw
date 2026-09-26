import "server-only";
import { redirect } from "next/navigation";
import { isSupabaseAuthConfigured, serverEnv } from "../env";
import { decideOwnerAccess } from "./decide";
import { getUserWithAssurance } from "./user";
import { recordSystemEvent } from "../data/system-events";

export interface OwnerPrincipal {
  userId: string;
  email: string;
}

/**
 * Server-side owner authorization (SECURITY.md → Admin). Every admin layout,
 * page and server action calls this first. Requirements, evaluated on every
 * request so revocation is immediate:
 *   1. Supabase is configured (fails closed otherwise),
 *   2. a session verified by the Auth server (auth.getUser()),
 *   3. a confirmed email,
 *   4. that email is listed in ADMIN_EMAILS,
 *   5. a verified TOTP factor, used in this session (AAL2).
 * There is no query-string key, cookie flag, header or client-side switch.
 */
export async function requireOwner(): Promise<OwnerPrincipal> {
  const env = serverEnv();
  if (!isSupabaseAuthConfigured(env)) redirect("/login?next=/admin");
  const { user, assurance } = await getUserWithAssurance();
  const decision = decideOwnerAccess(user, env.ADMIN_EMAILS, assurance);
  if (decision.allowed) return decision.principal;
  if (decision.reason === "unauthenticated") redirect("/login?next=/admin");
  // A listed owner who has not completed MFA is sent to enrol or verify, not logged as a denial.
  if (decision.reason === "mfa-enrollment-required" || decision.reason === "mfa-challenge-required") redirect("/login/mfa?next=/admin");
  await recordSystemEvent({
    kind: "admin.access_denied",
    severity: "warning",
    message: `Owner access denied (${decision.reason})`,
    detail: { userId: user?.id ?? null, reason: decision.reason },
  });
  redirect("/login?next=/admin&error=not-authorized");
}
