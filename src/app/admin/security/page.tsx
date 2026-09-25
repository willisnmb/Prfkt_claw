import type { Metadata } from "next";
import { AdminEmpty, AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTION_CLASSES, HIGH_IMPACT_ACTIONS, RELEASE_GATES, RELEASE_GATE_LABELS } from "@/security/taxonomy";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { serverEnv } from "@/server/env";
import { listSystemEventsByKind } from "@/server/data/admin";

export const metadata: Metadata = { title: "Security" };

function mask(email: string) {
  const [local, domain] = email.split("@");
  return `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
}

export default async function AdminSecurityPage() {
  const owner = await requireOwner();
  const env = serverEnv();
  return (
    <>
      <AdminPageHeader title="Security" description="PRFKT SHIELD posture for the control plane. Source of truth: SECURITY.md." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Owner access</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Owner access requires a server-verified Supabase session, a confirmed email, and that email in <code className="font-mono">ADMIN_EMAILS</code>. It is
              checked on every admin request and action. There is no query-string key, cookie flag, header or client-side switch.
            </p>
            <p>
              Configured owners ({env.ADMIN_EMAILS.length}): {env.ADMIN_EMAILS.map(mask).join(", ") || "none"}. You are signed in as {owner.email}.
            </p>
            <p>Revoke an owner by removing the address from ADMIN_EMAILS; the next request is denied.</p>
            <p className="text-warning">Multi-factor authentication is not yet enforced for owners (tracked finding). Enable MFA in Supabase Auth before launch.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Action firewall</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="mb-2">Every action is classified; high-impact classes are never autonomous in customer catalog defaults.</p>
            <ul className="flex flex-wrap gap-1">
              {ACTION_CLASSES.map((a) => (
                <li key={a}>
                  <StatusBadge status={HIGH_IMPACT_ACTIONS.includes(a) ? "PENDING_REVIEW" : "none"} className="normal-case" />
                  <span className="sr-only">{HIGH_IMPACT_ACTIONS.includes(a) ? " (approval required)" : ""}</span>
                  <span className="ml-1 font-mono text-xs">{a}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              <h2>Release gates (required before READY)</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {RELEASE_GATES.map((g) => (
                <li key={g} className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
                  <span>{RELEASE_GATE_LABELS[g]}</span>
                  <span className="font-mono text-xs text-muted-foreground">{g}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Evidence is recorded per catalog item under Catalog. The database refuses READY until all eight gates have passing evidence.
            </p>
          </CardContent>
        </Card>
      </div>
      <section className="mt-8" aria-labelledby="denied-h">
        <h2 id="denied-h" className="mb-3 text-lg font-semibold">
          Recent denied owner access
        </h2>
        <RequireDatabase>
          <Denied />
        </RequireDatabase>
      </section>
    </>
  );
}

async function Denied() {
  const rows = await listSystemEventsByKind(getSql(), "admin.access_denied", 20);
  if (rows.length === 0) return <AdminEmpty>No denied owner-access attempts recorded.</AdminEmpty>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-border p-3">
          <span>{r.message}</span>
          <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
