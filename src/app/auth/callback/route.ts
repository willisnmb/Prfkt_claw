import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/server/auth/decide";
import { createSupabaseServerClient } from "@/server/auth/supabase";

const OTP_TYPES: readonly EmailOtpType[] = ["magiclink", "email", "signup", "recovery", "invite", "email_change"];

/**
 * Email-link landing. Supports PKCE (?code=) and token-hash (?token_hash=&type=)
 * links. Redirects only to same-origin paths (open-redirect guard).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"), "/dashboard");
  const fail = NextResponse.redirect(new URL("/login?error=link-invalid", origin));

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.redirect(new URL("/login", origin));

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail;
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail;
  } else {
    return fail;
  }
  const res = NextResponse.redirect(new URL(next, origin));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
