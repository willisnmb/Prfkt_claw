import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { serverEnv } from "@/server/env";
import { listAudit, listSystemEvents, loadAdminOverview } from "@/server/data/admin";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  await requireOwner();
  const env = serverEnv();
  return (
    <>
      <AdminPageHeader title="Overview" description="What needs a decision, and the state of the control plane." />
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <span className="inline-flex items-center gap-2">
          Billing <StatusBadge status={env.BILLING_ENABLED ? "APPROVED" : "disabled"} />
        </span>
        <span className="inline-flex items-center gap-2">
          Provisioning <StatusBadge status={env.PROVISIONING_ENABLED ? "APPROVED" : "disabled"} />
        </span>
        <span className="text-muted-foreground">(environment ceilings)</span>
      </div>
      <RequireDatabase>
        <Overview />
      </RequireDatabase>
    </>
  );
}

async function Overview() {
  const sql = getSql();
  const [o, audit, events] = await Promise.all([loadAdminOverview(sql), listAudit(sql, { limit: 8 }), listSystemEvents(sql, 8)]);
  const tiles = [
    { label: "Deployments awaiting review", value: o.deploymentPending, href: "/admin/requests#deployments", urgent: o.deploymentPending > 0 },
    { label: "Open custom requests", value: o.customRequestsOpen, href: "/admin/requests#custom", urgent: false },
    { label: "Deletion requests", value: o.deletionPending, href: "/admin/requests#deletions", urgent: o.deletionPending > 0 },
    { label: "Provisioning jobs", value: o.provisioningJobs, href: "/admin/provisioning", urgent: false },
    { label: "Runtime cells", value: o.cells, href: "/admin/provisioning#cells", urgent: false },
    { label: "Catalog (published / total)", value: `${o.clawsPublished} / ${o.claws}`, href: "/admin/catalog", urgent: false },
    { label: "Warnings (24h)", value: o.warnings24h, href: "/admin/system#events", urgent: o.warnings24h > 0 },
    { label: "Audited owner actions (24h)", value: o.auditEntries24h, href: "/admin/audit", urgent: false },
  ];
  return (
    <div className="space-y-6">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link
              href={t.href}
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.urgent ? "text-warning" : ""}`}>{t.value}</p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Recent owner actions</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No owner actions recorded yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono">{a.action}</span>
                    <span className="text-muted-foreground">
                      {a.target_id ?? a.target_type} · {fmtDate(a.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Recent system events</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <StatusBadge status={e.severity === "info" ? "none" : e.severity === "warning" ? "degraded" : "failed"} className="mr-2" />
                      {e.message}
                    </span>
                    <span className="text-muted-foreground">{fmtDate(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
