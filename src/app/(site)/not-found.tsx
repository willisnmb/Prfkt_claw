import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="site-container py-20">
      <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">We could not find that page.</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        The system or page may have been renamed or retired. Search the catalog, or tell us what you need.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild className="h-11 px-5">
          <Link href="/catalog">Browse the catalog</Link>
        </Button>
        <Button asChild variant="outline" className="h-11 px-5">
          <Link href="/custom">Request a custom build</Link>
        </Button>
      </div>
    </div>
  );
}
