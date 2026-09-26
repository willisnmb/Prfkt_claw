import type { Metadata } from "next";
import { AdminEmpty, AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { FlagToggle } from "@/components/admin/registry-forms";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { checkStripeKey } from "@/billing/stripe";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { isSupabaseAuthConfigured, serverEnv } from "@/server/env";
import { databaseHealth, listBackupRuns, listFlagViews, listSystemEvents } from "@/server/data/admin";

export const metadata: Metadata = { title: "System" };

export default async function AdminSystemPage() {
  await requireOwner();
  const env = serverEnv();
  const stripeKey = checkStripeKey(env.STRIPE_SECRET_KEY, env.STRIPE_ALLOW_LIVE);
  const checks = [
    { label: "Supabase Auth configured", ok: isSupabaseAuthConfigured(env) },
    { label: "Owner list configured", ok: env.ADMIN_EMAILS.length > 0 },
    { label: "Control-plane database (DATABASE_URL)", ok: Boolean(env.DATABASE_URL) },
    { label: "Payment webhook secret", ok: Boolean(env.PAYMENT_WEBHOOK_SECRET), note: "only needed once billing is enabled" },
    { label: "Stripe secret key", ok: stripeKey.ok, note: stripeKey.ok ? `${stripeKey.mode} mode` : env.STRIPE_SECRET_KEY ? "refused: live key or wrong format" : "only needed once billing is enabled" },
    { label: "Stripe webhook secret", ok: Boolean(env.STRIPE_WEBHOOK_SECRET), note: "for /api/flow/webhooks/stripe" },
    { label: "Local model route (OLLAMA_BASE_URL)", ok: Boolean(env.OLLAMA_BASE_URL), note: "optional" },
  ];
  return (
    <>
      <AdminPageHeader title="System" description="Feature flags, configuration health, backups and operational events." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Configuration</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {checks.map((c) => (
                <li key={c.label} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {c.label}
                    {c.note ? <span className="text-muted-foreground"> ({c.note})</span> : null}
                  </span>
                  <StatusBadge status={c.ok ? "connected" : "not-configured"} />
                </li>
              ))}
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>BILLING_ENABLED (ceiling)</span>
                <StatusBadge status={env.BILLING_ENABLED ? "APPROVED" : "disabled"} />
              </li>
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>PROVISIONING_ENABLED (ceiling)</span>
                <StatusBadge status={env.PROVISIONING_ENABLED ? "APPROVED" : "disabled"} />
              </li>
            </ul>
          </CardContent>
        </Card>
        <RequireDatabase>
          <DbHealth />
        </RequireDatabase>
      </div>
      <RequireDatabase>
        <SystemData />
      </RequireDatabase>
    </>
  );
}

async function DbHealth() {
  const h = await databaseHealth(getSql());
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Database</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="flex items-center justify-between gap-2">
          Reachable <StatusBadge status={h.ok ? "healthy" : "down"} />
        </p>
        <p className="flex items-center justify-between gap-2">
          Round trip <span className="font-mono">{h.latencyMs} ms</span>
        </p>
        <p className="flex items-center justify-between gap-2">
          Applied migrations <span className="font-mono">{h.migrations ?? "unknown"}</span>
        </p>
      </CardContent>
    </Card>
  );
}

async function SystemData() {
  const sql = getSql();
  const env = serverEnv();
  const [flags, backups, events] = await Promise.all([listFlagViews(sql, env), listBackupRuns(sql), listSystemEvents(sql, 50)]);
  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="flags-h">
        <h2 id="flags-h" className="mb-3 text-lg font-semibold">
          Feature flags
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          For billing and provisioning the environment variable is a hard ceiling: the stored flag can only narrow what the deployment allows.
        </p>
        <ul className="space-y-2">
          {flags.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-mono text-sm">{f.key}</p>
                <p className="text-xs text-muted-foreground">{f.description}</p>
                <p className="mt-1 text-xs">
                  Stored: {f.stored ? "on" : "off"} · Effective: <strong>{f.effective ? "on" : "off"}</strong>
                </p>
              </div>
              <FlagToggle flagKey={f.key} stored={f.stored} ceiling={f.envCeiling} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="backups-h">
        <h2 id="backups-h" className="mb-3 text-lg font-semibold">
          Backups
        </h2>
        <p className="mb-3 text-sm text-warning">
          Platform backups (Supabase PITR) are configured and restore-tested outside this app. Until a restore drill is recorded, backup state is unverified.
        </p>
        {backups.length === 0 ? (
          <AdminEmpty>No backup runs recorded.</AdminEmpty>
        ) : (
          <ul className="space-y-2 text-sm">
            {backups.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                <span>
                  {b.kind} {b.tenant_id ? <span className="font-mono text-xs">· {b.tenant_id.slice(0, 8)}</span> : null} · {b.row_count ?? "?"} rows ·{" "}
                  {fmtDate(b.started_at)}
                </span>
                <StatusBadge status={b.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="events" aria-labelledby="events-h">
        <h2 id="events-h" className="mb-3 text-lg font-semibold">
          System events
        </h2>
        {events.length === 0 ? (
          <AdminEmpty>No events.</AdminEmpty>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                <span className="min-w-0">
                  <span className="font-mono text-xs">{e.kind}</span> · {e.message}
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <StatusBadge status={e.severity === "info" ? "none" : e.severity === "warning" ? "degraded" : "failed"} />
                  {fmtDate(e.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
