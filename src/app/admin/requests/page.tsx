import type { Metadata } from "next";
import { AdminEmpty, AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { CompleteDeletionForm, CustomRequestForm, DeploymentReviewForm } from "@/components/admin/request-forms";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { listCustomRequests, listDeletionRequests, listDeploymentRequests } from "@/server/data/admin";

export const metadata: Metadata = { title: "Requests" };

export default async function AdminRequestsPage() {
  await requireOwner();
  return (
    <>
      <AdminPageHeader title="Requests" description="Deployment reviews, custom build requests and account deletions. Every decision is audited." />
      <RequireDatabase>
        <Requests />
      </RequireDatabase>
    </>
  );
}

async function Requests() {
  const sql = getSql();
  const [deployments, custom, deletions] = await Promise.all([listDeploymentRequests(sql), listCustomRequests(sql), listDeletionRequests(sql)]);
  return (
    <div className="space-y-10">
      <section id="deployments" aria-labelledby="deployments-h">
        <h2 id="deployments-h" className="mb-3 text-lg font-semibold">
          Deployment reviews
        </h2>
        {deployments.length === 0 ? (
          <AdminEmpty>No deployment requests.</AdminEmpty>
        ) : (
          <ul className="space-y-3">
            {deployments.map((d) => (
              <li key={d.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {d.configuration_name} <span className="text-muted-foreground">· {d.tenant_name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {String(d.recommendation.family ?? "")} · {String(d.recommendation.modelPolicy ?? "")} · {String(d.recommendation.compute ?? "")} ·{" "}
                      {String(d.recommendation.deployment ?? "")} · requested {fmtDate(d.created_at)}
                    </p>
                    {d.customer_note && <p className="mt-2 text-sm">Customer: {d.customer_note}</p>}
                    {d.review_note && <p className="mt-1 text-sm text-muted-foreground">Review: {d.review_note}</p>}
                  </div>
                  <div className="flex gap-1">
                    <StatusBadge status={d.status} />
                    {d.job_status && <StatusBadge status={d.job_status} />}
                  </div>
                </div>
                {d.status === "PENDING_REVIEW" && (
                  <div className="mt-3">
                    <DeploymentReviewForm id={d.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="custom" aria-labelledby="custom-h">
        <h2 id="custom-h" className="mb-3 text-lg font-semibold">
          Custom build requests
        </h2>
        {custom.length === 0 ? (
          <AdminEmpty>No custom requests.</AdminEmpty>
        ) : (
          <ul className="space-y-3">
            {custom.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm">{c.reference}</p>
                    <p className="font-medium">
                      {c.contact_name} <span className="text-muted-foreground break-all">· {c.contact_email}</span>
                      {c.company ? <span className="text-muted-foreground"> · {c.company}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[c.family, c.foundation_id, c.catalog_slug].filter(Boolean).join(" · ") || "No family selected"} · {c.data_sensitivity} · {c.timeline} ·{" "}
                      {c.budget_range} · {fmtDate(c.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                {/* Customer-supplied text is rendered as plain text only. */}
                <p className="mt-2 text-sm whitespace-pre-wrap">{c.problem}</p>
                {!["DECLINED", "CONVERTED"].includes(c.status) && (
                  <div className="mt-3">
                    <CustomRequestForm id={c.id} status={c.status} ownerNotes={c.owner_notes} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="deletions" aria-labelledby="deletions-h">
        <h2 id="deletions-h" className="mb-3 text-lg font-semibold">
          Account deletion requests
        </h2>
        {deletions.length === 0 ? (
          <AdminEmpty>No deletion requests.</AdminEmpty>
        ) : (
          <ul className="space-y-3">
            {deletions.map((d) => (
              <li key={d.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium break-all">{d.email ?? d.user_id}</p>
                    <p className="text-xs text-muted-foreground">Requested {fmtDate(d.created_at)}</p>
                    {d.reason && <p className="mt-1 text-sm">{d.reason}</p>}
                  </div>
                  <StatusBadge status={d.status} />
                </div>
                {d.status === "REQUESTED" && (
                  <div className="mt-3">
                    <CompleteDeletionForm id={d.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
