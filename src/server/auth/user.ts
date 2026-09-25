import "server-only";
import { redirect } from "next/navigation";
import type { VerifiedUser } from "./decide";
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

/** Redirects to /login when signed out. Use at the top of customer pages and actions. */
export async function requireUser(next = "/dashboard"): Promise<AuthUser> {
  const user = await getOptionalUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`);
  return user;
}
