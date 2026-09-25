import "server-only";
import { CATALOG, getCatalogItem } from "@/domain/catalog";
import type { CatalogItem } from "@/domain/catalog/schema";

/**
 * Public catalog source. CONTRACT STUB — the data slice switches this to the
 * `claws` table (published rows, admin overrides) when DATABASE_URL is set,
 * falling back to the seed catalog otherwise.
 */
export async function listPublicCatalog(): Promise<CatalogItem[]> {
  return CATALOG;
}

export async function getPublicCatalogItem(slug: string): Promise<CatalogItem | undefined> {
  return getCatalogItem(slug);
}
