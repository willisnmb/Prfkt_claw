"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "@/server/auth/decide";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured } from "@/server/env";
import { hitRateLimit } from "@/server/rate-limit";

/**
 * TOTP enrolment and verification for the signed-in user (owner MFA, F-002).
 * Everything runs server-side against the user's own cookie session; the
 * Supabase Auth server enforces that a user can only manage their own factors.
 */

export type EnrollState =
  | { status: "idle" }
  | { status: "enrolling"; factorId: string; qrCode: string; secret: string }
  | { status: "error"; message: string };

export type VerifyState = { status: "idle" } | { status: "error"; message: string };

const VERIFY_LIMIT = { scope: "mfa-verify:user", windowSeconds: 900, max: 10 } as const;

const VerifyInput = z.object({
  factorId: z.uuid(),
  code: z.string().regex(/^\d{6}$/),
  next: z.string().max(500).optional(),
});

export async function startTotpEnrollment(): Promise<EnrollState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: "error", message: "Sign-in is not configured in this environment." };
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { status: "error", message: "Your session has expired. Sign in again." };

  // Abandoned enrolments leave unverified factors behind; clear them so a fresh one can be created.
  for (const f of userData.user.factors ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `PRFKT ${new Date().toISOString().slice(0, 16)}` });
  if (error || !data || data.type !== "totp") {
    console.error("mfa.enroll failed", error?.name, error?.status);
    return { status: "error", message: "Could not start authenticator setup. Check that TOTP MFA is enabled for this project, then try again." };
  }
  const qr = data.totp.qr_code.startsWith("data:") ? data.totp.qr_code : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
  return { status: "enrolling", factorId: data.id, qrCode: qr, secret: data.totp.secret };
}

export async function verifyTotp(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const parsed = VerifyInput.safeParse({
    factorId: formData.get("factorId"),
    code: String(formData.get("code") ?? "").replace(/\s+/g, ""),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { status: "error", message: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: "error", message: "Sign-in is not configured in this environment." };
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { status: "error", message: "Your session has expired. Sign in again." };

  if (isDatabaseConfigured() && !(await hitRateLimit(getSql(), VERIFY_LIMIT, userData.user.id))) {
    return { status: "error", message: "Too many attempts. Please wait a few minutes." };
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) {
    if (error.status === 429) return { status: "error", message: "Too many attempts. Please wait a few minutes." };
    return { status: "error", message: "That code did not match. Codes change every 30 seconds; try the current one." };
  }
  redirect(safeNextPath(parsed.data.next, "/admin"));
}
