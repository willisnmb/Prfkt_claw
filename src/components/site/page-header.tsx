import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Eyebrow({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <p className={cn("font-mono text-xs tracking-[0.2em] text-primary uppercase", className)} style={style}>
      {children}
    </p>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
  accentVar,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  /** Optional family accent CSS variable name, e.g. "--family-flow". */
  accentVar?: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="site-container relative py-14 sm:py-20">
        {eyebrow && <Eyebrow style={accentVar ? { color: `var(${accentVar})` } : undefined}>{eyebrow}</Eyebrow>}
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {lede && <p className="mt-4 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg">{lede}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

export function Section({
  id,
  title,
  intro,
  children,
  className,
}: {
  id?: string;
  title?: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={cn("site-container py-12 sm:py-16", className)}>
      {title && (
        <div className="mb-8 max-w-2xl">
          <h2 id={headingId} className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h2>
          {intro && <p className="mt-3 text-muted-foreground">{intro}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
