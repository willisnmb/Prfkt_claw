"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { EXPLORE_LINKS, PRIMARY_LINKS, SYSTEM_LINKS } from "./site-config";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

export function DesktopNav() {
  const pathname = usePathname();
  const inSystems = SYSTEM_LINKS.some((l) => pathname.startsWith(l.href));
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(linkClass, "gap-1 data-[state=open]:text-foreground", inSystems && "text-foreground")}>
          Systems <ChevronDownIcon aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="font-mono text-[0.7rem] tracking-widest uppercase">Systems</DropdownMenuLabel>
          {SYSTEM_LINKS.map((l) => (
            <DropdownMenuItem key={l.href} asChild>
              <Link href={l.href} className="flex flex-col items-start gap-0.5 py-2">
                <span className="font-medium">{l.label}</span>
                <span className="text-xs text-muted-foreground">{l.description}</span>
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {EXPLORE_LINKS.filter((l) => l.href !== "/catalog").map((l) => (
            <DropdownMenuItem key={l.href} asChild>
              <Link href={l.href}>{l.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {PRIMARY_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={pathname === l.href || pathname.startsWith(l.href + "/") ? "page" : undefined}
          className={cn(linkClass, (pathname === l.href || pathname.startsWith(l.href + "/")) && "text-foreground")}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
