"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/server/auth/decide";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured, serverEnv } from "@/server/env";
import { clientIpFromHeaders, hitRateLimit } from "@/server/rate-limit";

export type SignInState = { status: "idle" } | { status: "sent" } | { status: "error"; message: string };

const SignInInput = z.object({
  email: z.email().max(254),
  next: z.string().max(500).optional(),
});

const SIGN_IN_LIMIT = { scope: "signin:ip", windowSeconds: 900, max: 10 } as const;

/**
 * Passwordless sign-in: Supabase emails a one-time link. The redirect target
 * is built from NEXT_PUBLIC_APP_URL (never the Host header) and `next` is
 * restricted to same-origin paths.
 */
export async function signInWithEmail(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = SignInInput.safeParse({ email: formData.get("email"), next: formData.get("next") ?? undefined });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: "error", message: "Sign-in is not configured in this environment." };

  const env = serverEnv();
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? (env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (!appUrl) return { status: "error", message: "Sign-in is not configured in this environment." };

  if (isDatabaseConfigured()) {
    const ip = clientIpFromHeaders(await headers());
    if (!(await hitRateLimit(getSql(), SIGN_IN_LIMIT, ip))) {
      return { status: "error", message: "Too many sign-in attempts. Please wait a few minutes." };
    }
  }

  const next = safeNextPath(parsed.data.next, "/dashboard");
  const callback = new URL("/auth/callback", appUrl);
  callback.searchParams.set("next", next);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
  });
  if (error) {
    // Do not reveal whether the address exists; log the category only.
    console.error("signInWithOtp failed", error.name);
    if (error.status === 429) return { status: "error", message: "Too many sign-in attempts. Please wait a few minutes." };
  }
  return { status: "sent" };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/");
}
