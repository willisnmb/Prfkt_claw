import type { Metadata } from "next";
import { AdminPageHeader, fmtDate, RequireDatabase } from "@/components/admin/admin-page";
import { RuntimeStatusForm } from "@/components/admin/registry-forms";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { NON_RUNTIME_REFERENCES } from "@/domain/registries";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { listRuntimes } from "@/server/data/admin";

export const metadata: Metadata = { title: "Runtimes" };

export default async function AdminRuntimesPage() {
  await requireOwner();
  return (
    <>
      <AdminPageHeader
        title="Runtimes"
        description="Runtime registry. Status is an owner assertion — set 'connected' only with adapter acceptance evidence, and record it in the notes."
      />
      <RequireDatabase>
        <Runtimes />
      </RequireDatabase>
      <section className="mt-10" aria-labelledby="refs-h">
        <h2 id="refs-h" className="mb-3 text-lg font-semibold">
          Deliberately not customer runtimes
        </h2>
        <ul className="space-y-2">
          {NON_RUNTIME_REFERENCES.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-4">
              <p className="font-medium">{r.label}</p>
              <p className="text-sm text-muted-foreground">{r.role}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

async function Runtimes() {
  const rows = await listRuntimes(getSql());
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">
                {r.label} <span className="font-mono text-xs text-muted-foreground">({r.id})</span>
              </p>
              <p className="text-sm text-muted-foreground">{r.role}</p>
              <p className="text-xs text-muted-foreground">
                Isolation: {r.isolation} · updated {fmtDate(r.updated_at)}
              </p>
            </div>
            <StatusBadge status={r.status} />
          </div>
          <div className="mt-3">
            <RuntimeStatusForm id={r.id} status={r.status} notes={r.notes} />
          </div>
        </li>
      ))}
    </ul>
  );
}
