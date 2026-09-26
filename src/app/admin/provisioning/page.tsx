import type { Metadata } from "next";
import { AdminEmpty, AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { CreateJobForm, JobActions } from "@/components/admin/registry-forms";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { serverEnv } from "@/server/env";
import { listCells, listDeploymentRequests, listProvisioningJobs } from "@/server/data/admin";
import { isFlagEnabled } from "@/server/flags";

export const metadata: Metadata = { title: "Provisioning" };

export default async function AdminProvisioningPage() {
  await requireOwner();
  const env = serverEnv();
  return (
    <>
      <AdminPageHeader
        title="Provisioning"
        description="Jobs exist only for owner-approved deployment requests. With the gate closed they are recorded as BLOCKED and nothing is provisioned."
      />
      {!env.PROVISIONING_ENABLED && (
        <Alert className="mb-6">
          <AlertTitle>Provisioning is disabled in this environment</AlertTitle>
          <AlertDescription>
            PROVISIONING_ENABLED=false. Keep it off until the runtime adapters pass acceptance (BUILD_INSTRUCTIONS §11). Jobs created now stay BLOCKED.
          </AlertDescription>
        </Alert>
      )}
      <RequireDatabase>
        <Provisioning />
      </RequireDatabase>
    </>
  );
}

async function Provisioning() {
  const sql = getSql();
  const [deployments, jobs, cells, gateOpen] = await Promise.all([
    listDeploymentRequests(sql),
    listProvisioningJobs(sql),
    listCells(sql),
    isFlagEnabled(sql, "provisioning_enabled", serverEnv()),
  ]);
  const approvedWithoutJob = deployments.filter((d) => d.status === "APPROVED" && !d.job_status);
  return (
    <div className="space-y-10">
      <section aria-labelledby="ready-h">
        <h2 id="ready-h" className="mb-3 text-lg font-semibold">
          Approved, not yet queued
        </h2>
        {approvedWithoutJob.length === 0 ? (
          <AdminEmpty>No approved deployment requests are waiting for a job.</AdminEmpty>
        ) : (
          <ul className="space-y-3">
            {approvedWithoutJob.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {d.configuration_name} <span className="text-muted-foreground">· {d.tenant_name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">Approved {fmtDate(d.reviewed_at)}</p>
                </div>
                <CreateJobForm deploymentRequestId={d.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="jobs-h">
        <h2 id="jobs-h" className="mb-3 text-lg font-semibold">
          Jobs
        </h2>
        {jobs.length === 0 ? (
          <AdminEmpty>No provisioning jobs.</AdminEmpty>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {j.tenant_name} <span className="font-mono text-xs text-muted-foreground">· {j.runtime}</span>
                  </p>
                  <StatusBadge status={j.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Created {fmtDate(j.created_at)} · attempts {j.attempts}
                  {j.blocked_reason ? ` · blocked: ${j.blocked_reason}` : ""}
                  {j.last_error ? ` · last error: ${j.last_error}` : ""}
                </p>
                <JobActions jobId={j.id} status={j.status} gateOpen={gateOpen} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="cells" aria-labelledby="cells-h">
        <h2 id="cells-h" className="mb-3 text-lg font-semibold">
          Runtime cells
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">One customer trust domain per cell. Secrets are stored as broker references only.</p>
        {cells.length === 0 ? (
          <AdminEmpty>No runtime cells exist yet.</AdminEmpty>
        ) : (
          <ul className="space-y-2">
            {cells.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.tenant_name} · {c.runtime} · {c.profile} · {c.secret_ref_count} secret ref(s) · backup {c.backup_state}
                  </p>
                </div>
                <div className="flex gap-1">
                  <StatusBadge status={c.status} />
                  <StatusBadge status={c.health} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
