import { CatalogItem, type CatalogItemInput } from "./schema";

/**
 * Seed catalog. Source of truth for the initial `claws` table and the static
 * fallback when no database is configured. Items are added per family in
 * ./items/*.ts (storefront slice).
 */
const RAW: CatalogItemInput[] = [];

export const CATALOG: CatalogItem[] = RAW.map((item) => CatalogItem.parse(item));

export function getCatalogItem(slug: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.slug === slug);
}
