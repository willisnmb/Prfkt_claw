import Link from "next/link";
import { cn } from "@/lib/utils";

/** PRFKT CLAW wordmark with a three-stroke claw mark. Decorative SVG; the link carries the label. */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="PRFKT CLAW home"
      className={cn("group inline-flex min-h-11 items-center gap-2 rounded-md font-semibold tracking-tight", className)}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-primary" fill="none">
        <path d="M5 20C6 13 8 7 12 3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M10 21c.6-5 2.4-9.5 6-13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
        <path d="M15 21.5c.4-3.4 1.8-6.4 4.2-8.6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".6" />
      </svg>
      <span className="font-mono text-[0.95rem] uppercase">
        PRFKT <span className="text-primary">CLAW</span>
      </span>
    </Link>
  );
}
