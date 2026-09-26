import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import type { CatalogItem } from "@/domain/catalog/schema";
import { FAMILIES } from "@/domain/families";
import { FOUNDATIONS } from "@/domain/foundations";
import { FamilyChip } from "./family-chip";
import { MaturityBadge } from "./maturity-badge";

export function CatalogCard({ item }: { item: CatalogItem }) {
  const accent = FAMILIES[item.family].accentVar;
  return (
    <article
      className="group relative flex h-full flex-col rounded-xl border border-border/80 bg-card/70 p-5 transition-colors hover:border-[color-mix(in_oklch,var(--card-accent)_50%,transparent)] focus-within:border-[color-mix(in_oklch,var(--card-accent)_50%,transparent)]"
      style={{ ["--card-accent" as string]: `var(${accent})` }}
      data-testid="catalog-card"
      data-family={item.family}
    >
      <div className="flex flex-wrap items-center gap-2">
        <FamilyChip family={item.family} />
        <MaturityBadge maturity={item.maturity} className="relative z-10" />
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">
        <Link
          href={`/catalog/${item.slug}`}
          className="rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
        >
          {item.name}
        </Link>
      </h3>
      <p className="mt-2 flex-1 text-sm text-pretty text-muted-foreground">{item.summary}</p>
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>{FOUNDATIONS[item.foundation].name}</span>
        <ArrowUpRightIcon aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </article>
  );
}

export function CatalogGrid({ items, emptyMessage }: { items: CatalogItem[]; emptyMessage?: React.ReactNode }) {
  if (items.length === 0) {
    return (
      <div role="status" className="rounded-xl border border-dashed border-border p-10 text-center">
        <p className="font-medium">No systems match.</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyMessage ?? "Try removing a filter, or describe what you need in a custom request."}</p>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
      {items.map((item) => (
        <li key={item.slug}>
          <CatalogCard item={item} />
        </li>
      ))}
    </ul>
  );
}
