import "server-only";
import { CATALOG, getCatalogItem } from "@/domain/catalog";
import type { CatalogItem } from "@/domain/catalog/schema";
import { getSql } from "./db/postgres";
import { isDatabaseConfigured } from "./env";
import { loadPublishedCatalog } from "./data/catalog";
import { recordSystemEvent } from "./data/system-events";

/**
 * Public catalog source. With DATABASE_URL configured, reads published rows
 * from `claws` (owner overrides applied, RLS as anon). Without a database the
 * seed catalog is served. Database errors propagate to the route's error
 * boundary rather than silently re-showing unpublished seed items.
 */
export async function listPublicCatalog(): Promise<CatalogItem[]> {
  if (!isDatabaseConfigured()) return CATALOG;
  const { items, invalid } = await loadPublishedCatalog(getSql());
  if (invalid.length) await reportInvalid(invalid);
  return items;
}

export async function getPublicCatalogItem(slug: string): Promise<CatalogItem | undefined> {
  if (!isDatabaseConfigured()) return getCatalogItem(slug);
  const { items, invalid } = await loadPublishedCatalog(getSql(), slug);
  if (invalid.length) await reportInvalid(invalid);
  return items[0];
}

async function reportInvalid(slugs: string[]): Promise<void> {
  await recordSystemEvent({
    kind: "catalog.invalid_rows",
    severity: "warning",
    message: `${slugs.length} catalog row(s) failed schema validation and were hidden.`,
    detail: { slugs: slugs.slice(0, 20) },
  });
}
