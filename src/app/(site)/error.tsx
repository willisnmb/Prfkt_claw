"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the digest is logged; error messages can contain request data.
    console.error("site error", error.digest ?? "no-digest");
  }, [error]);

  return (
    <div className="site-container py-20" role="alert">
      <p className="font-mono text-xs tracking-[0.2em] text-destructive uppercase">Something went wrong</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">This page could not be loaded.</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        The error has been recorded{error.digest ? ` (reference ${error.digest})` : ""}. You can try again, or go back to the catalog.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset} className="h-11 px-5">
          Try again
        </Button>
        <Button asChild variant="outline" className="h-11 px-5">
          <Link href="/catalog">Browse the catalog</Link>
        </Button>
      </div>
    </div>
  );
}
