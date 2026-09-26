import type { Metadata } from "next";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { CatalogGrid } from "@/components/catalog/catalog-card";
import { PageHeader } from "@/components/site/page-header";
import { filterCatalog, parseCatalogFilter } from "@/domain/catalog";
import { listPublicCatalog } from "@/server/catalog-source";

export const metadata: Metadata = {
  title: "Catalog",
  description: "Every PRFKT system — assistants, workflows, crews, validated apps, private and edge deployments — searchable by outcome.",
};

export default async function CatalogPage(props: PageProps<"/catalog">) {
  const [catalog, params] = await Promise.all([listPublicCatalog(), props.searchParams]);
  const filter = parseCatalogFilter(params);
  const results = filterCatalog(catalog, filter);

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Every system, searchable by outcome"
        lede={`${catalog.length} systems across eight families and fourteen foundations. Each one lists exactly what it may do and which actions need your approval.`}
      />
      <div className="site-container py-10">
        <CatalogFilters filter={filter} resultCount={results.length} />
        <div className="mt-8">
          <CatalogGrid items={results} />
        </div>
      </div>
    </>
  );
}
