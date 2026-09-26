import { Check, CircleDot, Clock, OctagonAlert, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { APPROVAL_GATES, FLOW01_STATES, TERMINAL_STATES, type Flow01State } from "@/flow/flow01/definition";
import type { ApprovalRow, FlowRun, RunStatus } from "@/flow/flow01/store";

const MAIN_PATH: Flow01State[] = [
  "NEW_LEAD", "SOURCE_VERIFICATION", "RESEARCH", "RESEARCH_COMPLETE", "QUALIFICATION_REVIEW", "QUALIFIED", "PROPOSAL_DRAFT",
  "WAITING_FOR_APPROVAL", "APPROVED_FOR_SEND", "SEND_REQUESTED", "SENT", "WAITING_FOR_REPLY", "CUSTOMER_ACCEPTED",
  "PAYMENT_CONFIRMATION", "PAYMENT_CONFIRMED", "PROVISIONING_REVIEW", "PROVISIONING", "CONFIG_VALIDATION", "ACCEPTANCE_TEST",
  "DEPLOYMENT_APPROVAL", "ACTIVE",
];
const BRANCHES: Flow01State[] = FLOW01_STATES.filter((s) => !MAIN_PATH.includes(s));

export const label = (s: string) => s.toLowerCase().replaceAll("_", " ");

const STATUS_TONE: Record<RunStatus, string> = {
  running: "border-chart-2/50 text-chart-2",
  retry_wait: "border-warning/50 text-warning",
  waiting_approval: "border-primary/60 text-primary",
  waiting_event: "border-chart-2/50 text-chart-2",
  waiting_timer: "border-chart-2/50 text-chart-2",
  failed: "border-destructive/60 text-destructive",
  blocked: "border-destructive/60 text-destructive",
  completed: "border-success/60 text-success",
  closed: "border-border text-muted-foreground",
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[0.7rem] uppercase", STATUS_TONE[status])}>
      {status.replace("_", " ")}
    </Badge>
  );
}

/** Progress along the Lead-to-Customer path; visited branch states are shown separately. */
export function FlowStateRail({ run, visited }: { run: FlowRun; visited: Set<string> }) {
  const current = run.currentState;
  const troubled = run.status === "failed" || run.status === "blocked";
  return (
    <div>
      <ol className="flex flex-wrap gap-1.5" aria-label="Workflow states">
        {MAIN_PATH.map((s) => {
          const isCurrent = s === current;
          const done = visited.has(s) && !isCurrent;
          return (
            <li
              key={s}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[0.68rem] uppercase",
                isCurrent && !troubled && "border-primary bg-primary/10 text-primary",
                isCurrent && troubled && "border-destructive bg-destructive/10 text-destructive",
                done && "border-success/40 text-success",
                !isCurrent && !done && "border-border text-muted-foreground/70",
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : isCurrent ? (troubled ? <OctagonAlert className="size-3" aria-hidden /> : <CircleDot className="size-3" aria-hidden />) : null}
              {label(s)}
              <span className="sr-only">{done ? " (done)" : isCurrent ? " (current)" : " (not reached)"}</span>
            </li>
          );
        })}
      </ol>
      {BRANCHES.some((b) => visited.has(b) || b === current) && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Branches taken:
          {BRANCHES.filter((b) => visited.has(b) || b === current).map((b) => (
            <span key={b} className={cn("rounded border px-1.5 py-0.5 font-mono uppercase", b === current ? "border-primary text-primary" : "border-border")}>
              {label(b)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 120) return `${s.toFixed(1)} s`;
  const m = s / 60;
  if (m < 120) return `${m.toFixed(1)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export function MetricsGrid({ run, now }: { run: FlowRun; now: Date }) {
  const m = run.metrics;
  const duration = (run.completedAt ?? now).getTime() - run.createdAt.getTime();
  const items: [string, string][] = [
    ["Duration", fmtDuration(duration)],
    ["Active compute", fmtDuration(m.activeComputeMs)],
    ["Model calls", String(m.modelCalls)],
    ["Tokens in / out", `${m.tokensIn.toLocaleString()} / ${m.tokensOut.toLocaleString()}`],
    ["Estimated cost", `$${(m.estCostMicroUsd / 1_000_000).toFixed(4)}`],
    ["Retries", String(m.retriesTotal)],
    ["Approvals", String(m.approvalsTotal)],
    ["Failures", String(m.failuresTotal)],
    ["Recoveries", String(m.recoveryCount)],
    ["Duplicates suppressed", String(m.duplicatesSuppressed)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
      {items.map(([k, v]) => (
        <div key={k} className="bg-card p-3">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 font-mono text-sm tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ResumeStatus({ run, now, maxRetries }: { run: FlowRun; now: Date; maxRetries: number }) {
  const leaseLive = run.leaseOwner && run.leaseExpiresAt && run.leaseExpiresAt > now;
  const rows: [string, React.ReactNode][] = [
    ["Status", <RunStatusBadge key="s" status={run.status} />],
    ["State version", <span key="v" className="font-mono">{run.stateVersion}</span>],
    [
      "Worker lease",
      run.leaseOwner ? (
        <span key="l" className="font-mono text-xs">
          {run.leaseOwner} {leaseLive ? "(active)" : "(stale — next worker will recover)"}
        </span>
      ) : (
        <span key="l" className="text-muted-foreground">none (idle)</span>
      ),
    ],
    ["Retries this step", <span key="r" className="font-mono">{run.retryCount} / {maxRetries}</span>],
    ["Next attempt", run.nextAttemptAt ? <span key="n" className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{run.nextAttemptAt.toISOString()}</span> : "—"],
    ["Recovered after crash", <span key="c" className="inline-flex items-center gap-1 font-mono"><RotateCcw className="size-3" aria-hidden />{run.metrics.recoveryCount}×</span>],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ApprovalSummary({ approval }: { approval: ApprovalRow }) {
  const gate = APPROVAL_GATES[approval.kind];
  const p = approval.payload as Record<string, unknown>;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-medium">{gate.label}</span>{" "}
        <span className="font-mono text-xs text-muted-foreground">({approval.kind} · {approval.actionClass})</span>
      </p>
      {approval.kind === "PROPOSAL_SEND" ? (
        <div className="rounded-md border border-border bg-background/60 p-3 text-sm">
          <p><span className="text-muted-foreground">To:</span> <span className="break-all font-mono">{String(p.to)}</span></p>
          <p><span className="text-muted-foreground">Subject:</span> {String(p.subject)}</p>
          <p className="text-muted-foreground">Revision {String(p.revision)}{Number(p.followUp) > 0 ? ` · follow-up ${String(p.followUp)}` : ""}</p>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm">{String(p.body)}</pre>
        </div>
      ) : (
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background/60 p-3 text-xs">{JSON.stringify(p, null, 2)}</pre>
      )}
      <p className="font-mono text-[0.7rem] break-all text-muted-foreground">Bound to payload sha256 {approval.payloadHash}</p>
    </div>
  );
}

export const isTerminal = (s: Flow01State) => TERMINAL_STATES.includes(s);
