import "server-only";
import { redirect } from "next/navigation";
import type { OwnerAssurance, VerifiedUser } from "./decide";
import { safeNextPath } from "./decide";
import { createSupabaseServerClient } from "./supabase";

export interface AuthUser extends VerifiedUser {
  email: string | null;
}

/**
 * The signed-in user, verified with the Supabase Auth server (getUser), or
 * null. Never trusts an unverified cookie session.
 */
export async function getOptionalUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
  };
}

/**
 * The signed-in user plus their authenticator assurance: factors from the Auth
 * server (getUser) and the session's `aal` from a signature-verified JWT
 * (getClaims). Returns nulls when signed out or unverifiable.
 */
export async function getUserWithAssurance(): Promise<{ user: AuthUser | null; assurance: OwnerAssurance | null }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { user: null, assurance: null };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { user: null, assurance: null };
  const user: AuthUser = {
    id: data.user.id,
    email: data.user.email ?? null,
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
  };
  const claims = await supabase.auth.getClaims();
  if (claims.error || !claims.data || claims.data.claims.sub !== user.id) return { user, assurance: null };
  const verifiedFactors = (data.user.factors ?? []).filter((f) => f.status === "verified" && f.factor_type === "totp").length;
  return { user, assurance: { aal: typeof claims.data.claims.aal === "string" ? claims.data.claims.aal : null, verifiedFactors } };
}

/** Redirects to /login when signed out. Use at the top of customer pages and actions. */
export async function requireUser(next = "/dashboard"): Promise<AuthUser> {
  const user = await getOptionalUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`);
  return user;
}
