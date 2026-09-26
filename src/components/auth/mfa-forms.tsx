"use client";

import { useActionState, useState, useTransition } from "react";
import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startTotpEnrollment, verifyTotp, type EnrollState, type VerifyState } from "@/server/actions/mfa";

function CodeForm({ factorId, next, submitLabel }: { factorId: string; next: string; submitLabel: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyTotp, { status: "idle" });
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <div className="space-y-2">
        <Label htmlFor="code">6-digit code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          className="h-11 font-mono text-base tracking-widest"
          aria-describedby={state.status === "error" ? "mfa-error" : undefined}
          aria-invalid={state.status === "error" || undefined}
        />
      </div>
      <div aria-live="polite">
        {state.status === "error" && (
          <p id="mfa-error" role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
      </div>
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2Icon aria-hidden="true" className="animate-spin" /> Verifying…
          </>
        ) : (
          submitLabel
        )}
      </Button>
    </form>
  );
}

export function MfaChallengeForm({ factorId, next }: { factorId: string; next: string }) {
  return <CodeForm factorId={factorId} next={next} submitLabel="Verify" />;
}

export function MfaEnrollForm({ next }: { next: string }) {
  const [state, setState] = useState<EnrollState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  if (state.status === "enrolling") {
    return (
      <div className="space-y-6">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Open an authenticator app (1Password, Google Authenticator, Authy, …).</li>
          <li>Scan this QR code, or enter the setup key by hand.</li>
          <li>Enter the 6-digit code it shows.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the Auth server */}
        <img src={state.qrCode} alt="QR code for your authenticator app" width={200} height={200} className="rounded-md bg-white p-2" />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Setup key</p>
          <code className="block break-all rounded-md border border-border bg-muted p-2 font-mono text-sm" data-testid="mfa-secret">
            {state.secret}
          </code>
        </div>
        <CodeForm factorId={state.factorId} next={next} submitLabel="Verify and turn on" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Owner access needs a second factor. Set up an authenticator app once; after that you enter a code each time you sign in.
      </p>
      <div aria-live="polite">
        {state.status === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
      </div>
      <Button className="h-11 w-full" disabled={pending} onClick={() => startTransition(async () => setState(await startTotpEnrollment()))}>
        {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : <KeyRoundIcon aria-hidden="true" />}
        Set up authenticator app
      </Button>
    </div>
  );
}
