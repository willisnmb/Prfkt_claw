import type { Sql } from "../db/sql";
import { withUser } from "../db/sql";
import { primaryTenantIdForUser } from "./tenant";

/**
 * Customer data export (HANDOFF non-negotiable 7). Runs entirely as the user,
 * so RLS guarantees only their own tenant's rows are included. The owner's
 * private triage notes are excluded by column privileges.
 */
export const EXPORT_FORMAT = "prfkt-customer-export/v1";

export interface CustomerExport {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  userId: string;
  tenantId: string | null;
  data: Record<string, unknown[]>;
}

const EXPORT_QUERIES: ReadonlyArray<[string, string]> = [
  ["profile", "select id, email, display_name, created_at, updated_at from public.profiles where id = auth.uid()"],
  ["tenants", "select * from public.tenants order by created_at"],
  ["tenant_members", "select * from public.tenant_members order by created_at"],
  ["configurations", "select * from public.configurations order by created_at"],
  [
    "custom_build_requests",
    `select id, reference, tenant_id, contact_name, contact_email, company, foundation_id, family, catalog_slug,
            problem, outcomes, data_sensitivity, timeline, budget_range, status, created_at, updated_at
     from public.custom_build_requests order by created_at`,
  ],
  ["deployment_requests", "select * from public.deployment_requests order by created_at"],
  ["runtime_cells", "select * from public.runtime_cells order by created_at"],
  ["provisioning_jobs", "select * from public.provisioning_jobs order by created_at"],
  ["memory_items", "select * from public.memory_items order by created_at"],
  ["data_export_requests", "select * from public.data_export_requests order by created_at"],
  ["account_deletion_requests", "select * from public.account_deletion_requests order by created_at"],
];

export async function exportCustomerData(sql: Sql, userId: string): Promise<CustomerExport> {
  return withUser(sql, userId, async (tx) => {
    const tenantId = (await primaryTenantIdForUser(tx, userId)) ?? null;
    const data: Record<string, unknown[]> = {};
    let rows = 0;
    for (const [name, query] of EXPORT_QUERIES) {
      data[name] = await tx.query(query);
      rows += data[name]!.length;
    }
    if (tenantId) {
      await tx.query("insert into public.data_export_requests (tenant_id, requested_by, status, row_count) values ($1, $2, 'DELIVERED', $3)", [
        tenantId,
        userId,
        rows,
      ]);
    }
    return { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), userId, tenantId, data };
  });
}
