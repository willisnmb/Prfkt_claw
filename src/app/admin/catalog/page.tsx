import type { Metadata } from "next";
import { AdminEmpty, AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { EvidenceForm, MaturityForm, PublishToggle } from "@/components/admin/catalog-row-forms";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FAMILY_IDS } from "@/domain/families";
import { RELEASE_GATES } from "@/security/taxonomy";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { ClawFilter, listAdminClaws } from "@/server/data/admin";

export const metadata: Metadata = { title: "Catalog" };

export default async function AdminCatalogPage({ searchParams }: PageProps<"/admin/catalog">) {
  await requireOwner();
  const sp = await searchParams;
  const parsed = ClawFilter.safeParse({
    q: typeof sp.q === "string" ? sp.q : undefined,
    family: typeof sp.family === "string" && sp.family ? sp.family : undefined,
  });
  const filter = parsed.success ? parsed.data : {};
  return (
    <>
      <AdminPageHeader
        title="Catalog"
        description="Publish, unpublish and set maturity. READY is refused until passing evidence is recorded for all eight release gates — in the app and in the database."
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div>
          <label htmlFor="q" className="text-xs text-muted-foreground">
            Search
          </label>
          <Input id="q" name="q" defaultValue={filter.q} className="h-11 w-56" />
        </div>
        <div>
          <label htmlFor="family" className="block text-xs text-muted-foreground">
            Family
          </label>
          <select id="family" name="family" defaultValue={filter.family ?? ""} className="h-11 rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">All</option>
            {FAMILY_IDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" className="min-h-11">
          Filter
        </Button>
      </form>
      <RequireDatabase>
        <CatalogTable filter={filter} />
      </RequireDatabase>
    </>
  );
}

async function CatalogTable({ filter }: { filter: { q?: string; family?: string } }) {
  const rows = await listAdminClaws(getSql(), filter);
  if (rows.length === 0) return <AdminEmpty>No catalog items match. If the catalog is empty, apply supabase/seed.sql.</AdminEmpty>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.slug} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{r.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {r.slug} · {r.family} · {r.foundation_id} · updated {fmtDate(r.updated_at)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{r.maturity}</span>
              <StatusBadge status={r.published ? "ACTIVE" : "disabled"} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <PublishToggle slug={r.slug} published={r.published} />
            <MaturityForm slug={r.slug} maturity={r.maturity} />
            <span className="text-xs text-muted-foreground">
              Evidence: {r.evidence_gates.length}/{RELEASE_GATES.length} gates
            </span>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted-foreground">Record release-gate evidence</summary>
            <div className="mt-3">
              <EvidenceForm slug={r.slug} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
