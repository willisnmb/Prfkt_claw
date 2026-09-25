"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 p-6">
      <h1 className="text-xl font-semibold">This control-plane view failed to load</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        No change was made. {error.digest ? <>Reference: <code className="font-mono">{error.digest}</code></> : null}
      </p>
      <Button onClick={reset} className="mt-4 min-h-11">
        Retry
      </Button>
    </div>
  );
}
