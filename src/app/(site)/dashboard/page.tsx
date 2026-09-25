import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  CancelDeletionForm,
  CancelDeploymentForm,
  RequestDeletionForm,
  RequestDeploymentForm,
} from "@/components/dashboard/dashboard-forms";
import { EmptyState } from "@/components/dashboard/empty-state";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/user";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured } from "@/server/env";
import { loadCustomerDashboard } from "@/server/data/customer";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

// Per-user, per-request. Never prerender: auth may be configured only at runtime.
export const dynamic = "force-dynamic";

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");

  if (!isDatabaseConfigured()) {
    return (
      <Shell email={user.email}>
        <EmptyState title="Your workspace isn't connected yet" body="This environment has no database connected, so saved configurations and requests can't be shown." />
      </Shell>
    );
  }

  const d = await loadCustomerDashboard(getSql(), user.id);
  const pendingByConfig = new Set(d.deploymentRequests.filter((r) => r.status === "PENDING_REVIEW").map((r) => r.configuration_id));

  return (
    <Shell email={user.email} tenant={d.tenant?.name}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              <h2>Saved configurations</h2>
            </CardTitle>
            <CardDescription>Configurator results saved to your workspace. Request a deployment to send one for owner review.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.configurations.length === 0 ? (
              <EmptyState
                title="No configurations yet"
                body="Answer a few questions in the configurator and save the recommendation here."
                action={{ href: "/configure", label: "Open the configurator" }}
              />
            ) : (
              <ul className="divide-y divide-border">
                {d.configurations.map((c) => (
                  <li key={c.id} className="grid gap-3 py-4 md:grid-cols-[1fr_minmax(0,22rem)]">
                    <div className="min-w-0">
                      <p className="font-medium">{c.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {c.recommendation.family} · {c.recommendation.modelPolicy} · {c.recommendation.compute} · {c.recommendation.deployment} ·{" "}
                        {c.recommendation.profile} profile
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Saved {fmt(c.created_at)}</p>
                    </div>
                    <div>
                      {pendingByConfig.has(c.id) ? (
                        <p className="text-sm text-muted-foreground">
                          <StatusBadge status="PENDING_REVIEW" /> Awaiting owner review
                        </p>
                      ) : (
                        <RequestDeploymentForm configurationId={c.id} configurationName={c.name} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Deployment requests</h2>
            </CardTitle>
            <CardDescription>Every deployment is reviewed by a person before anything is provisioned.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.deploymentRequests.length === 0 ? (
              <EmptyState title="No deployment requests" body="Request a deployment from a saved configuration." />
            ) : (
              <ul className="divide-y divide-border">
                {d.deploymentRequests.map((r) => (
                  <li key={r.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{r.configuration_name ?? "Configuration"}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Requested {fmt(r.created_at)}
                      {r.reviewed_at ? ` · reviewed ${fmt(r.reviewed_at)}` : ""}
                    </p>
                    {r.review_note && <p className="text-sm">Reviewer: {r.review_note}</p>}
                    {r.status === "PENDING_REVIEW" && <CancelDeploymentForm id={r.id} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Runtime cells</h2>
            </CardTitle>
            <CardDescription>Your isolated runtime cells. One trust boundary per customer; never shared.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.cells.length === 0 ? (
              <EmptyState title="No runtime cells" body="Cells appear here once an approved deployment is provisioned. Provisioning is currently review-gated." />
            ) : (
              <ul className="divide-y divide-border">
                {d.cells.map((c) => (
                  <li key={c.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-sm">{c.name}</p>
                      <div className="flex gap-1">
                        <StatusBadge status={c.status} />
                        <StatusBadge status={c.health} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.profile} profile · {c.model_policy} · {c.compute_class} · backup {c.backup_state} · last health {fmt(c.last_health_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Custom requests</h2>
            </CardTitle>
            <CardDescription>Requests you submitted while signed in.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.customRequests.length === 0 ? (
              <EmptyState title="No custom requests" body="Need something that isn't in the catalog?" action={{ href: "/custom", label: "Start a custom request" }} />
            ) : (
              <ul className="divide-y divide-border">
                {d.customRequests.map((r) => (
                  <li key={r.id} className="space-y-1 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-sm">{r.reference}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{r.problem}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Your data</h2>
            </CardTitle>
            <CardDescription>Export everything we hold for your workspace, or ask us to delete your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Button asChild variant="outline" className="min-h-11">
                <a href="/dashboard/export" download>
                  <DownloadIcon aria-hidden="true" /> Export my data (JSON)
                </a>
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">Last export: {fmt(d.lastExportAt)}</p>
            </div>
            {d.openDeletionRequest ? (
              <div className="space-y-2">
                <p className="text-sm">
                  <StatusBadge status="REQUESTED" /> Deletion requested {fmt(d.openDeletionRequest.created_at)}.
                </p>
                <CancelDeletionForm />
              </div>
            ) : (
              <details className="rounded-md border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">Delete my account</summary>
                <p className="mt-2 text-sm text-muted-foreground">
                  Deletion removes your account and, if you are its only member, your workspace with its configurations, requests, memory and cells. Export first if
                  you want a copy.
                </p>
                <div className="mt-4">
                  <RequestDeletionForm />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ email, tenant, children }: { email: string | null; tenant?: string; children: React.ReactNode }) {
  return (
    <div className="site-container py-10 sm:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{tenant ?? "Your workspace"}</h1>
          <p className="mt-1 text-sm break-all text-muted-foreground">{email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" className="min-h-11">
            <Link href="/configure">New configuration</Link>
          </Button>
          <SignOutButton />
        </div>
      </div>
      {children}
    </div>
  );
}
