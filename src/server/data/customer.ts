import { z } from "zod";
import type { ActionResult } from "@/domain/intake";
import type { Sql } from "../db/sql";
import { maybeOne, one, withUser } from "../db/sql";
import { hitRateLimit, RATE_LIMITS } from "../rate-limit";
import { primaryTenantIdForUser } from "./tenant";

/** Customer-side reads and writes. Everything runs as the user, so RLS decides visibility. */

export interface ConfigurationRow {
  id: string;
  name: string;
  catalog_slug: string | null;
  recommendation: {
    family: string;
    composition: string[];
    modelPolicy: string;
    compute: string;
    deployment: string;
    profile: string;
  };
  notes: string | null;
  created_at: string;
}

export interface CustomRequestRow {
  id: string;
  reference: string;
  status: string;
  problem: string;
  created_at: string;
}

export interface DeploymentRequestRow {
  id: string;
  configuration_id: string;
  configuration_name: string | null;
  status: string;
  customer_note: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface CellRow {
  id: string;
  name: string;
  runtime: string;
  profile: string;
  status: string;
  health: string;
  backup_state: string;
  model_policy: string;
  compute_class: string;
  deployment_target: string;
  last_health_at: string | null;
  version: string | null;
}

export interface DeletionRequestRow {
  id: string;
  status: string;
  created_at: string;
}

export interface CustomerDashboard {
  tenant: { id: string; name: string } | null;
  configurations: ConfigurationRow[];
  customRequests: CustomRequestRow[];
  deploymentRequests: DeploymentRequestRow[];
  cells: CellRow[];
  openDeletionRequest: DeletionRequestRow | null;
  lastExportAt: string | null;
}

export async function loadCustomerDashboard(sql: Sql, userId: string): Promise<CustomerDashboard> {
  return withUser(sql, userId, async (tx) => {
    const tenantId = await primaryTenantIdForUser(tx, userId);
    if (!tenantId) {
      return { tenant: null, configurations: [], customRequests: [], deploymentRequests: [], cells: [], openDeletionRequest: null, lastExportAt: null };
    }
    const tenant = await maybeOne<{ id: string; name: string }>(tx, "select id, name from public.tenants where id = $1", [tenantId]);
    const configurations = await tx.query<ConfigurationRow>(
      `select id, name, catalog_slug, recommendation, notes, created_at::text
       from public.configurations where tenant_id = $1 order by created_at desc limit 50`,
      [tenantId],
    );
    const customRequests = await tx.query<CustomRequestRow>(
      `select id, reference, status, problem, created_at::text
       from public.custom_build_requests where tenant_id = $1 order by created_at desc limit 50`,
      [tenantId],
    );
    const deploymentRequests = await tx.query<DeploymentRequestRow>(
      `select d.id, d.configuration_id, c.name as configuration_name, d.status, d.customer_note, d.review_note,
              d.created_at::text, d.reviewed_at::text
       from public.deployment_requests d left join public.configurations c on c.id = d.configuration_id
       where d.tenant_id = $1 order by d.created_at desc limit 50`,
      [tenantId],
    );
    const cells = await tx.query<CellRow>(
      `select id, name, runtime, profile, status, health, backup_state, model_policy, compute_class,
              deployment_target, last_health_at::text, version
       from public.runtime_cells where tenant_id = $1 order by created_at`,
      [tenantId],
    );
    const openDeletionRequest =
      (await maybeOne<DeletionRequestRow>(
        tx,
        "select id, status, created_at::text from public.account_deletion_requests where user_id = $1 and status = 'REQUESTED'",
        [userId],
      )) ?? null;
    const lastExport = await maybeOne<{ at: string | null }>(
      tx,
      "select max(created_at)::text as at from public.data_export_requests where tenant_id = $1",
      [tenantId],
    );
    return {
      tenant: tenant ?? null,
      configurations,
      customRequests,
      deploymentRequests,
      cells,
      openDeletionRequest,
      lastExportAt: lastExport?.at ?? null,
    };
  });
}

export const DeploymentRequestInput = z.object({
  configurationId: z.uuid(),
  note: z.string().trim().max(2000).optional(),
});

export async function createDeploymentRequest(sql: Sql, userId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = DeploymentRequestInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (!(await hitRateLimit(sql, RATE_LIMITS.deploymentRequestPerUser, userId))) {
    return { ok: false, error: "Too many requests. Please wait a while before trying again." };
  }
  return withUser(sql, userId, async (tx) => {
    const cfg = await maybeOne<{ tenant_id: string }>(tx, "select tenant_id from public.configurations where id = $1", [
      parsed.data.configurationId,
    ]);
    if (!cfg) return { ok: false as const, error: "Configuration not found." };
    const pending = await maybeOne<{ id: string }>(
      tx,
      "select id from public.deployment_requests where configuration_id = $1 and status = 'PENDING_REVIEW'",
      [parsed.data.configurationId],
    );
    if (pending) return { ok: true as const, data: { id: pending.id } };
    const row = await one<{ id: string }>(
      tx,
      `insert into public.deployment_requests (tenant_id, configuration_id, requested_by, customer_note)
       values ($1, $2, $3, $4) returning id`,
      [cfg.tenant_id, parsed.data.configurationId, userId, parsed.data.note || null],
    );
    return { ok: true as const, data: { id: row.id } };
  });
}

export async function cancelDeploymentRequest(sql: Sql, userId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  return withUser(sql, userId, async (tx) => {
    const rows = await tx.query<{ id: string }>(
      "update public.deployment_requests set status = 'CANCELLED' where id = $1 and status = 'PENDING_REVIEW' returning id",
      [parsed.data.id],
    );
    if (rows.length === 0) return { ok: false as const, error: "Only pending requests can be cancelled." };
    return { ok: true as const, data: { id: rows[0]!.id } };
  });
}

export async function requestAccountDeletion(sql: Sql, userId: string, raw: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ reason: z.string().trim().max(1000).optional(), confirm: z.literal("DELETE") }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Type DELETE to confirm.', fieldErrors: { confirm: ["Type DELETE to confirm."] } };
  return withUser(sql, userId, async (tx) => {
    const existing = await maybeOne<{ id: string }>(
      tx,
      "select id from public.account_deletion_requests where user_id = $1 and status = 'REQUESTED'",
      [userId],
    );
    if (existing) return { ok: true as const, data: { id: existing.id } };
    const tenantId = await primaryTenantIdForUser(tx, userId);
    if (!tenantId) return { ok: false as const, error: "No workspace found." };
    const row = await one<{ id: string }>(
      tx,
      "insert into public.account_deletion_requests (tenant_id, user_id, reason) values ($1, $2, $3) returning id",
      [tenantId, userId, parsed.data.reason || null],
    );
    return { ok: true as const, data: { id: row.id } };
  });
}

export async function cancelAccountDeletion(sql: Sql, userId: string): Promise<ActionResult<{ id: string }>> {
  return withUser(sql, userId, async (tx) => {
    const rows = await tx.query<{ id: string }>(
      "update public.account_deletion_requests set status = 'CANCELLED' where user_id = $1 and status = 'REQUESTED' returning id",
      [userId],
    );
    if (rows.length === 0) return { ok: false as const, error: "No open deletion request." };
    return { ok: true as const, data: { id: rows[0]!.id } };
  });
}
