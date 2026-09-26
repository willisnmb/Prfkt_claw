import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/site/page-header";
import { ACTION_LABELS } from "@/components/catalog/labels";
import { SECURITY_CONTACT } from "@/components/site/site-config";
import { ACTION_CLASSES, HIGH_IMPACT_ACTIONS, RELEASE_GATE_LABELS, RELEASE_GATES, UNTRUSTED_SOURCES } from "@/security/taxonomy";

export const metadata: Metadata = {
  title: "Security",
  description: "PRFKT SHIELD: isolated customer cells, capability profiles, an action firewall, blast-radius limits, RED CLAW adversarial tests and release gates.",
};

const PROFILES = [
  {
    name: "SAFE",
    body: "No shell, no unrestricted filesystem, no gateway administration and no secret access. Integrations are brokered and read-only where that is enough; external actions are draft-only or approval-gated. The default for customer systems.",
  },
  {
    name: "OPERATOR",
    body: "An isolated workspace with bounded file access, approved browser and integrations, workflows, persistent memory and limited autonomous actions. High-impact actions still require approval.",
  },
  {
    name: "OWNER",
    body: "The highest-trust administrative profile. Never assigned to a customer system by default.",
  },
];

const LIMITS = [
  "Sends per hour",
  "Recipients per run",
  "Spend per day",
  "Model cost per day",
  "Tool actions per run",
  "Allowed domains, recipients, hosts, paths and commands",
  "Delete ceilings",
  "Timeouts",
  "Retry ceilings",
];

const REDCLAW = [
  "Prompt injection",
  "Indirect injection",
  "Secret extraction",
  "Path traversal",
  "Symlink escape",
  "Command injection",
  "SSRF",
  "Tool escalation",
  "Cross-tenant access",
  "Malicious attachment",
  "Duplicate webhook",
  "Unauthorised sending",
  "Unauthorised spending",
  "Unauthorised deleting",
  "Unauthorised deployment",
  "Runaway loop or cost",
];

const SOURCE_LABELS: Record<(typeof UNTRUSTED_SOURCES)[number], string> = {
  website: "Websites",
  email: "Email",
  attachment: "Attachments",
  third_party_message: "Third-party messages",
  retrieved_document: "Retrieved documents",
  tool_output: "Tool output",
  mcp_output: "Connector output",
  web_search: "Web search results",
};

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        eyebrow="PRFKT SHIELD"
        title="Security is the layer every system runs behind"
        lede="SHIELD decides what each system may do, bounds the damage if something goes wrong, and keeps evidence of what happened. This page describes our baseline as it stands; it is not a compliance certification."
      />

      <Section id="isolation" title="One customer, one cell" intro="Each customer's systems run in their own runtime cell. We do not treat a shared gateway as a security boundary between unrelated customers, and database policies prevent any customer from reading or acting on another's records.">
        <div className="grid gap-4 md:grid-cols-3">
          {["Customer A", "Customer B", "Customer C"].map((c) => (
            <div key={c} className="rounded-xl border border-dashed border-border p-5 text-center">
              <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{c}</p>
              <p className="mt-2 font-medium">Isolated runtime cell</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="profiles" title="Capability profiles">
        <ul role="list" className="grid gap-4 md:grid-cols-3">
          {PROFILES.map((p) => (
            <li key={p.name} className="rounded-xl border border-border/80 bg-card/60 p-5">
              <h3 className="font-mono text-sm font-semibold tracking-widest text-primary">{p.name}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="firewall" title="Action firewall" intro="Every action is classified before it runs, and every workflow carries an explicit rule for each class. High-impact classes are never autonomous by default.">
        <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ACTION_CLASSES.map((a) => {
            const high = HIGH_IMPACT_ACTIONS.includes(a);
            return (
              <li key={a} className="flex items-start justify-between gap-3 rounded-lg border border-border/80 p-4">
                <div>
                  <p className="font-mono text-xs tracking-wider">{a}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{ACTION_LABELS[a].hint}</p>
                </div>
                <span className={high ? "shrink-0 font-mono text-[0.68rem] text-warning uppercase" : "shrink-0 font-mono text-[0.68rem] text-muted-foreground uppercase"}>
                  {high ? "Approval or deny" : "Per workflow"}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="untrusted" title="External content is data, never instructions" intro="Content from these sources is labelled with where it came from and fenced off from the system's instructions. It cannot unlock actions, request secrets or change recipients.">
        <ul role="list" className="flex flex-wrap gap-2">
          {UNTRUSTED_SOURCES.map((s) => (
            <li key={s} className="rounded-full border border-border/80 px-3 py-1.5 text-sm">
              {SOURCE_LABELS[s]}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="secrets" title="Secrets never enter prompts or memory" intro="Passwords, API keys, refresh tokens, private keys, service-role keys, payment credentials and gateway tokens are never stored in prompts, memory, documents, logs, analytics or browser storage. Systems hold references; a broker resolves them at the moment of use, and secret-like text is redacted before anything is written." />

      <Section id="limits" title="Blast-radius limits" intro="Hard ceilings that bound what any system can do, even if it behaves unexpectedly.">
        <ul role="list" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LIMITS.map((l) => (
            <li key={l} className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
              {l}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="red-claw" title="RED CLAW adversarial tests" intro="Each system is exercised with adversarial cases across sixteen categories. A critical failure blocks the READY label.">
        <ul role="list" className="flex flex-wrap gap-2">
          {REDCLAW.map((r) => (
            <li key={r} className="rounded-md border border-destructive/40 px-3 py-1.5 font-mono text-xs text-destructive">
              {r}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="release-gates" title="Release gates" intro="A system is labelled READY only when every gate below has recorded, passing evidence. Until then it is CONFIGURABLE or CUSTOM — which is where every system in the catalog is today.">
        <ol className="grid gap-2 sm:grid-cols-2">
          {RELEASE_GATES.map((g, i) => (
            <li key={g} className="flex items-center gap-3 rounded-lg border border-border/80 px-4 py-3 text-sm">
              <span className="font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</span>
              {RELEASE_GATE_LABELS[g]}
            </li>
          ))}
        </ol>
      </Section>

      <Section id="admin" title="No backdoors" intro="Owner access is authenticated, authorised on the server, audited and revocable. There is no query-string master key, no hard-coded universal password and no client-side admin flag.">
        <p className="text-sm text-muted-foreground">
          Report a vulnerability to{" "}
          <a href={`mailto:${SECURITY_CONTACT}`} className="text-foreground underline underline-offset-4">
            {SECURITY_CONTACT}
          </a>
          . See also our <Link href="/privacy" className="text-foreground underline underline-offset-4">privacy notice</Link>.
        </p>
      </Section>
    </>
  );
}
