"use client";

import { useActionState } from "react";
import { Loader2Icon, MailCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithEmail, type SignInState } from "@/server/actions/auth";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInWithEmail, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div role="status" className="rounded-lg border border-border bg-card p-6">
        <MailCheckIcon aria-hidden="true" className="size-6 text-primary" />
        <h2 className="mt-3 text-lg font-semibold">Check your email</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If that address can sign in, a one-time link is on its way. It expires shortly and works once. You can close this tab.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate={false}>
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          className="h-11 text-base"
          aria-describedby={state.status === "error" ? "signin-error" : "signin-help"}
          aria-invalid={state.status === "error" || undefined}
        />
        <p id="signin-help" className="text-xs text-muted-foreground">
          We email you a one-time sign-in link. No password to store or leak.
        </p>
      </div>
      <div aria-live="polite">
        {state.status === "error" && (
          <p id="signin-error" role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
      </div>
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2Icon aria-hidden="true" className="animate-spin" /> Sending link…
          </>
        ) : (
          "Email me a sign-in link"
        )}
      </Button>
    </form>
  );
}
