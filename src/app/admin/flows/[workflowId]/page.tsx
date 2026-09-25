import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminEmpty, AdminPageHeader, RequireDatabase, fmtDate } from "@/components/admin/admin-page";
import { ApprovalDecisionForm, RetryRunForm } from "@/components/flows/flow-forms";
import { ApprovalSummary, FlowStateRail, MetricsGrid, ResumeStatus, RunStatusBadge, label } from "@/components/flows/flow-views";
import { Badge } from "@/components/ui/badge";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { getRunDetail } from "@/flow/flow01/queries";
import { getFlow01Availability } from "@/flow/flow01/wiring";
import { FLOW01_POLICY } from "@/flow/flow01/definition";

export const metadata: Metadata = { title: "Flow run" };

export default async function FlowRunPage({ params }: PageProps<"/admin/flows/[workflowId]">) {
  await requireOwner();
  const { workflowId } = await params;
  if (!z.uuid().safeParse(workflowId).success) notFound();
  return (
    <RequireDatabase>
      <RunDetail workflowId={workflowId} />
    </RequireDatabase>
  );
}

async function RunDetail({ workflowId }: { workflowId: string }) {
  const d = await getRunDetail(getSql(), workflowId);
  if (!d) notFound();
  const { run, events, evidence, approvals, sideEffects, audit } = d;
  const now = new Date();
  const visited = new Set(events.filter((e) => e.type === "transition").flatMap((e) => [e.from_state ?? "", e.to_state ?? ""]));
  visited.add("NEW_LEAD");
  const pending = approvals.find((a) => a.status === "pending");
  const canAct = getFlow01Availability().enabled;
  const history = events.filter((e) => e.actor !== "system");

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/flows" className="text-muted-foreground hover:text-foreground">
          ← All runs
        </Link>
      </p>
      <AdminPageHeader title={`${run.lead.company}`} description={<span className="font-mono text-xs break-all">{run.workflowId}</span>}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm uppercase">{label(run.currentState)}</span>
          <RunStatusBadge status={run.status} />
        </div>
      </AdminPageHeader>

      <div className="space-y-8">
        <section aria-labelledby="state-h">
          <h2 id="state-h" className="sr-only">Current state</h2>
          <FlowStateRail run={run} visited={visited} />
        </section>

        {run.lastError && (
          <section role="alert" className="rounded-lg border border-destructive/60 bg-destructive/5 p-4">
            <h2 className="font-medium text-destructive">Last error</h2>
            <p className="mt-1 text-sm break-words">{run.lastError}</p>
            {(run.status === "failed" || run.status === "blocked") && canAct && (
              <div className="mt-3">
                <RetryRunForm workflowId={run.workflowId} />
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="approval-h" className="rounded-lg border border-border bg-card p-4">
          <h2 id="approval-h" className="mb-3 text-lg font-semibold">
            Pending approval
          </h2>
          {pending ? (
            <div className="space-y-4">
              <ApprovalSummary approval={pending} />
              {canAct ? <ApprovalDecisionForm approvalId={pending.id} workflowId={run.workflowId} /> : <p className="text-sm text-muted-foreground">Decisions are disabled in this environment.</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is waiting for you.</p>
          )}
        </section>

        <section aria-labelledby="resume-h">
          <h2 id="resume-h" className="mb-3 text-lg font-semibold">
            Resume status
          </h2>
          <ResumeStatus run={run} now={now} maxRetries={FLOW01_POLICY.limits.maxRetries} />
        </section>

        <section aria-labelledby="metrics-h">
          <h2 id="metrics-h" className="mb-3 text-lg font-semibold">
            Metrics
          </h2>
          <MetricsGrid run={run} now={now} />
        </section>

        <section aria-labelledby="timeline-h">
          <h2 id="timeline-h" className="mb-3 text-lg font-semibold">
            Timeline
          </h2>
          <ol className="relative space-y-3 border-l border-border pl-4">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border border-border bg-background" aria-hidden />
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono text-xs text-muted-foreground">{fmtDate(e.created_at.toISOString())}</span>
                  <span className="font-medium">{e.type.replaceAll("_", " ")}</span>
                  {e.to_state && (
                    <span className="font-mono text-xs uppercase">
                      {e.from_state ? `${label(e.from_state)} → ` : ""}
                      {label(e.to_state)}
                    </span>
                  )}
                  {e.actor !== "system" && <span className="text-xs text-muted-foreground">by {e.actor}</span>}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="evidence-h">
          <h2 id="evidence-h" className="mb-3 text-lg font-semibold">
            Evidence
          </h2>
          {evidence.length === 0 ? (
            <AdminEmpty>No evidence recorded yet.</AdminEmpty>
          ) : (
            <ul className="space-y-2">
              {evidence.map((x) => (
                <li key={x.id} className="rounded-lg border border-border bg-card p-3">
                  <details>
                    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2">
                      <span className="font-mono text-xs uppercase">{x.kind.replaceAll("_", " ")}</span>
                      {x.passed === true && <Badge variant="outline" className="border-success/60 text-success">passed</Badge>}
                      {x.passed === false && <Badge variant="outline" className="border-destructive/60 text-destructive">failed</Badge>}
                      <span className="text-xs text-muted-foreground">{fmtDate(x.created_at.toISOString())}</span>
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded bg-background/60 p-2 text-xs">{JSON.stringify(x.content, null, 2)}</pre>
                    <p className="mt-1 font-mono text-[0.68rem] break-all text-muted-foreground">sha256 {x.content_hash}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ledger-h">
          <h2 id="ledger-h" className="mb-3 text-lg font-semibold">
            Side-effect ledger
          </h2>
          {sideEffects.length === 0 ? (
            <AdminEmpty>No external side effects yet.</AdminEmpty>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {sideEffects.map((s) => (
                <li key={s.idempotency_key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                  <span className="font-mono text-xs">
                    {s.adapter}.{s.operation}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span>attempts {Number(s.attempts)}</span>
                    <Badge variant="outline">{s.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="audit-h">
          <h2 id="audit-h" className="mb-3 text-lg font-semibold">
            Audit history
          </h2>
          {history.length === 0 && audit.length === 0 ? (
            <AdminEmpty>No human or webhook actions yet.</AdminEmpty>
          ) : (
            <ul className="space-y-1 text-sm">
              {history.map((e) => (
                <li key={`e-${e.id}`}>
                  <span className="font-mono text-xs text-muted-foreground">{fmtDate(e.created_at.toISOString())}</span> {e.type.replaceAll("_", " ")} — {e.actor}
                </li>
              ))}
              {audit.map((a) => (
                <li key={`a-${a.id}`}>
                  <span className="font-mono text-xs text-muted-foreground">{fmtDate(new Date(a.created_at).toISOString())}</span> {a.action} — {a.actor_email} <span className="text-xs text-muted-foreground">(admin audit log)</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
