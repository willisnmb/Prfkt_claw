"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { EXPLORE_LINKS, PRIMARY_LINKS, SYSTEM_LINKS, type NavLink } from "./site-config";

function Group({ title, links, onNavigate, pathname }: { title: string; links: NavLink[]; onNavigate: () => void; pathname: string }) {
  return (
    <div>
      <p className="px-3 pb-1 font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">{title}</p>
      <ul>
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              onClick={onNavigate}
              aria-current={pathname === l.href ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-md px-3 text-base hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                pathname === l.href && "bg-muted text-primary",
              )}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="size-11 lg:hidden" aria-label="Open menu">
          <MenuIcon className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(88vw,22rem)] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="font-mono uppercase">Menu</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile" className="flex flex-col gap-5 px-2">
          <Group title="Systems" links={SYSTEM_LINKS} onNavigate={close} pathname={pathname} />
          <Group title="Explore" links={EXPLORE_LINKS} onNavigate={close} pathname={pathname} />
          <Group title="Company" links={PRIMARY_LINKS.filter((l) => l.href !== "/catalog")} onNavigate={close} pathname={pathname} />
          <div className="flex flex-col gap-2 px-1 pt-2">
            <Button asChild size="lg" className="h-11">
              <Link href="/configure" onClick={close}>
                Configure a system
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11">
              <Link href="/login" onClick={close}>
                Sign in
              </Link>
            </Button>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
