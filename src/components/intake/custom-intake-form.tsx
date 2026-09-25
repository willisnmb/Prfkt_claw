"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BUDGET_RANGES, CustomBuildRequestInput, DATA_SENSITIVITY, TIMELINES } from "@/domain/intake";
import { FAMILY_LIST, type FamilyId } from "@/domain/families";
import { FOUNDATION_LIST, type FoundationId } from "@/domain/foundations";
import { submitCustomBuildRequest } from "@/server/actions/intake";
import { cn } from "@/lib/utils";

const SENSITIVITY_LABELS: Record<(typeof DATA_SENSITIVITY)[number], string> = {
  public: "Public information only",
  internal: "Internal business data",
  confidential: "Confidential or personal data",
  regulated: "Regulated data (health, finance, legal…)",
};
const TIMELINE_LABELS: Record<(typeof TIMELINES)[number], string> = {
  exploring: "Exploring options",
  "this-quarter": "This quarter",
  "this-month": "This month",
  urgent: "Urgent",
};
const BUDGET_LABELS: Record<(typeof BUDGET_RANGES)[number], string> = {
  "under-5k": "Under $5k",
  "5k-25k": "$5k – $25k",
  "25k-100k": "$25k – $100k",
  "100k-plus": "$100k+",
  "not-sure": "Not sure yet",
};

type FieldErrors = Record<string, string[] | undefined>;

const inputClass =
  "w-full rounded-lg border border-input bg-input/30 px-3 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive";
const selectClass = cn(inputClass, "h-11 appearance-none pr-8");

function FieldError({ id, messages }: { id: string; messages: string[] | undefined }) {
  if (!messages?.length) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-destructive">
      {messages[0]}
    </p>
  );
}

export interface IntakeDefaults {
  family?: FamilyId;
  foundation?: FoundationId;
  catalogSlug?: string;
  catalogName?: string;
}

function readForm(form: HTMLFormElement) {
  const fd = new FormData(form);
  const str = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  };
  return {
    contactName: str("contactName") ?? "",
    contactEmail: str("contactEmail") ?? "",
    company: str("company"),
    foundation: str("foundation"),
    family: str("family"),
    catalogSlug: str("catalogSlug"),
    problem: str("problem") ?? "",
    outcomes: str("outcomes"),
    dataSensitivity: str("dataSensitivity"),
    timeline: str("timeline"),
    budgetRange: str("budgetRange"),
    consent: fd.get("consent") === "on" ? true : undefined,
    website: typeof fd.get("website") === "string" ? (fd.get("website") as string) : undefined,
  };
}

export function CustomIntakeForm({ defaults }: { defaults: IntakeDefaults }) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const fid = (k: string) => `${uid}-${k}`;
  const errId = (k: string) => `${uid}-${k}-error`;
  const invalid = (k: string) => (errors[k]?.length ? true : undefined);
  const describedBy = (k: string, hint?: boolean) =>
    [hint ? `${uid}-${k}-hint` : null, errors[k]?.length ? errId(k) : null].filter(Boolean).join(" ") || undefined;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    const values = readForm(e.currentTarget);
    const parsed = CustomBuildRequestInput.safeParse(values);
    if (!parsed.success) {
      const fe: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        (fe[key] ??= []).push(friendly(key, issue.message));
      }
      setErrors(fe);
      // Move focus to the first invalid field for keyboard and screen-reader users.
      const first = Object.keys(fe)[0];
      if (first) document.getElementById(fid(first))?.focus();
      return;
    }
    setErrors({});
    startTransition(async () => {
      try {
        const res = await submitCustomBuildRequest(parsed.data);
        if (res.ok) {
          setReference(res.data.reference);
          formRef.current?.reset();
        } else {
          setServerError(res.error);
          if (res.fieldErrors) setErrors(res.fieldErrors);
        }
      } catch {
        setServerError("We could not reach the server. Your answers are still in the form — please try again.");
      }
    });
  };

  if (reference) {
    return (
      <div role="status" className="rounded-2xl border border-success/40 bg-success/5 p-8" data-testid="intake-success">
        <CheckCircle2Icon aria-hidden="true" className="size-8 text-success" />
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Request received</h2>
        <p className="mt-2 text-muted-foreground">
          Your reference is <span className="font-mono text-foreground">{reference}</span>. A person reviews every request; we will reply by email.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button asChild className="h-11 px-5">
            <Link href="/catalog">Back to the catalog</Link>
          </Button>
          <Button type="button" variant="outline" className="h-11 px-5" onClick={() => setReference(null)}>
            Submit another request
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-8" aria-describedby={serverError ? `${uid}-server-error` : undefined}>
      {Object.keys(errors).length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" data-testid="intake-errors">
          Please correct the highlighted fields.
        </div>
      )}
      {serverError && (
        <div id={`${uid}-server-error`} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="intake-server-error">
          <p className="text-destructive">{serverError}</p>
          <p className="mt-1 text-muted-foreground">
            You can also email us — see <Link href="/support" className="underline underline-offset-4">support</Link>.
          </p>
        </div>
      )}

      {defaults.catalogSlug && <input type="hidden" name="catalogSlug" value={defaults.catalogSlug} />}
      {defaults.catalogName && (
        <p className="rounded-lg border border-border/80 bg-card/60 px-4 py-3 text-sm">
          About: <span className="font-medium">{defaults.catalogName}</span>
        </p>
      )}

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-3 font-mono text-xs tracking-widest text-muted-foreground uppercase">About you</legend>
        <div>
          <label htmlFor={fid("contactName")} className="mb-1.5 block text-sm font-medium">
            Name <span className="text-muted-foreground">(required)</span>
          </label>
          <input id={fid("contactName")} name="contactName" autoComplete="name" maxLength={120} className={cn(inputClass, "h-11")} aria-invalid={invalid("contactName")} aria-describedby={describedBy("contactName")} />
          <FieldError id={errId("contactName")} messages={errors.contactName} />
        </div>
        <div>
          <label htmlFor={fid("contactEmail")} className="mb-1.5 block text-sm font-medium">
            Work email <span className="text-muted-foreground">(required)</span>
          </label>
          <input id={fid("contactEmail")} name="contactEmail" type="email" inputMode="email" autoComplete="email" maxLength={254} className={cn(inputClass, "h-11")} aria-invalid={invalid("contactEmail")} aria-describedby={describedBy("contactEmail")} />
          <FieldError id={errId("contactEmail")} messages={errors.contactEmail} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid("company")} className="mb-1.5 block text-sm font-medium">
            Company or organisation
          </label>
          <input id={fid("company")} name="company" autoComplete="organization" maxLength={160} className={cn(inputClass, "h-11")} aria-invalid={invalid("company")} aria-describedby={describedBy("company")} />
          <FieldError id={errId("company")} messages={errors.company} />
        </div>
      </fieldset>

      {/* Honeypot: hidden from people and assistive technology; bots that fill it are rejected server-side. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor={fid("website")}>Leave this field empty</label>
        <input id={fid("website")} name="website" type="text" tabIndex={-1} autoComplete="off" data-testid="honeypot" />
      </div>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-3 font-mono text-xs tracking-widest text-muted-foreground uppercase">What you need</legend>
        <div>
          <label htmlFor={fid("family")} className="mb-1.5 block text-sm font-medium">
            Kind of system
          </label>
          <select id={fid("family")} name="family" defaultValue={defaults.family ?? ""} className={selectClass}>
            <option value="">Not sure</option>
            {FAMILY_LIST.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} — {f.tagline}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={fid("foundation")} className="mb-1.5 block text-sm font-medium">
            Area
          </label>
          <select id={fid("foundation")} name="foundation" defaultValue={defaults.foundation ?? ""} className={selectClass}>
            <option value="">Not sure</option>
            {FOUNDATION_LIST.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid("problem")} className="mb-1.5 block text-sm font-medium">
            What should the system do? <span className="text-muted-foreground">(required)</span>
          </label>
          <p id={`${uid}-problem-hint`} className="mb-1.5 text-sm text-muted-foreground">
            Describe the work and who it is for. Please do not include passwords, keys or other secrets.
          </p>
          <textarea id={fid("problem")} name="problem" rows={5} maxLength={4000} className={cn(inputClass, "py-2.5")} aria-invalid={invalid("problem")} aria-describedby={describedBy("problem", true)} />
          <FieldError id={errId("problem")} messages={errors.problem} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={fid("outcomes")} className="mb-1.5 block text-sm font-medium">
            How will you know it works?
          </label>
          <textarea id={fid("outcomes")} name="outcomes" rows={3} maxLength={2000} className={cn(inputClass, "py-2.5")} aria-invalid={invalid("outcomes")} aria-describedby={describedBy("outcomes")} />
          <FieldError id={errId("outcomes")} messages={errors.outcomes} />
        </div>
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-3">
        <legend className="mb-3 font-mono text-xs tracking-widest text-muted-foreground uppercase">Constraints</legend>
        <div>
          <label htmlFor={fid("dataSensitivity")} className="mb-1.5 block text-sm font-medium">
            Data involved <span className="text-muted-foreground">(required)</span>
          </label>
          <select id={fid("dataSensitivity")} name="dataSensitivity" defaultValue="" className={selectClass} aria-invalid={invalid("dataSensitivity")} aria-describedby={describedBy("dataSensitivity")}>
            <option value="" disabled>
              Choose…
            </option>
            {DATA_SENSITIVITY.map((v) => (
              <option key={v} value={v}>
                {SENSITIVITY_LABELS[v]}
              </option>
            ))}
          </select>
          <FieldError id={errId("dataSensitivity")} messages={errors.dataSensitivity} />
        </div>
        <div>
          <label htmlFor={fid("timeline")} className="mb-1.5 block text-sm font-medium">
            Timeline <span className="text-muted-foreground">(required)</span>
          </label>
          <select id={fid("timeline")} name="timeline" defaultValue="" className={selectClass} aria-invalid={invalid("timeline")} aria-describedby={describedBy("timeline")}>
            <option value="" disabled>
              Choose…
            </option>
            {TIMELINES.map((v) => (
              <option key={v} value={v}>
                {TIMELINE_LABELS[v]}
              </option>
            ))}
          </select>
          <FieldError id={errId("timeline")} messages={errors.timeline} />
        </div>
        <div>
          <label htmlFor={fid("budgetRange")} className="mb-1.5 block text-sm font-medium">
            Budget <span className="text-muted-foreground">(required)</span>
          </label>
          <select id={fid("budgetRange")} name="budgetRange" defaultValue="" className={selectClass} aria-invalid={invalid("budgetRange")} aria-describedby={describedBy("budgetRange")}>
            <option value="" disabled>
              Choose…
            </option>
            {BUDGET_RANGES.map((v) => (
              <option key={v} value={v}>
                {BUDGET_LABELS[v]}
              </option>
            ))}
          </select>
          <FieldError id={errId("budgetRange")} messages={errors.budgetRange} />
        </div>
      </fieldset>

      <div>
        <div className="flex items-start gap-3">
          <input
            id={fid("consent")}
            name="consent"
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
            aria-invalid={invalid("consent")}
            aria-describedby={describedBy("consent")}
          />
          <label htmlFor={fid("consent")} className="text-sm">
            You may contact me about this request. I have read the{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              privacy notice
            </Link>
            . <span className="text-muted-foreground">(required)</span>
          </label>
        </div>
        <FieldError id={errId("consent")} messages={errors.consent} />
      </div>

      <Button type="submit" disabled={pending} className="h-12 w-full px-6 text-base sm:w-auto">
        {pending && <Loader2Icon aria-hidden="true" className="animate-spin" />}
        {pending ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}

/** Human wording for the schema's default messages. */
function friendly(key: string, message: string): string {
  switch (key) {
    case "contactName":
      return "Please enter your name.";
    case "contactEmail":
      return "Please enter a valid email address.";
    case "problem":
      return "Please describe what the system should do (at least 20 characters).";
    case "dataSensitivity":
      return "Please choose the kind of data involved.";
    case "timeline":
      return "Please choose a timeline.";
    case "budgetRange":
      return "Please choose a budget range.";
    case "consent":
      return "Please confirm we may contact you about this request.";
    case "website":
      return "Submission rejected.";
    default:
      return message;
  }
}
