import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { AdminNav } from "@/components/admin/admin-nav";
import { Logo } from "@/components/site/logo";
import { requireOwner } from "@/server/auth/owner";

export const metadata: Metadata = {
  title: { default: "Control plane", template: "%s · Control plane" },
  robots: { index: false, follow: false },
};

// Always evaluated per request: owner checks must never be cached.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  // Layouts do not protect pages or actions on their own; each page and
  // action calls requireOwner() as well.
  const owner = await requireOwner();
  return (
    <div className="flex min-h-full flex-col">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:p-3">
        Skip to content
      </a>
      <header className="border-b border-border/60 bg-background/95 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded border border-primary/40 px-2 py-0.5 font-mono text-[0.7rem] tracking-widest text-primary uppercase">Owner</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{owner.email}</span>
            <Link href="/" className="hidden min-h-11 items-center text-sm text-muted-foreground hover:text-foreground sm:inline-flex">
              View site
            </Link>
            <SignOutButton variant="ghost" />
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-6 sm:px-6 md:grid-cols-[12rem_1fr]">
        <aside className="md:sticky md:top-6 md:self-start">
          <AdminNav />
        </aside>
        <main id="admin-main" tabIndex={-1} className="min-w-0 focus:outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
