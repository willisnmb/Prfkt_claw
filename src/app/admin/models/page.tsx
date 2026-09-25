import type { Metadata } from "next";
import { AdminPageHeader, RequireDatabase } from "@/components/admin/admin-page";
import { EnabledToggle } from "@/components/admin/registry-forms";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import { listModels } from "@/server/data/admin";

export const metadata: Metadata = { title: "Models" };

export default async function AdminModelsPage() {
  await requireOwner();
  return (
    <>
      <AdminPageHeader
        title="Model policies"
        description="Routing policies offered to customers. No policy may fall back to a paid route silently; escalation always needs a recorded approval."
      />
      <RequireDatabase>
        <Models />
      </RequireDatabase>
    </>
  );
}

async function Models() {
  const rows = await listModels(getSql());
  return (
    <ul className="space-y-3">
      {rows.map((m) => (
        <li key={m.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">
                {m.label} <span className="font-mono text-xs text-muted-foreground">({m.id})</span>
              </p>
              <p className="text-sm text-muted-foreground">{m.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Routes: {m.routes.join(" → ")} · {m.may_incur_managed_cost ? "may incur managed cost (metered, capped)" : "no managed cost"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={m.enabled ? "ACTIVE" : "disabled"} />
              <EnabledToggle id={m.id} enabled={m.enabled} kind="model" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
