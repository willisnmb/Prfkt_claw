import type { Metadata } from "next";
import { AdminPageHeader, RequireDatabase } from "@/components/admin/admin-page";
import { EnabledToggle } from "@/components/admin/registry-forms";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { listCompute } from "@/server/data/admin";

export const metadata: Metadata = { title: "Compute" };

export default async function AdminComputePage() {
  await requireOwner();
  return (
    <>
      <AdminPageHeader title="Compute classes" description="Cloud burst is metered by compute-time, never by model-file size." />
      <RequireDatabase>
        <Compute />
      </RequireDatabase>
    </>
  );
}

async function Compute() {
  const rows = await listCompute(getSql());
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((c) => (
        <li key={c.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{c.label}</p>
            <StatusBadge status={c.enabled ? "ACTIVE" : "disabled"} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {c.memory_gb ? `${c.memory_gb} GB` : "Memory varies"} · metering: {c.metering}
          </p>
          <div className="mt-3">
            <EnabledToggle id={c.id} enabled={c.enabled} kind="compute" />
          </div>
        </li>
      ))}
    </ul>
  );
}
