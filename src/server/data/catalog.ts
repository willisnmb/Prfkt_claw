import { CatalogItem } from "@/domain/catalog/schema";
import type { Sql } from "../db/sql";
import { withAnon } from "../db/sql";

interface ClawDbRow {
  slug: string;
  maturity: string;
  definition: Record<string, unknown>;
  evidence: Array<{ gate: string; ref: string; result: string; verifiedAt: string }>;
}

/**
 * Published catalog as the public sees it: read as `anon` so RLS (published
 * only) applies, owner overrides (maturity) merged over the seed definition,
 * and each row re-validated with the catalog schema. Rows that fail
 * validation are dropped rather than shown with inconsistent labels.
 */
export async function loadPublishedCatalog(sql: Sql, slug?: string): Promise<{ items: CatalogItem[]; invalid: string[] }> {
  const rows = await withAnon(sql, (tx) =>
    tx.query<ClawDbRow>(
      `select c.slug, c.maturity, c.definition,
              coalesce(jsonb_agg(jsonb_build_object('gate', e.gate, 'ref', e.ref, 'result', e.result, 'verifiedAt', e.verified_at::text))
                       filter (where e.id is not null), '[]'::jsonb) as evidence
       from public.claws c left join public.claw_evidence e on e.claw_slug = c.slug
       where ($1::text is null or c.slug = $1)
       group by c.slug
       order by c.family, c.name`,
      [slug ?? null],
    ),
  );
  const items: CatalogItem[] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    const parsed = CatalogItem.safeParse({ ...row.definition, slug: row.slug, maturity: row.maturity, evidence: row.evidence });
    if (parsed.success) items.push(parsed.data);
    else invalid.push(row.slug);
  }
  return { items, invalid };
}
