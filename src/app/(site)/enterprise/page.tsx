import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/site/page-header";

export const metadata: Metadata = {
  title: "Enterprise",
  description: "Private, governed AI deployments with per-customer isolation, owner review, your identity provider and acceptance before go-live.",
};

const PILLARS = [
  { title: "Isolated per customer", body: "Every customer runs in its own runtime cell. We never place unrelated customers inside one trusted boundary." },
  { title: "Your identity and secrets", body: "Single sign-on through your provider, secrets referenced from your vault, and no keys in prompts, memory or logs." },
  { title: "Deploy where you need", body: "Managed isolated cells, your private cloud, on-premises or air-gapped — with local models as a first-class route." },
  { title: "Owner review at every gate", body: "Custom requests, provisioning and production activation are reviewed by a person and recorded in the audit trail." },
  { title: "Acceptance before go-live", body: "Written acceptance criteria are agreed first. Systems switch on only after they pass and you approve activation." },
  { title: "Evidence you can keep", body: "Audit history, backup and restore drills, and RED CLAW results are exportable for your own records." },
];

const PROCESS = [
  "Discovery call and written requirements",
  "AUTO recommendation reviewed with your architects",
  "Acceptance criteria agreed and signed off",
  "Provisioning in an isolated cell — review-gated",
  "Acceptance testing against your data",
  "Activation on your approval; ongoing monitoring",
];

export default function EnterprisePage() {
  return (
    <>
      <PageHeader
        eyebrow="Enterprise"
        title="Governed AI systems for organisations that cannot afford surprises"
        lede="PRFKT SECURE is our acceptance standard for private deployments: whatever runtime sits inside, it must meet the same isolation, secrets, audit and recovery requirements."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 px-6">
            <Link href="/custom?family=SECURE">Talk to us about a private deployment</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 px-6">
            <Link href="/private-ai">See private systems</Link>
          </Button>
        </div>
      </PageHeader>
      <Section>
        <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <li key={p.title} className="rounded-xl border border-border/80 bg-card/60 p-5">
              <h2 className="font-semibold">{p.title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section id="process" title="How an enterprise engagement runs">
        <ol className="space-y-3">
          {PROCESS.map((s, i) => (
            <li key={s} className="flex items-center gap-4 rounded-lg border border-border/80 px-4 py-3">
              <span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, "0")}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
