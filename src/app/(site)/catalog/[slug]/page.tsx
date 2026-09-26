import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CatalogGrid } from "@/components/catalog/catalog-card";
import { FamilyChip } from "@/components/catalog/family-chip";
import { GovernedActions } from "@/components/catalog/governed-actions";
import { MaturityBadge } from "@/components/catalog/maturity-badge";
import { CATALOG } from "@/domain/catalog";
import { DEPLOYMENT_LABELS, MATURITY_DEFINITIONS } from "@/domain/catalog/schema";
import { FAMILIES } from "@/domain/families";
import { FOUNDATIONS } from "@/domain/foundations";
import { COMPUTE_CLASSES, MODEL_POLICIES, RUNTIMES } from "@/domain/registries";
import { getPublicCatalogItem, listPublicCatalog } from "@/server/catalog-source";

export function generateStaticParams() {
  return CATALOG.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata(props: PageProps<"/catalog/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const item = await getPublicCatalogItem(slug);
  if (!item) return { title: "Not found" };
  return { title: item.name, description: item.summary };
}

const ACCEPTANCE: Record<string, string> = {
  READY: "This system has recorded passing evidence for every release gate. It is still configured to your accounts and checked against your data before go-live.",
  CONFIGURABLE:
    "Built from a tested template. We connect it to your systems in its own isolated cell, then run acceptance tests against your data. It is switched on only when those pass and you approve activation.",
  CUSTOM:
    "Scoped with you before any build. We agree written acceptance criteria first; the system goes live only when it meets them and you approve activation.",
};

export default async function CatalogItemPage(props: PageProps<"/catalog/[slug]">) {
  const { slug } = await props.params;
  const item = await getPublicCatalogItem(slug);
  if (!item) notFound();

  const family = FAMILIES[item.family];
  const related = (await listPublicCatalog()).filter((i) => i.slug !== item.slug && i.foundation === item.foundation).slice(0, 3);
  const runtime = RUNTIMES[item.runtime];

  return (
    <>
      <section className="relative overflow-hidden border-b border-border/60">
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="site-container relative py-10 sm:py-16">
          <nav aria-label="Breadcrumb">
            <Link href="/catalog" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeftIcon aria-hidden="true" className="size-4" /> Catalog
            </Link>
          </nav>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FamilyChip family={item.family} href={family.section.href} />
            <MaturityBadge maturity={item.maturity} />
            <Link href={`/catalog?foundation=${item.foundation}`} className="inline-flex h-6 items-center text-xs text-muted-foreground hover:text-foreground">
              {FOUNDATIONS[item.foundation].name}
            </Link>
          </div>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{item.name}</h1>
          <p className="mt-4 max-w-2xl text-lg text-pretty text-muted-foreground">{item.summary}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 px-6">
              <Link href={`/configure?slug=${item.slug}`}>Configure this system</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6">
              <Link href={`/custom?slug=${item.slug}&family=${item.family}&foundation=${item.foundation}`}>Request it</Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="site-container grid gap-12 py-12 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-12">
          <section aria-labelledby="overview-heading">
            <h2 id="overview-heading" className="text-xl font-semibold tracking-tight">
              What it does
            </h2>
            <p className="mt-3 text-pretty text-muted-foreground">{item.description}</p>
          </section>

          <section aria-labelledby="outcomes-heading">
            <h2 id="outcomes-heading" className="text-xl font-semibold tracking-tight">
              Outcomes
            </h2>
            <ul className="mt-4 space-y-3">
              {item.outcomes.map((o) => (
                <li key={o} className="flex gap-3">
                  <CheckIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="actions-heading">
            <h2 id="actions-heading" className="text-xl font-semibold tracking-tight">
              Governed actions
            </h2>
            <p className="mt-2 mb-4 text-sm text-muted-foreground">
              Enforced by SHIELD on every run. Content the system reads — web pages, emails, attachments — cannot change these rules.
            </p>
            <GovernedActions actions={item.actions} />
          </section>

          <section aria-labelledby="acceptance-heading">
            <h2 id="acceptance-heading" className="text-xl font-semibold tracking-tight">
              Maturity and acceptance
            </h2>
            <div className="mt-4 rounded-xl border border-border/80 bg-card/60 p-5">
              <MaturityBadge maturity={item.maturity} />
              <p className="mt-3 text-sm text-muted-foreground">{MATURITY_DEFINITIONS[item.maturity]}</p>
              <p className="mt-3 text-sm">{ACCEPTANCE[item.maturity]}</p>
            </div>
          </section>
        </div>

        <aside className="space-y-6" aria-label="Deployment options">
          <div className="rounded-xl border border-border/80 bg-card/60 p-5">
            <h2 className="font-mono text-xs tracking-widest text-muted-foreground uppercase">Runs where</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {item.deployments.map((d) => (
                <li key={d} className="rounded-md border border-border/80 px-2.5 py-1 text-sm">
                  {DEPLOYMENT_LABELS[d]}
                </li>
              ))}
            </ul>
            <h2 className="mt-6 font-mono text-xs tracking-widest text-muted-foreground uppercase">Model policies</h2>
            <ul className="mt-3 space-y-2">
              {item.modelPolicies.map((m) => (
                <li key={m} className="text-sm">
                  <span className="font-medium">{MODEL_POLICIES[m].label}</span>
                  <span className="block text-xs text-muted-foreground">{MODEL_POLICIES[m].description}</span>
                </li>
              ))}
            </ul>
            <h2 className="mt-6 font-mono text-xs tracking-widest text-muted-foreground uppercase">Compute</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {item.compute.map((c) => (
                <li key={c} className="rounded-md border border-border/80 px-2.5 py-1 text-sm">
                  {COMPUTE_CLASSES[c].label}
                </li>
              ))}
            </ul>
          </div>

          {item.integrations.length > 0 && (
            <div className="rounded-xl border border-border/80 bg-card/60 p-5">
              <h2 className="font-mono text-xs tracking-widest text-muted-foreground uppercase">Connects to</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {item.integrations.map((i) => (
                  <li key={i} className="rounded-md bg-muted px-2.5 py-1 text-sm">
                    {i}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">Connected through brokered secret references — keys never enter prompts or memory.</p>
            </div>
          )}

          <details className="group rounded-xl border border-border/80 bg-card/60 p-5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-mono text-xs tracking-widest text-muted-foreground uppercase focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              Under the hood
              <span aria-hidden="true" className="transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm">
              <span className="font-medium">{runtime.label}</span>
              <span className="block text-muted-foreground">{runtime.role}</span>
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Capability profile: <span className="font-mono text-foreground">{item.profile}</span>. Runtimes are implementation details and may change without
              changing what the system is allowed to do.
            </p>
          </details>
        </aside>
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="site-container pb-4">
          <h2 id="related-heading" className="mb-6 text-xl font-semibold tracking-tight">
            More for {FOUNDATIONS[item.foundation].name}
          </h2>
          <CatalogGrid items={related} />
        </section>
      )}
    </>
  );
}
