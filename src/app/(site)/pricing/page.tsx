import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "Pricing",
  description: "How PRFKT systems are priced: scoping and setup, a monthly fee per isolated cell, compute metered by time and model usage by policy.",
};

const COMPONENTS = [
  {
    title: "Scoping and setup",
    body: "A one-off fee to agree acceptance criteria, connect your systems in an isolated cell and run acceptance tests against your data.",
    basis: "Fixed quote per system",
  },
  {
    title: "Running your cell",
    body: "A monthly fee per isolated customer cell, covering the control plane, SHIELD policy enforcement, audit history, monitoring and backups.",
    basis: "Monthly, per cell",
  },
  {
    title: "Compute",
    body: "Managed compute is metered by compute time for the class you choose. Your own hardware is not metered by us.",
    basis: "Compute-hours",
  },
  {
    title: "Model usage",
    body: "Depends on your model policy. Local and your-own-provider routes add no managed model cost; managed routes are metered against a daily ceiling you set.",
    basis: "Per policy, capped daily",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title="Quoted after scoping — with no surprise usage"
        lede="Prices depend on the system, where it runs and your model policy, so every engagement is quoted once we have agreed what acceptance means. These are the parts every quote is built from."
      />
      <Section>
        <div role="note" className="mb-8 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
          <strong className="text-warning">Billing is not yet enabled.</strong> We do not take payment online today. Requests are reviewed by a person and quoted directly.
        </div>
        <ul role="list" className="grid gap-4 md:grid-cols-2">
          {COMPONENTS.map((c) => (
            <li key={c.title} className="flex flex-col rounded-xl border border-border/80 bg-card/60 p-6">
              <h2 className="text-lg font-semibold">{c.title}</h2>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">{c.body}</p>
              <p className="mt-4 flex items-center justify-between border-t border-border/60 pt-4 text-sm">
                <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{c.basis}</span>
                <span className="font-medium">Quoted after scoping</span>
              </p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="principles" title="What we commit to">
        <ul className="grid gap-3 text-sm sm:grid-cols-2">
          <li className="rounded-lg bg-muted/50 p-4">No silent fallback to paid model routes.</li>
          <li className="rounded-lg bg-muted/50 p-4">Daily cost ceilings that stop spending, not just warn.</li>
          <li className="rounded-lg bg-muted/50 p-4">No activation before acceptance tests pass and you approve.</li>
          <li className="rounded-lg bg-muted/50 p-4">Export and deletion of your data on request.</li>
        </ul>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 px-6">
            <Link href="/custom">Request a quote</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6">
            <Link href="/configure">Estimate with the configurator</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
