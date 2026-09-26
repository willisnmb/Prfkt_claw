import Link from "next/link";
import { ArrowRightIcon, CheckIcon, ClockIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaturityBadge } from "@/components/catalog/maturity-badge";
import { Eyebrow, Section } from "@/components/site/page-header";
import { countBy } from "@/domain/catalog";
import { MATURITY, MATURITY_DEFINITIONS } from "@/domain/catalog/schema";
import { FAMILY_LIST } from "@/domain/families";
import { FOUNDATION_LIST } from "@/domain/foundations";
import { listPublicCatalog } from "@/server/catalog-source";

const EXAMPLE_POLICY = [
  { action: "Read the new lead's website", rule: "Allowed", tone: "ok" },
  { action: "Draft the proposal", rule: "Allowed", tone: "ok" },
  { action: "Email the proposal to the lead", rule: "Needs approval", tone: "gate" },
  { action: "Charge the customer's card", rule: "Denied", tone: "deny" },
  { action: "Change platform permissions", rule: "Denied", tone: "deny" },
] as const;

const STEPS = [
  {
    title: "Describe the outcome",
    body: "Pick a system from the catalog or answer eleven questions about what you need. No framework choices required.",
  },
  {
    title: "Get a reasoned recommendation",
    body: "AUTO maps your answers to a system shape, deployment, model policy and compute class — with the reason for each.",
  },
  {
    title: "Governed from the first run",
    body: "SHIELD classifies every action. Sending, publishing, spending, deleting and deploying need approval or are denied.",
  },
  {
    title: "Accepted before go-live",
    body: "Your system runs in its own isolated cell and must pass acceptance tests against your data before it is switched on.",
  },
];

export default async function HomePage() {
  const catalog = await listPublicCatalog();
  const byFamily = countBy(catalog, (i) => i.family);
  const byFoundation = countBy(catalog, (i) => i.foundation);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div aria-hidden="true" className="bg-hero-glow pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="site-container relative grid gap-12 py-16 sm:py-24 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <Eyebrow>Finished AI systems · {catalog.length} in the catalog</Eyebrow>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              AI systems that do the work — <span className="text-primary">and ask before they act.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
              Assistants, durable workflows, agent teams, validated apps, private and edge deployments. Each customer runs in its
              own isolated cell, behind one security layer that decides what every system may do.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <Link href="/configure">
                  Configure a system <ArrowRightIcon aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
                <Link href="/catalog">Browse the catalog</Link>
              </Button>
            </div>
          </div>

          <figure className="rounded-2xl border border-border/80 bg-card/80 p-5 shadow-2xl shadow-black/30 backdrop-blur">
            <figcaption className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
              <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">Example · Lead-to-Customer</span>
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-primary">
                <ShieldCheckIcon aria-hidden="true" className="size-4" /> SHIELD policy
              </span>
            </figcaption>
            <ul className="mt-3 divide-y divide-border/50">
              {EXAMPLE_POLICY.map((p) => (
                <li key={p.action} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <span>{p.action}</span>
                  <span
                    className={
                      p.tone === "ok"
                        ? "inline-flex shrink-0 items-center gap-1 font-mono text-xs text-success"
                        : p.tone === "gate"
                          ? "inline-flex shrink-0 items-center gap-1 font-mono text-xs text-warning"
                          : "inline-flex shrink-0 items-center gap-1 font-mono text-xs text-destructive"
                    }
                  >
                    {p.tone === "ok" ? (
                      <CheckIcon aria-hidden="true" className="size-3.5" />
                    ) : p.tone === "gate" ? (
                      <ClockIcon aria-hidden="true" className="size-3.5" />
                    ) : (
                      <XIcon aria-hidden="true" className="size-3.5" />
                    )}
                    {p.rule}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Instructions hidden in a web page or email cannot change these rules.
            </p>
          </figure>
        </div>
      </section>

      {/* Families */}
      <Section
        id="families"
        title="Eight families. One control plane."
        intro="Buy the outcome; the right runtime is an implementation detail. Every family runs behind the same approvals, limits and audit trail."
      >
        <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FAMILY_LIST.map((f) => (
            <li key={f.id}>
              <Link
                href={f.section.href}
                className="group flex h-full flex-col rounded-xl border border-border/80 bg-card/60 p-5 transition-colors hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                style={{ borderTopColor: `var(${f.accentVar})`, borderTopWidth: 2 }}
              >
                <span className="font-mono text-sm font-semibold tracking-widest" style={{ color: `var(${f.accentVar})` }}>
                  {f.name}
                </span>
                <span className="mt-2 font-medium">{f.tagline}</span>
                <span className="mt-2 flex-1 text-sm text-muted-foreground">{f.description}</span>
                <span className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{byFamily[f.id] ?? 0} systems</span>
                  <span className="inline-flex items-center gap-1 text-foreground group-hover:text-primary">
                    {f.section.label} <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="border-y border-border/60 bg-card/30">
        <div className="site-container py-16">
          <h2 id="how-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            From outcome to accepted system
          </h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border border-border/70 bg-background/60 p-5">
                <span className="font-mono text-xs text-primary">0{i + 1}</span>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Maturity */}
      <Section
        id="maturity"
        title="Honest maturity labels"
        intro="Every system carries one of three labels. READY is earned with recorded evidence for every release gate — never assigned by marketing."
      >
        <ul role="list" className="grid gap-4 md:grid-cols-3">
          {MATURITY.map((m) => (
            <li key={m} className="rounded-xl border border-border/80 bg-card/60 p-5">
              <MaturityBadge maturity={m} />
              <p className="mt-3 text-sm text-muted-foreground">{MATURITY_DEFINITIONS[m]}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground">
          Today the catalog lists CONFIGURABLE and CUSTOM systems. READY labels will appear only once the release gates in our{" "}
          <Link href="/security" className="text-foreground underline underline-offset-4">
            security baseline
          </Link>{" "}
          have passing evidence.
        </p>
      </Section>

      {/* Foundations */}
      <Section
        id="foundations"
        title="Fourteen foundations"
        intro="Systems are organised by the part of your organisation — or household — they serve."
      >
        <ul role="list" className="flex flex-wrap gap-2">
          {FOUNDATION_LIST.map((f) => (
            <li key={f.id}>
              <Link
                href={`/catalog?foundation=${f.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border/80 px-4 text-sm hover:border-primary/60 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {f.name}
                <span className="font-mono text-xs text-muted-foreground">{byFoundation[f.id] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* CTA */}
      <section className="site-container">
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-8 sm:p-12">
          <div aria-hidden="true" className="bg-hero-glow pointer-events-none absolute inset-0 opacity-80" />
          <div className="relative max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Not sure where to start?</h2>
            <p className="mt-3 text-muted-foreground">
              Answer eleven questions and get a recommended system shape with the reasoning shown — or describe what you need and we
              will scope it with you.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-6">
                <Link href="/configure">Open the configurator</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6">
                <Link href="/custom">Request a custom build</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
