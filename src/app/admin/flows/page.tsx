import type { Metadata } from "next";
import Link from "next/link";
import { AdminEmpty, AdminPageHeader, RequireDatabase, fmtDate } from "@/components/admin/admin-page";
import { StartRunForm } from "@/components/flows/flow-forms";
import { RunStatusBadge, label } from "@/components/flows/flow-views";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { listRunsForAdmin } from "@/flow/flow01/queries";
import { getFlow01Availability } from "@/flow/flow01/wiring";
import { ALLOWED_LEAD_SOURCES } from "@/flow/flow01/definition";

export const metadata: Metadata = { title: "Flows" };

export default async function AdminFlowsPage() {
  await requireOwner();
  const availability = getFlow01Availability();
  const headline = !availability.enabled
    ? "FLOW 01 is not running here"
    : availability.payment === "stripe"
      ? "Running with Stripe payments; email, research and provisioning are fakes"
      : "Running with fake side-effect adapters";
  return (
    <>
      <AdminPageHeader
        title="FLOW 01 — Lead to customer"
        description="Durable workflow runs. Every send, payment confirmation, provisioning and activation waits for your approval; runs resume from the database after any restart."
      />
      <div role="status" className={availability.enabled ? "mb-6 rounded-lg border border-border bg-card p-4 text-sm" : "mb-6 rounded-lg border border-dashed border-warning/60 p-4 text-sm"}>
        <p className="font-medium">{headline}</p>
        <p className="mt-1 text-muted-foreground">{availability.reason}</p>
      </div>
      <RequireDatabase>
        {availability.enabled && (
          <section aria-labelledby="start-h" className="mb-8 rounded-lg border border-border bg-card p-4">
            <h2 id="start-h" className="mb-3 text-lg font-semibold">
              Start a run
            </h2>
            <StartRunForm sources={ALLOWED_LEAD_SOURCES} />
          </section>
        )}
        <Runs />
      </RequireDatabase>
    </>
  );
}

async function Runs() {
  const runs = await listRunsForAdmin(getSql());
  if (runs.length === 0) return <AdminEmpty>No FLOW 01 runs yet.</AdminEmpty>;
  return (
    <section aria-labelledby="runs-h">
      <h2 id="runs-h" className="mb-3 text-lg font-semibold">
        Runs
      </h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {runs.map((r) => (
          <li key={r.workflowId}>
            <Link href={`/admin/flows/${r.workflowId}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-accent/40 focus-visible:bg-accent/40">
              <span className="min-w-0">
                <span className="font-medium">{r.lead.company}</span>{" "}
                <span className="text-sm text-muted-foreground">· {r.lead.name}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {r.workflowId.slice(0, 8)} · v{r.stateVersion} · updated {fmtDate(r.updatedAt.toISOString())}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs uppercase">{label(r.currentState)}</span>
                <RunStatusBadge status={r.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
