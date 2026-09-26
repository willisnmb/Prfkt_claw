import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { safeNextPath } from "@/server/auth/decide";
import { getOptionalUser } from "@/server/auth/user";
import { isSupabaseAuthConfigured } from "@/server/env";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your PRFKT CLAW dashboard.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "not-authorized": "That account does not have access to the owner control plane.",
  "link-invalid": "That sign-in link is invalid or has expired. Request a new one below.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined, "/dashboard");
  const errorKey = typeof sp.error === "string" ? sp.error : undefined;
  const configured = isSupabaseAuthConfigured();
  const user = configured ? await getOptionalUser() : null;

  return (
    <div className="site-container flex justify-center py-12 sm:py-20">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-muted-foreground">Save configurations, track requests and manage your systems.</p>

        {errorKey && ERRORS[errorKey] && (
          <Alert variant="destructive" className="mt-6">
            <ShieldAlertIcon aria-hidden="true" />
            <AlertTitle>Access problem</AlertTitle>
            <AlertDescription>{ERRORS[errorKey]}</AlertDescription>
          </Alert>
        )}

        <div className="mt-8">
          {!configured ? (
            <div role="status" className="rounded-lg border border-dashed border-border bg-card/50 p-6" data-testid="auth-not-configured">
              <h2 className="font-semibold">Sign-in is not configured in this environment</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This deployment has no identity provider connected, so accounts, the dashboard and the owner control plane are unavailable. You can still browse the
                catalog and use the configurator.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/catalog">Browse the catalog</Link>
                </Button>
                <Button asChild variant="ghost" className="min-h-11">
                  <Link href="/configure">Open the configurator</Link>
                </Button>
              </div>
            </div>
          ) : user ? (
            <div className="rounded-lg border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">Signed in as</p>
              <p className="mt-1 font-medium break-all">{user.email}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild className="min-h-11">
                  <Link href={next}>Continue</Link>
                </Button>
                <SignOutButton />
              </div>
            </div>
          ) : (
            <SignInForm next={next} />
          )}
        </div>
      </div>
    </div>
  );
}
