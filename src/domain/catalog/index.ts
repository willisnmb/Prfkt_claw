import { z } from "zod";
import { FamilyId } from "../families";
import { FoundationId } from "../foundations";
import { CatalogItem, DeploymentTarget, Maturity, type CatalogItemInput } from "./schema";
import { AUTO_ITEMS } from "./items/auto";
import { CLAW_ITEMS } from "./items/claw";
import { CREW_ITEMS } from "./items/crew";
import { EDGE_ITEMS } from "./items/edge";
import { FLOW_ITEMS } from "./items/flow";
import { SECURE_ITEMS } from "./items/secure";
import { SHIELD_ITEMS } from "./items/shield";
import { STRICT_ITEMS } from "./items/strict";

/**
 * Seed catalog. Source of truth for the initial `claws` table and the static
 * fallback when no database is configured. Items are defined per family in
 * ./items/*.ts.
 */
const RAW: CatalogItemInput[] = [
  ...CLAW_ITEMS,
  ...FLOW_ITEMS,
  ...CREW_ITEMS,
  ...STRICT_ITEMS,
  ...EDGE_ITEMS,
  ...SECURE_ITEMS,
  ...AUTO_ITEMS,
  ...SHIELD_ITEMS,
];

export const CATALOG: CatalogItem[] = RAW.map((item) => CatalogItem.parse(item));

export function getCatalogItem(slug: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.slug === slug);
}

/* ---------------------------------------------------------------- Filters */

/** Filter state as it appears in URL search params. Unknown values are dropped, not errors. */
export const CatalogFilter = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  family: FamilyId.optional().catch(undefined),
  foundation: FoundationId.optional().catch(undefined),
  maturity: Maturity.optional().catch(undefined),
  deployment: DeploymentTarget.optional().catch(undefined),
});
export type CatalogFilter = z.infer<typeof CatalogFilter>;

type SearchParamValue = string | string[] | undefined;

/** Parses Next.js searchParams into a filter; takes the first value of repeated keys. */
export function parseCatalogFilter(params: Record<string, SearchParamValue>): CatalogFilter {
  const first = (v: SearchParamValue) => (Array.isArray(v) ? v[0] : v) || undefined;
  return CatalogFilter.parse({
    q: first(params.q),
    family: first(params.family),
    foundation: first(params.foundation),
    maturity: first(params.maturity),
    deployment: first(params.deployment),
  });
}

function haystack(item: CatalogItem): string {
  return [item.name, item.summary, item.description, ...item.outcomes, ...item.integrations, ...item.tags, item.family, item.foundation]
    .join(" ")
    .toLowerCase();
}

/**
 * Filters and searches the catalog. Every whitespace-separated term in `q`
 * must appear somewhere in the item's public text (AND semantics). Items that
 * match in the name rank first; otherwise catalog order is preserved.
 */
export function filterCatalog(items: readonly CatalogItem[], filter: CatalogFilter): CatalogItem[] {
  const terms = (filter.q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const matched = items.filter((item) => {
    if (filter.family && item.family !== filter.family) return false;
    if (filter.foundation && item.foundation !== filter.foundation) return false;
    if (filter.maturity && item.maturity !== filter.maturity) return false;
    if (filter.deployment && !item.deployments.includes(filter.deployment)) return false;
    if (terms.length === 0) return true;
    const text = haystack(item);
    return terms.every((t) => text.includes(t));
  });
  if (terms.length === 0) return matched;
  const nameHit = (i: CatalogItem) => terms.some((t) => i.name.toLowerCase().includes(t));
  return [...matched.filter(nameHit), ...matched.filter((i) => !nameHit(i))];
}

/** Serialises a filter back to a query string (only set keys), for links and URL sync. */
export function catalogFilterToQuery(filter: CatalogFilter): string {
  const p = new URLSearchParams();
  for (const key of ["q", "family", "foundation", "maturity", "deployment"] as const) {
    const v = filter[key];
    if (v) p.set(key, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function countBy<K extends string>(items: readonly CatalogItem[], key: (i: CatalogItem) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const i of items) {
    const k = key(i);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
