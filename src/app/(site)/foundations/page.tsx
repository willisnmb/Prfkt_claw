import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { FamilyChip } from "@/components/catalog/family-chip";
import { PageHeader, Section } from "@/components/site/page-header";
import { FOUNDATION_LIST } from "@/domain/foundations";
import type { FamilyId } from "@/domain/families";
import { listPublicCatalog } from "@/server/catalog-source";

export const metadata: Metadata = {
  title: "Foundations",
  description: "Fourteen foundations — from Chief and Research to Family and Learning — each with systems across the PRFKT families.",
};

export default async function FoundationsPage() {
  const catalog = await listPublicCatalog();
  return (
    <>
      <PageHeader
        eyebrow="Foundations"
        title="Systems by the part of your world they serve"
        lede="Fourteen foundations organise the catalog by business area — and a few for home and learning. Each foundation draws on several families."
      />
      <Section>
        <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FOUNDATION_LIST.map((f) => {
            const items = catalog.filter((i) => i.foundation === f.id);
            const families = [...new Set(items.map((i) => i.family))] as FamilyId[];
            return (
              <li key={f.id}>
                <article className="relative flex h-full flex-col rounded-xl border border-border/80 bg-card/60 p-5" data-testid="foundation-card">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      <Link
                        href={`/catalog?foundation=${f.id}`}
                        className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                      >
                        {f.name}
                      </Link>
                    </h2>
                    <span className="font-mono text-xs text-muted-foreground">{items.length} systems</span>
                  </div>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">{f.summary}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    {families.map((fam) => (
                      <FamilyChip key={fam} family={fam} />
                    ))}
                    <ArrowRightIcon aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
