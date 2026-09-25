import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CatalogGrid } from "@/components/catalog/catalog-card";
import { PageHeader, Section } from "@/components/site/page-header";
import { FAMILIES, type FamilyId } from "@/domain/families";
import { listPublicCatalog } from "@/server/catalog-source";

export interface FamilyPageCopy {
  title: string;
  lede: string;
  points: { title: string; body: string }[];
}

/** Shared layout for the six family section pages (Assistants, Workflows, …). */
export async function FamilyPage({ family, copy }: { family: FamilyId; copy: FamilyPageCopy }) {
  const f = FAMILIES[family];
  const items = (await listPublicCatalog()).filter((i) => i.family === family);
  return (
    <>
      <PageHeader eyebrow={`${f.name} · ${f.tagline}`} title={copy.title} lede={copy.lede} accentVar={f.accentVar}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 px-6">
            <Link href={`/catalog?family=${family}`}>See all {items.length} {f.section.label.toLowerCase()}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6">
            <Link href={`/custom?family=${family}`}>Request a custom build</Link>
          </Button>
        </div>
      </PageHeader>
      <Section>
        <ul role="list" className="grid gap-4 md:grid-cols-3">
          {copy.points.map((p) => (
            <li key={p.title} className="rounded-xl border border-border/80 bg-card/60 p-5" style={{ borderTopColor: `var(${f.accentVar})`, borderTopWidth: 2 }}>
              <h2 className="font-semibold">{p.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="systems" title={`${f.section.label} in the catalog`}>
        <CatalogGrid items={items} emptyMessage="No systems are listed in this family yet." />
      </Section>
    </>
  );
}
