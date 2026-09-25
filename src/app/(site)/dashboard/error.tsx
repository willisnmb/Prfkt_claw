"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="site-container py-16" role="alert">
      <h1 className="text-2xl font-semibold">We couldn&apos;t load your dashboard</h1>
      <p className="mt-2 text-muted-foreground">Your data is safe. This is usually temporary.</p>
      <Button onClick={reset} className="mt-6 min-h-11">
        Try again
      </Button>
    </div>
  );
}
