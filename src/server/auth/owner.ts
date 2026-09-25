import "server-only";
import { redirect } from "next/navigation";

export interface OwnerPrincipal {
  userId: string;
  email: string;
}

/**
 * Server-side owner authorization. CONTRACT STUB — fails closed until the
 * auth slice implements: verified Supabase session (auth.getUser()), confirmed
 * email, email ∈ ADMIN_EMAILS. Call at the top of every admin page/action.
 */
export async function requireOwner(): Promise<OwnerPrincipal> {
  redirect("/login?next=/admin");
}
