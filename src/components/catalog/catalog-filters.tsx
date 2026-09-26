"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { catalogFilterToQuery, type CatalogFilter } from "@/domain/catalog";
import { DEPLOYMENT_LABELS, DEPLOYMENT_TARGETS, MATURITY } from "@/domain/catalog/schema";
import { FAMILY_LIST } from "@/domain/families";
import { FOUNDATION_LIST } from "@/domain/foundations";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const selectClass =
  "h-11 w-full appearance-none rounded-lg border border-input bg-input/30 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23a1a1aa%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9 pl-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Catalog search and filters. Progressive enhancement: without JavaScript the
 * form submits as a GET; with it, changes update the URL in place.
 */
export function CatalogFilters({ filter, resultCount }: { filter: CatalogFilter; resultCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentQ = () => inputRef.current?.value.trim() || undefined;

  const apply = (next: CatalogFilter) => {
    startTransition(() => router.replace(`${pathname}${catalogFilterToQuery(next)}`, { scroll: false }));
  };

  // The search box is uncontrolled so text typed before hydration (slow phones)
  // is kept; pick it up once on mount if it differs from the URL.
  useEffect(() => {
    const typed = inputRef.current?.value.trim() || undefined;
    if (typed !== filter.q) {
      startTransition(() => router.replace(`${pathname}${catalogFilterToQuery({ ...filter, q: typed })}`, { scroll: false }));
    }
    return () => clearTimeout(timer.current);
    // Mount-only: later changes are handled by the input's onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearchInput = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ ...filter, q: currentQ() }), 250);
  };

  // Each select's `name` is its filter key.
  const onSelect = (e: React.ChangeEvent<HTMLSelectElement>) =>
    apply({ ...filter, q: currentQ(), [e.target.name]: e.target.value || undefined });

  const active = Boolean(filter.q || filter.family || filter.foundation || filter.maturity || filter.deployment);

  return (
    <form
      role="search"
      action={pathname}
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        apply({ ...filter, q: currentQ() });
      }}
      className="space-y-3"
      aria-describedby="catalog-result-count"
    >
      <div className="relative">
        <label htmlFor="catalog-q" className="sr-only">
          Search systems
        </label>
        <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="catalog-q"
          name="q"
          type="search"
          ref={inputRef}
          defaultValue={filter.q ?? ""}
          onChange={onSearchInput}
          placeholder="Search by outcome, tool or area — e.g. invoices, offline, approvals"
          maxLength={100}
          autoComplete="off"
          className="h-12 w-full rounded-lg border border-input bg-input/30 pr-3 pl-10 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div>
          <label htmlFor="catalog-family" className="mb-1 block text-xs text-muted-foreground">
            Family
          </label>
          <select id="catalog-family" name="family" value={filter.family ?? ""} onChange={onSelect} className={selectClass}>
            <option value="">All families</option>
            {FAMILY_LIST.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} — {f.tagline}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="catalog-foundation" className="mb-1 block text-xs text-muted-foreground">
            Foundation
          </label>
          <select id="catalog-foundation" name="foundation" value={filter.foundation ?? ""} onChange={onSelect} className={selectClass}>
            <option value="">All foundations</option>
            {FOUNDATION_LIST.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="catalog-maturity" className="mb-1 block text-xs text-muted-foreground">
            Maturity
          </label>
          <select id="catalog-maturity" name="maturity" value={filter.maturity ?? ""} onChange={onSelect} className={selectClass}>
            <option value="">Any maturity</option>
            {MATURITY.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="catalog-deployment" className="mb-1 block text-xs text-muted-foreground">
            Deployment
          </label>
          <select id="catalog-deployment" name="deployment" value={filter.deployment ?? ""} onChange={onSelect} className={selectClass}>
            <option value="">Any deployment</option>
            {DEPLOYMENT_TARGETS.map((d) => (
              <option key={d} value={d}>
                {DEPLOYMENT_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <p id="catalog-result-count" role="status" aria-live="polite" className={cn("text-sm text-muted-foreground", pending && "opacity-60")}>
          <span data-testid="result-count" className="font-medium text-foreground">
            {resultCount}
          </span>{" "}
          {resultCount === 1 ? "system" : "systems"}
          {pending && " · updating…"}
        </p>
        <noscript>
          <Button type="submit" variant="outline" className="h-11">
            Apply filters
          </Button>
        </noscript>
        {active && (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => {
              clearTimeout(timer.current);
              if (inputRef.current) inputRef.current.value = "";
              apply({});
            }}
          >
            <XIcon aria-hidden="true" /> Clear filters
          </Button>
        )}
      </div>
    </form>
  );
}
