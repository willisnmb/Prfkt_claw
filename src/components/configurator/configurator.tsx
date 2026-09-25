"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FamilyChip } from "@/components/catalog/family-chip";
import { ACTION_LABELS } from "@/components/catalog/labels";
import { AUTO_DEFAULT_INPUT, recommend, type AutoInput } from "@/domain/auto";
import { DEPLOYMENT_LABELS } from "@/domain/catalog/schema";
import { FAMILIES } from "@/domain/families";
import { COMPUTE_CLASSES, MODEL_POLICIES } from "@/domain/registries";
import { saveConfiguration } from "@/server/actions/intake";
import { cn } from "@/lib/utils";

type BoolKey = "persistentConversation" | "explicitStates" | "multiAgentBenefit" | "strictSchema" | "edgeHardware";
type EnumKey = Exclude<keyof AutoInput, BoolKey>;

const BOOL_FIELDS: { key: BoolKey; label: string; hint: string }[] = [
  { key: "persistentConversation", label: "Ongoing conversation and memory", hint: "People talk to it over days or months and expect it to remember." },
  { key: "explicitStates", label: "A process with named steps", hint: "Work moves through stages, approvals and hand-offs that must be tracked." },
  { key: "multiAgentBenefit", label: "Benefits from specialist roles", hint: "Distinct roles — researcher, writer, reviewer — would do better work together." },
  { key: "strictSchema", label: "Outputs feed other systems", hint: "Results go into a CRM, ledger or database and must validate first." },
  { key: "edgeHardware", label: "Runs on your own small hardware", hint: "A laptop, kiosk, store server or single-board computer." },
];

const ENUM_FIELDS: { key: EnumKey; label: string; options: { value: string; label: string }[] }[] = [
  {
    key: "privacy",
    label: "Data privacy",
    options: [
      { value: "standard", label: "Standard" },
      { value: "sensitive", label: "Sensitive" },
      { value: "regulated", label: "Regulated" },
      { value: "air-gapped", label: "Air-gapped" },
    ],
  },
  {
    key: "governance",
    label: "Governance",
    options: [
      { value: "light", label: "Light" },
      { value: "standard", label: "Standard" },
      { value: "strict", label: "Strict" },
    ],
  },
  {
    key: "latency",
    label: "Response time",
    options: [
      { value: "interactive", label: "Interactive" },
      { value: "near-real-time", label: "Within minutes" },
      { value: "batch", label: "Batch" },
    ],
  },
  {
    key: "budget",
    label: "Budget",
    options: [
      { value: "minimal", label: "Minimal" },
      { value: "moderate", label: "Moderate" },
      { value: "flexible", label: "Flexible" },
    ],
  },
  {
    key: "concurrency",
    label: "Who uses it",
    options: [
      { value: "single", label: "One person" },
      { value: "team", label: "A team" },
      { value: "department", label: "A department" },
      { value: "high-volume", label: "High volume" },
    ],
  },
  {
    key: "humanApproval",
    label: "Human approval for",
    options: [
      { value: "high-impact", label: "High-impact actions" },
      { value: "every-external-action", label: "Every external action" },
      { value: "every-write", label: "Every write" },
    ],
  },
];

function Segmented({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          return (
            <div key={o.value}>
              <input
                type="radio"
                id={id}
                name={name}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-border px-3.5 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 hover:bg-muted"
              >
                {o.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface ConfiguratorProps {
  initial?: AutoInput;
  catalogSlug?: string;
  catalogName?: string;
}

export function Configurator({ initial = AUTO_DEFAULT_INPUT, catalogSlug, catalogName }: ConfiguratorProps) {
  const uid = useId();
  const [input, setInput] = useState<AutoInput>(initial);
  const rec = useMemo(() => recommend(input), [input]);
  const family = FAMILIES[rec.family];
  const [name, setName] = useState(catalogName ? `${catalogName} configuration` : "");
  const [saving, startSaving] = useTransition();
  const [saveResult, setSaveResult] = useState<{ ok: true; id: string } | { ok: false; error: string } | null>(null);

  const set = <K extends keyof AutoInput>(key: K, value: AutoInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
    setSaveResult(null);
  };

  const save = () => {
    startSaving(async () => {
      try {
        const res = await saveConfiguration({
          name: name.trim() || `${family.name} configuration`,
          catalogSlug,
          auto: input,
        });
        setSaveResult(res.ok ? { ok: true, id: res.data.id } : { ok: false, error: res.error });
      } catch {
        setSaveResult({ ok: false, error: "Could not reach the server. Your answers are still here — try again." });
      }
    });
  };

  const requestHref = `/custom?family=${rec.family}${catalogSlug ? `&slug=${catalogSlug}` : ""}`;

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
      <form className="space-y-10" onSubmit={(e) => e.preventDefault()} aria-label="System requirements">
        <fieldset className="space-y-3">
          <legend className="font-mono text-xs tracking-widest text-muted-foreground uppercase">What the system does</legend>
          {BOOL_FIELDS.map((f) => {
            const id = `${uid}-${f.key}`;
            return (
              <div key={f.key} className="flex items-start justify-between gap-4 rounded-xl border border-border/80 bg-card/50 p-4">
                <label htmlFor={id} className="cursor-pointer">
                  <span className="block font-medium">{f.label}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{f.hint}</span>
                </label>
                <Switch
                  id={id}
                  checked={input[f.key]}
                  onCheckedChange={(v) => set(f.key, v)}
                  className="mt-1 shrink-0"
                  data-testid={`toggle-${f.key}`}
                />
              </div>
            );
          })}
        </fieldset>
        <div className="space-y-6">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">Constraints</p>
          {ENUM_FIELDS.map((f) => (
            <Segmented
              key={f.key}
              name={`${uid}-${f.key}`}
              label={f.label}
              value={input[f.key] as string}
              options={f.options}
              onChange={(v) => set(f.key, v as AutoInput[typeof f.key])}
            />
          ))}
        </div>
      </form>

      <section aria-labelledby={`${uid}-result`} className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-border/80 bg-card p-6" style={{ borderTopColor: `var(${family.accentVar})`, borderTopWidth: 3 }}>
          <h2 id={`${uid}-result`} className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Recommendation
          </h2>
          <p aria-live="polite" className="mt-3">
            <span className="block text-3xl font-semibold tracking-tight" style={{ color: `var(${family.accentVar})` }} data-testid="recommended-family">
              {family.name}
            </span>
            <span className="mt-1 block text-muted-foreground">{family.tagline}</span>
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Composition">
            {rec.composition.map((f) => (
              <FamilyChip key={f} family={f} />
            ))}
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Deployment</dt>
              <dd className="mt-0.5 font-medium" data-testid="recommended-deployment">
                {DEPLOYMENT_LABELS[rec.deployment]}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Model policy</dt>
              <dd className="mt-0.5 font-medium" data-testid="recommended-model-policy">
                {MODEL_POLICIES[rec.modelPolicy].label}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Compute</dt>
              <dd className="mt-0.5 font-medium">{COMPUTE_CLASSES[rec.compute].label}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Capability profile</dt>
              <dd className="mt-0.5 font-mono font-medium">{rec.profile}</dd>
            </div>
          </dl>

          <div className="mt-6">
            <p className="text-xs text-muted-foreground">Always needs approval</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {rec.approvalRequired.map((a) => (
                <li key={a} className="rounded-md border border-warning/40 px-2 py-0.5 text-xs text-warning">
                  {ACTION_LABELS[a].label}
                </li>
              ))}
            </ul>
          </div>

          {rec.warnings.length > 0 && (
            <ul className="mt-6 space-y-2" aria-label="Warnings">
              {rec.warnings.map((w) => (
                <li key={w} className="flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                  <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <details className="mt-6 group" open>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
              Why this recommendation
              <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {rec.reasons.map((r, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  {r.text}
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-6 border-t border-border/60 pt-6">
            <label htmlFor={`${uid}-name`} className="text-sm font-medium">
              Name this configuration
            </label>
            <input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder={`${family.name} configuration`}
              className="mt-2 h-11 w-full rounded-lg border border-input bg-input/30 px-3 text-base focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Button type="button" onClick={save} disabled={saving} className="h-11 px-5" aria-describedby={`${uid}-save-status`}>
                {saving && <Loader2Icon aria-hidden="true" className="animate-spin" />}
                {saving ? "Saving…" : "Save configuration"}
              </Button>
              <Button asChild variant="outline" className="h-11 px-5">
                <Link href={requestHref}>Request this build</Link>
              </Button>
            </div>
            <div id={`${uid}-save-status`} role="status" aria-live="polite" className="mt-3 text-sm">
              {saveResult?.ok === true && (
                <p className="flex items-center gap-2 text-success">
                  <CheckCircle2Icon aria-hidden="true" className="size-4" /> Saved. View it on your{" "}
                  <Link href="/dashboard" prefetch={false} className="underline underline-offset-4">
                    dashboard
                  </Link>
                  .
                </p>
              )}
              {saveResult?.ok === false && (
                <div className={cn("rounded-lg border border-destructive/40 bg-destructive/5 p-3")} data-testid="save-error">
                  <p className="text-destructive">{saveResult.error}</p>
                  <p className="mt-1 text-muted-foreground">
                    Saving requires an account.{" "}
                    <Link href="/login?next=/configure" className="text-foreground underline underline-offset-4">
                      Sign in to save
                    </Link>{" "}
                    — or request the build without saving.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
