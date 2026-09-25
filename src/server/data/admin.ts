import { z } from "zod";
import { MATURITY } from "@/domain/catalog/schema";
import { RELEASE_GATES } from "@/security/taxonomy";
import type { Sql } from "../db/sql";
import { maybeOne, one } from "../db/sql";
import type { AuditActor } from "../audit";
import { writeAudit } from "../audit";
import type { ServerEnv } from "../env";
import { canSetFlag, effectiveFlag, FLAG_KEYS, type FlagKey } from "../flags";
import { insertSystemEvent } from "./system-events";

/**
 * Owner (admin) operations. Callers must have passed requireOwner(); every
 * mutation writes admin_audit_log inside the caller's transaction. Inputs are
 * Zod-validated here so the functions are safe to call from any action.
 */

export type OwnerResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export interface OwnerContext {
  actor: AuditActor;
  requestId: string;
}

/* ------------------------------------------------------------------ reads */

export interface AdminOverview {
  customRequestsOpen: number;
  deploymentPending: number;
  deletionPending: number;
  provisioningJobs: number;
  cells: number;
  claws: number;
  clawsPublished: number;
  auditEntries24h: number;
  warnings24h: number;
}

export async function loadAdminOverview(sql: Sql): Promise<AdminOverview> {
  const r = await one<Record<keyof AdminOverview, string | number>>(
    sql,
    `select
       (select count(*) from public.custom_build_requests where status in ('RECEIVED','TRIAGED','SCOPED')) as "customRequestsOpen",
       (select count(*) from public.deployment_requests where status = 'PENDING_REVIEW') as "deploymentPending",
       (select count(*) from public.account_deletion_requests where status = 'REQUESTED') as "deletionPending",
       (select count(*) from public.provisioning_jobs) as "provisioningJobs",
       (select count(*) from public.runtime_cells) as "cells",
       (select count(*) from public.claws) as "claws",
       (select count(*) from public.claws where published) as "clawsPublished",
       (select count(*) from public.admin_audit_log where created_at > now() - interval '24 hours') as "auditEntries24h",
       (select count(*) from public.system_events where severity in ('warning','error','critical') and created_at > now() - interval '24 hours') as "warnings24h"`,
  );
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as unknown as AdminOverview;
}

export interface AdminClawRow {
  slug: string;
  name: string;
  family: string;
  foundation_id: string;
  maturity: string;
  published: boolean;
  evidence_gates: string[];
  updated_at: string;
}

export const ClawFilter = z.object({
  q: z.string().trim().max(80).optional(),
  family: z.string().regex(/^[A-Z]+$/).max(10).optional(),
});

export async function listAdminClaws(sql: Sql, filter: z.infer<typeof ClawFilter> = {}): Promise<AdminClawRow[]> {
  const f = ClawFilter.parse(filter);
  return sql.query<AdminClawRow>(
    `select c.slug, c.name, c.family, c.foundation_id, c.maturity, c.published, c.updated_at::text,
            coalesce(array_agg(distinct e.gate) filter (where e.gate is not null), '{}') as evidence_gates
     from public.claws c left join public.claw_evidence e on e.claw_slug = c.slug
     where ($1::text is null or c.name ilike '%' || $1 || '%' or c.slug ilike '%' || $1 || '%')
       and ($2::text is null or c.family = $2)
     group by c.slug
     order by c.family, c.name
     limit 500`,
    [f.q || null, f.family || null],
  );
}

export interface AdminCustomRequestRow {
  id: string;
  reference: string;
  contact_name: string;
  contact_email: string;
  company: string | null;
  family: string | null;
  foundation_id: string | null;
  catalog_slug: string | null;
  problem: string;
  data_sensitivity: string;
  timeline: string;
  budget_range: string;
  status: string;
  owner_notes: string | null;
  created_at: string;
}

export async function listCustomRequests(sql: Sql): Promise<AdminCustomRequestRow[]> {
  return sql.query<AdminCustomRequestRow>(
    `select id, reference, contact_name, contact_email, company, family, foundation_id, catalog_slug, problem,
            data_sensitivity, timeline, budget_range, status, owner_notes, created_at::text
     from public.custom_build_requests order by created_at desc limit 200`,
  );
}

export interface AdminDeploymentRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  configuration_name: string;
  recommendation: Record<string, unknown>;
  status: string;
  customer_note: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  job_status: string | null;
}

export async function listDeploymentRequests(sql: Sql): Promise<AdminDeploymentRow[]> {
  return sql.query<AdminDeploymentRow>(
    `select d.id, d.tenant_id, t.name as tenant_name, c.name as configuration_name, c.recommendation, d.status,
            d.customer_note, d.review_note, d.created_at::text, d.reviewed_at::text,
            (select j.status from public.provisioning_jobs j where j.deployment_request_id = d.id order by j.created_at desc limit 1) as job_status
     from public.deployment_requests d
     join public.tenants t on t.id = d.tenant_id
     join public.configurations c on c.id = d.configuration_id
     order by (d.status = 'PENDING_REVIEW') desc, d.created_at desc limit 200`,
  );
}

export interface AdminDeletionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  email: string | null;
  status: string;
  reason: string | null;
  created_at: string;
}

export async function listDeletionRequests(sql: Sql): Promise<AdminDeletionRow[]> {
  return sql.query<AdminDeletionRow>(
    `select r.id, r.tenant_id, r.user_id, p.email, r.status, r.reason, r.created_at::text
     from public.account_deletion_requests r left join public.profiles p on p.id = r.user_id
     order by (r.status = 'REQUESTED') desc, r.created_at desc limit 200`,
  );
}

export interface AdminJobRow {
  id: string;
  tenant_name: string;
  deployment_request_id: string;
  runtime: string;
  status: string;
  blocked_reason: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export async function listProvisioningJobs(sql: Sql): Promise<AdminJobRow[]> {
  return sql.query<AdminJobRow>(
    `select j.id, t.name as tenant_name, j.deployment_request_id, j.runtime, j.status, j.blocked_reason, j.attempts,
            j.last_error, j.created_at::text
     from public.provisioning_jobs j join public.tenants t on t.id = j.tenant_id
     order by j.created_at desc limit 200`,
  );
}

export interface AdminCellRow {
  id: string;
  tenant_name: string;
  name: string;
  runtime: string;
  profile: string;
  status: string;
  health: string;
  backup_state: string;
  secret_ref_count: number;
  updated_at: string;
}

export async function listCells(sql: Sql): Promise<AdminCellRow[]> {
  return sql.query<AdminCellRow>(
    `select c.id, t.name as tenant_name, c.name, c.runtime, c.profile, c.status, c.health, c.backup_state,
            (select count(*)::int from jsonb_object_keys(c.secret_refs)) as secret_ref_count, c.updated_at::text
     from public.runtime_cells c join public.tenants t on t.id = c.tenant_id
     order by c.updated_at desc limit 200`,
  );
}

export interface RegistryRuntimeRow {
  id: string;
  label: string;
  role: string;
  status: string;
  isolation: string;
  notes: string | null;
  updated_at: string;
}
export interface RegistryModelRow {
  id: string;
  label: string;
  description: string;
  routes: string[];
  may_incur_managed_cost: boolean;
  enabled: boolean;
  updated_at: string;
}
export interface RegistryComputeRow {
  id: string;
  label: string;
  description: string;
  memory_gb: number | null;
  metering: string;
  enabled: boolean;
  updated_at: string;
}

export const listRuntimes = (sql: Sql) =>
  sql.query<RegistryRuntimeRow>("select id, label, role, status, isolation, notes, updated_at::text from public.runtime_registry order by id");
export const listModels = (sql: Sql) =>
  sql.query<RegistryModelRow>(
    "select id, label, description, routes, may_incur_managed_cost, enabled, updated_at::text from public.model_registry order by id",
  );
export const listCompute = (sql: Sql) =>
  sql.query<RegistryComputeRow>(
    "select id, label, description, memory_gb, metering, enabled, updated_at::text from public.compute_registry order by memory_gb nulls first, id",
  );

export interface AuditRow {
  id: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  request_id: string | null;
  created_at: string;
}

export const AuditFilter = z.object({
  action: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function listAudit(sql: Sql, filter: z.input<typeof AuditFilter> = {}): Promise<AuditRow[]> {
  const f = AuditFilter.parse(filter);
  return sql.query<AuditRow>(
    `select id, actor_email, action, target_type, target_id, before, after, request_id, created_at::text
     from public.admin_audit_log
     where ($1::text is null or action ilike $1 || '%')
     order by created_at desc limit $2`,
    [f.action || null, f.limit],
  );
}

export interface SystemEventRow {
  id: string;
  kind: string;
  severity: string;
  source: string;
  message: string;
  created_at: string;
}

export const listSystemEvents = (sql: Sql, limit = 50) =>
  sql.query<SystemEventRow>(
    "select id, kind, severity, source, message, created_at::text from public.system_events order by created_at desc limit $1",
    [Math.min(Math.max(limit, 1), 200)],
  );

export interface BackupRunRow {
  id: string;
  kind: string;
  tenant_id: string | null;
  status: string;
  row_count: number | null;
  checksum: string | null;
  started_at: string;
  finished_at: string | null;
  restore_verified_at: string | null;
}

export const listBackupRuns = (sql: Sql) =>
  sql.query<BackupRunRow>(
    `select id, kind, tenant_id, status, row_count, checksum, started_at::text, finished_at::text, restore_verified_at::text
     from public.backup_runs order by started_at desc limit 50`,
  );

export interface FlagView {
  key: FlagKey;
  stored: boolean;
  effective: boolean;
  envCeiling: boolean;
  description: string;
}

export async function listFlagViews(sql: Sql, env: ServerEnv): Promise<FlagView[]> {
  const rows = await sql.query<{ key: string; enabled: boolean; description: string }>(
    "select key, enabled, description from public.feature_flags",
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return FLAG_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      stored: row?.enabled ?? false,
      effective: effectiveFlag(key, row?.enabled, env),
      envCeiling: canSetFlag(key, true, env).ok,
      description: row?.description ?? "(missing — run the seed)",
    };
  });
}

/* ------------------------------------------------------------- mutations */

export const SetPublishedInput = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/).max(80), published: z.boolean() });

export async function setClawPublished(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  const input = SetPublishedInput.parse(raw);
  const before = await maybeOne<{ published: boolean }>(tx, "select published from public.claws where slug = $1", [input.slug]);
  if (!before) return { ok: false, error: "Catalog item not found." };
  await tx.query("update public.claws set published = $2 where slug = $1", [input.slug, input.published]);
  await writeAudit(tx, ctx.actor, {
    action: "catalog.set_published",
    targetType: "claw",
    targetId: input.slug,
    before,
    after: { published: input.published },
    requestId: ctx.requestId,
  });
  return { ok: true };
}

export const SetMaturityInput = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/).max(80), maturity: z.enum(MATURITY) });

/** READY is re-checked by the deferred DB trigger at commit (evidence for all 8 gates). */
export async function setClawMaturity(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  const input = SetMaturityInput.parse(raw);
  const before = await maybeOne<{ maturity: string }>(tx, "select maturity from public.claws where slug = $1", [input.slug]);
  if (!before) return { ok: false, error: "Catalog item not found." };
  if (input.maturity === "READY") {
    const covered = await one<{ n: number }>(
      tx,
      "select count(distinct gate)::int as n from public.claw_evidence where claw_slug = $1 and result = 'pass'",
      [input.slug],
    );
    if (covered.n < RELEASE_GATES.length) {
      return { ok: false, error: `READY requires passing evidence for all ${RELEASE_GATES.length} release gates (${covered.n} recorded).` };
    }
  }
  await tx.query("update public.claws set maturity = $2 where slug = $1", [input.slug, input.maturity]);
  await writeAudit(tx, ctx.actor, {
    action: "catalog.set_maturity",
    targetType: "claw",
    targetId: input.slug,
    before,
    after: { maturity: input.maturity },
    requestId: ctx.requestId,
  });
  return { ok: true };
}

export const AddEvidenceInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
  gate: z.enum(RELEASE_GATES),
  ref: z.string().trim().min(3).max(500),
  verifiedAt: z.iso.date(),
});

export async function addClawEvidence(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  const input = AddEvidenceInput.parse(raw);
  const exists = await maybeOne(tx, "select 1 from public.claws where slug = $1", [input.slug]);
  if (!exists) return { ok: false, error: "Catalog item not found." };
  await tx.query(
    `insert into public.claw_evidence (claw_slug, gate, ref, result, verified_at, recorded_by)
     values ($1, $2, $3, 'pass', $4, $5) on conflict (claw_slug, gate, ref) do nothing`,
    [input.slug, input.gate, input.ref, input.verifiedAt, ctx.actor.userId],
  );
  await writeAudit(tx, ctx.actor, {
    action: "catalog.add_evidence",
    targetType: "claw",
    targetId: input.slug,
    after: { gate: input.gate, ref: input.ref, verifiedAt: input.verifiedAt },
    requestId: ctx.requestId,
  });
  return { ok: true };
}

export const CustomRequestUpdateInput = z.object({
  id: z.uuid(),
  status: z.enum(["RECEIVED", "TRIAGED", "SCOPED", "DECLINED", "CONVERTED"]),
  ownerNotes: z.string().trim().max(4000).optional(),
});

export async function updateCustomRequest(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  const input = CustomRequestUpdateInput.parse(raw);
  const before = await maybeOne<{ status: string; owner_notes: string | null }>(
    tx,
    "select status, owner_notes from public.custom_build_requests where id = $1",
    [input.id],
  );
  if (!before) return { ok: false, error: "Request not found." };
  await tx.query("update public.custom_build_requests set status = $2, owner_notes = $3 where id = $1", [
    input.id,
    input.status,
    input.ownerNotes ?? before.owner_notes,
  ]);
  await writeAudit(tx, ctx.actor, {
    action: "request.update_custom",
    targetType: "custom_build_request",
    targetId: input.id,
    before,
    after: { status: input.status, owner_notes: input.ownerNotes ?? before.owner_notes },
    requestId: ctx.requestId,
  });
  return { ok: true };
}

export const DeploymentReviewInput = z.object({
  id: z.uuid(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(2000).optional(),
});

export async function reviewDeploymentRequest(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  const input = DeploymentReviewInput.parse(raw);
  const before = await maybeOne<{ status: string }>(tx, "select status from public.deployment_requests where id = $1 for update", [input.id]);
  if (!before) return { ok: false, error: "Deployment request not found." };
  if (before.status !== "PENDING_REVIEW") return { ok: false, error: `Already ${before.status.toLowerCase()}.` };
  if (input.decision === "REJECTED" && !input.note) return { ok: false, error: "A rejection needs a note for the customer." };
  await tx.query(
    "update public.deployment_requests set status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() where id = $1",
    [input.id, input.decision, input.note || null, ctx.actor.userId],
  );
  await writeAudit(tx, ctx.actor, {
    action: `deployment.${input.decision.toLowerCase()}`,
    targetType: "deployment_request",
    targetId: input.id,
    before,
    after: { status: input.decision, review_note: input.note ?? null },
    requestId: ctx.requestId,
  });
  return { ok: true };
}

export const CreateJobInput = z.object({ deploymentRequestId: z.uuid() });

/**
 * Creates the provisioning job for an approved deployment request. With the
 * provisioning gate closed (env ceiling or DB flag) the job is recorded as
 * BLOCKED with the reason; nothing is provisioned. Idempotent per request.
 */
export async function createProvisioningJob(
  tx: Sql,
  ctx: OwnerContext,
  raw: unknown,
  env: ServerEnv,
): Promise<OwnerResult<{ id: string; status: string }>> {
  const input = CreateJobInput.parse(raw);
  const req = await maybeOne<{ tenant_id: string; status: string; recommendation: { runtime?: string } }>(
    tx,
    `select d.tenant_id, d.status, c.recommendation
     from public.deployment_requests d join public.configurations c on c.id = d.configuration_id where d.id = $1`,
    [input.deploymentRequestId],
  );
  if (!req) return { ok: false, error: "Deployment request not found." };
  if (req.status !== "APPROVED") return { ok: false, error: "Only approved deployment requests can be provisioned." };

  const idempotencyKey = `deployment:${input.deploymentRequestId}`;
  const existing = await maybeOne<{ id: string; status: string }>(
    tx,
    "select id, status from public.provisioning_jobs where idempotency_key = $1",
    [idempotencyKey],
  );
  if (existing) return { ok: true, data: existing };

  const flagRow = await maybeOne<{ enabled: boolean }>(tx, "select enabled from public.feature_flags where key = 'provisioning_enabled'");
  const enabled = effectiveFlag("provisioning_enabled", flagRow?.enabled, env);
  const runtimeId = req.recommendation?.runtime ?? "openclaw";
  const runtime = await maybeOne<{ id: string }>(tx, "select id from public.runtime_registry where id = $1", [runtimeId]);
  if (!runtime) return { ok: false, error: `Runtime ${runtimeId} is not in the registry.` };

  const status = enabled ? "QUEUED" : "BLOCKED";
  const blockedReason = enabled
    ? null
    : !env.PROVISIONING_ENABLED
      ? "PROVISIONING_ENABLED=false in this environment"
      : "provisioning_enabled flag is off";
  const job = await one<{ id: string; status: string }>(
    tx,
    `insert into public.provisioning_jobs (tenant_id, deployment_request_id, runtime, status, blocked_reason, idempotency_key, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id, status`,
    [req.tenant_id, input.deploymentRequestId, runtime.id, status, blockedReason, idempotencyKey, ctx.actor.userId],
  );
  await writeAudit(tx, ctx.actor, {
    action: "provisioning.create_job",
    targetType: "provisioning_job",
    targetId: job.id,
    after: { status, blocked_reason: blockedReason, deployment_request_id: input.deploymentRequestId },
    requestId: ctx.requestId,
  });
  return { ok: true, data: job };
}

export const RuntimeStatusInput = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(40),
  status: z.enum(["connected", "embedded", "not-configured", "candidate", "disabled"]),
  notes: z.string().trim().max(1000).optional(),
});

export async function setRuntimeStatus(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  const input = RuntimeStatusInput.parse(raw);
  const before = await maybeOne<{ status: string; notes: string | null }>(tx, "select status, notes from public.runtime_registry where id = $1", [input.id]);
  if (!before) return { ok: false, error: "Runtime not found." };
  await tx.query("update public.runtime_registry set status = $2, notes = $3 where id = $1", [input.id, input.status, input.notes ?? before.notes]);
  await writeAudit(tx, ctx.actor, {
    action: "registry.runtime_status",
    targetType: "runtime",
    targetId: input.id,
    before,
    after: { status: input.status, notes: input.notes ?? before.notes },
    requestId: ctx.requestId,
  });
  return { ok: true };
}

export const RegistryToggleInput = z.object({ id: z.string().regex(/^[a-z0-9-]+$/).max(40), enabled: z.boolean() });

export async function setModelEnabled(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  return toggleRegistry(tx, ctx, raw, "model_registry", "registry.model_enabled", "model_policy");
}

export async function setComputeEnabled(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult> {
  return toggleRegistry(tx, ctx, raw, "compute_registry", "registry.compute_enabled", "compute_class");
}

async function toggleRegistry(
  tx: Sql,
  ctx: OwnerContext,
  raw: unknown,
  table: "model_registry" | "compute_registry",
  action: string,
  targetType: string,
): Promise<OwnerResult> {
  const input = RegistryToggleInput.parse(raw);
  const before = await maybeOne<{ enabled: boolean }>(tx, `select enabled from public.${table} where id = $1`, [input.id]);
  if (!before) return { ok: false, error: "Registry entry not found." };
  await tx.query(`update public.${table} set enabled = $2 where id = $1`, [input.id, input.enabled]);
  await writeAudit(tx, ctx.actor, { action, targetType, targetId: input.id, before, after: { enabled: input.enabled }, requestId: ctx.requestId });
  return { ok: true };
}

export const SetFlagInput = z.object({
  key: z.enum(["billing_enabled", "provisioning_enabled", "custom_intake_enabled", "configuration_save_enabled"]),
  enabled: z.boolean(),
});

export async function setFeatureFlag(tx: Sql, ctx: OwnerContext, raw: unknown, env: ServerEnv): Promise<OwnerResult> {
  const input = SetFlagInput.parse(raw);
  const allowed = canSetFlag(input.key, input.enabled, env);
  if (!allowed.ok) return { ok: false, error: allowed.reason };
  const before = await maybeOne<{ enabled: boolean }>(tx, "select enabled from public.feature_flags where key = $1", [input.key]);
  if (!before) return { ok: false, error: "Flag not found. Run the seed first." };
  await tx.query("update public.feature_flags set enabled = $2, updated_by = $3 where key = $1", [input.key, input.enabled, ctx.actor.userId]);
  await writeAudit(tx, ctx.actor, {
    action: "flags.set",
    targetType: "feature_flag",
    targetId: input.key,
    before,
    after: { enabled: input.enabled },
    requestId: ctx.requestId,
  });
  return { ok: true };
}

export const DeletionDecisionInput = z.object({ id: z.uuid() });

/**
 * Completes an account deletion (HANDOFF non-negotiable 7): removes the auth
 * user (cascading profile and memberships) and any tenant left without
 * members (cascading all tenant-owned data). The audit entry keeps only ids.
 */
export async function completeAccountDeletion(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult<{ tenantsDeleted: number }>> {
  const input = DeletionDecisionInput.parse(raw);
  const req = await maybeOne<{ user_id: string; tenant_id: string; status: string }>(
    tx,
    "select user_id, tenant_id, status from public.account_deletion_requests where id = $1 for update",
    [input.id],
  );
  if (!req) return { ok: false, error: "Deletion request not found." };
  if (req.status !== "REQUESTED") return { ok: false, error: `Request is ${req.status.toLowerCase()}.` };

  const soleTenants = await tx.query<{ tenant_id: string }>(
    `select m.tenant_id from public.tenant_members m
     where m.user_id = $1
       and not exists (select 1 from public.tenant_members o where o.tenant_id = m.tenant_id and o.user_id <> $1)`,
    [req.user_id],
  );
  // Write the audit record first; the request row itself is removed by cascade.
  await writeAudit(tx, ctx.actor, {
    action: "account.delete",
    targetType: "user",
    targetId: req.user_id,
    after: { deletion_request_id: input.id, tenants_deleted: soleTenants.map((t) => t.tenant_id) },
    requestId: ctx.requestId,
  });
  await tx.query("update public.account_deletion_requests set status = 'COMPLETED', processed_at = now() where id = $1", [input.id]);
  for (const t of soleTenants) await tx.query("delete from public.tenants where id = $1", [t.tenant_id]);
  await tx.query("delete from auth.users where id = $1", [req.user_id]);
  await insertSystemEvent(tx, { kind: "account.deleted", message: "Account deletion completed.", detail: { deletionRequestId: input.id } });
  return { ok: true, data: { tenantsDeleted: soleTenants.length } };
}

export const listSystemEventsByKind = (sql: Sql, kindPrefix: string, limit = 20) =>
  sql.query<SystemEventRow>(
    `select id, kind, severity, source, message, created_at::text from public.system_events
     where kind like $1 || '%' order by created_at desc limit $2`,
    [kindPrefix, Math.min(Math.max(limit, 1), 200)],
  );

export async function databaseHealth(sql: Sql): Promise<{ ok: boolean; latencyMs: number; migrations: number | null }> {
  const started = performance.now();
  try {
    await sql.query("select 1");
    const m = await sql.query<{ n: number }>(
      "select count(*)::int as n from supabase_migrations.schema_migrations",
    ).catch(() => null);
    return { ok: true, latencyMs: Math.round(performance.now() - started), migrations: m?.[0]?.n ?? null };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - started), migrations: null };
  }
}
