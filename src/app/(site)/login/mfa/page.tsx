import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MfaChallengeForm, MfaEnrollForm } from "@/components/auth/mfa-forms";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { safeNextPath } from "@/server/auth/decide";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export const metadata: Metadata = {
  title: "Two-step verification",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: PageProps<"/login/mfa">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined, "/admin");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/login?next=${encodeURIComponent(`/login/mfa?next=${next}`)}`);

  const factor = (data.user.factors ?? []).find((f) => f.status === "verified" && f.factor_type === "totp");
  const claims = await supabase.auth.getClaims();
  const aal = claims.data?.claims.aal;

  return (
    <div className="site-container flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">Two-step verification</h1>
        <p className="mt-2 break-all text-muted-foreground">Signed in as {data.user.email}</p>
        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          {factor && aal === "aal2" ? (
            <div role="status" className="space-y-4">
              <p>This session is verified.</p>
              <Button asChild className="min-h-11">
                <Link href={next}>Continue</Link>
              </Button>
            </div>
          ) : factor ? (
            <>
              <p className="mb-4 text-sm text-muted-foreground">Enter the code from your authenticator app.</p>
              <MfaChallengeForm factorId={factor.id} next={next} />
            </>
          ) : (
            <MfaEnrollForm next={next} />
          )}
        </div>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
