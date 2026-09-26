import { z } from "zod";
import { RuntimeId } from "@/domain/families";
import { ComputeClassId, ModelPolicyId } from "@/domain/registries";
import { CellSpec, RuntimeAdapterError, type RuntimeAdapter } from "@/runtime/adapter";
import type { AdapterResolution } from "@/runtime/factory";
import { SAFE_DEFAULT_LIMITS } from "@/security/blast-radius";
import { redactSecrets } from "@/security/secrets";
import type { Sql } from "../db/sql";
import { maybeOne, one } from "../db/sql";
import { writeAudit } from "../audit";
import type { ServerEnv } from "../env";
import { effectiveFlag } from "../flags";
import type { OwnerContext, OwnerResult } from "./admin";

/**
 * Provisioning job runner (F-006d). An owner runs a QUEUED job; the runner
 * provisions the cell through the runtime adapter and records the outcome.
 *
 *   tx 1  lock job → gate checks → cell row PROVISIONING, job RUNNING, audit
 *   ----  adapter.provision (outside any transaction; idempotent on the job key)
 *   tx 2  cell ACTIVE + job SUCCEEDED, or cell/job FAILED with the error, audit
 *
 * A crash between the two leaves the job RUNNING; after RUNNING_STALE_MS it
 * can be run again, and the job's idempotency key makes the controller return
 * the original cell instead of creating a second one.
 */

export const RUNNING_STALE_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

const Recommendation = z.object({
  runtime: RuntimeId,
  modelPolicy: ModelPolicyId,
  compute: ComputeClassId,
  deployment: z.string(),
  profile: z.enum(["SAFE", "OPERATOR"]),
});

export const JobIdInput = z.object({ jobId: z.uuid() });

/** Deterministic cell spec for a job: least privilege, no tools, no egress, no secrets until configured. */
export function buildCellSpec(job: { id: string; tenantId: string; runtime: string }, recommendation: unknown): CellSpec {
  const rec = Recommendation.parse(recommendation);
  return CellSpec.parse({
    tenantId: job.tenantId,
    cellId: `cell-${job.id.toLowerCase()}`,
    runtime: job.runtime,
    profile: rec.profile,
    modelPolicy: rec.modelPolicy,
    compute: rec.compute,
    version: "1.0.0",
    toolAllowlist: [],
    secretRefs: {},
    limits: {
      maxToolActionsPerRun: SAFE_DEFAULT_LIMITS.maxToolActionsPerRun,
      maxModelCostCentsPerDay: SAFE_DEFAULT_LIMITS.maxModelCostCentsPerDay,
      maxSendsPerHour: SAFE_DEFAULT_LIMITS.maxSendsPerHour,
    },
    egressAllowlist: [],
  });
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return redactSecrets(raw).slice(0, 300);
}

interface JobRow {
  id: string;
  tenant_id: string;
  runtime: string;
  status: string;
  attempts: number;
  idempotency_key: string;
  stale: boolean;
  recommendation: unknown;
}

export interface RunDeps {
  resolveAdapter: (runtime: string) => AdapterResolution;
}

export async function runProvisioningJob(
  sql: Sql,
  ctx: OwnerContext,
  raw: unknown,
  env: ServerEnv,
  deps: RunDeps,
): Promise<OwnerResult<{ status: string; cellId?: string }>> {
  const { jobId } = JobIdInput.parse(raw);

  // ---- tx 1: claim the job.
  const claimed = await sql.transaction(async (tx): Promise<OwnerResult<{ status: string }> | { claim: { adapter: RuntimeAdapter; spec: CellSpec; key: string; cellRowId: string } }> => {
    const job = await maybeOne<JobRow>(
      tx,
      `select j.id, j.tenant_id, j.runtime, j.status, j.attempts, j.idempotency_key,
              (j.updated_at < now() - make_interval(secs => $2)) as stale, c.recommendation
       from public.provisioning_jobs j
       join public.deployment_requests d on d.id = j.deployment_request_id
       join public.configurations c on c.id = d.configuration_id
       where j.id = $1
       for update of j`,
      [jobId, RUNNING_STALE_MS / 1000],
    );
    if (!job) return { ok: false, error: "Provisioning job not found." };
    if (job.status === "SUCCEEDED") return { ok: true, data: { status: "SUCCEEDED" } };
    if (job.status === "RUNNING" && !job.stale) return { ok: false, error: "This job is already running." };
    if (job.status !== "QUEUED" && job.status !== "RUNNING") return { ok: false, error: `Only queued jobs can run (this one is ${job.status}).` };
    if (job.attempts >= MAX_ATTEMPTS) return { ok: false, error: `This job has used all ${MAX_ATTEMPTS} attempts.` };

    const flag = await maybeOne<{ enabled: boolean }>(tx, "select enabled from public.feature_flags where key = 'provisioning_enabled'");
    if (!effectiveFlag("provisioning_enabled", flag?.enabled, env)) return { ok: false, error: "Provisioning is disabled (environment ceiling or flag)." };

    let spec: CellSpec;
    try {
      spec = buildCellSpec({ id: job.id, tenantId: job.tenant_id, runtime: job.runtime }, job.recommendation);
    } catch {
      return { ok: false, error: "The saved configuration cannot be turned into a cell spec." };
    }
    const deployment = (job.recommendation as { deployment?: string }).deployment;
    if (deployment !== "managed-cell") return { ok: false, error: `Only managed-cell deployments can be provisioned automatically (this is ${deployment ?? "unknown"}).` };

    const resolved = deps.resolveAdapter(job.runtime);
    if (!resolved.ok) return { ok: false, error: resolved.reason };
    const validation = await resolved.adapter.validate(spec);
    if (!validation.ok) return { ok: false, error: `SHIELD rejected the cell spec: ${validation.problems.join("; ")}` };

    const cell = await one<{ id: string }>(
      tx,
      `insert into public.runtime_cells (tenant_id, name, runtime, profile, model_policy, compute_class, deployment_target, status)
       values ($1, $2, $3, $4, $5, $6, 'managed-cell', 'PROVISIONING')
       on conflict (tenant_id, name) do update set status = 'PROVISIONING'
       returning id`,
      [job.tenant_id, spec.cellId, spec.runtime, spec.profile, spec.modelPolicy, spec.compute],
    );
    await tx.query(
      "update public.provisioning_jobs set status = 'RUNNING', attempts = attempts + 1, cell_id = $2, last_error = null where id = $1",
      [job.id, cell.id],
    );
    await writeAudit(tx, ctx.actor, {
      action: "provisioning.run_started",
      targetType: "provisioning_job",
      targetId: job.id,
      before: { status: job.status, attempts: job.attempts },
      after: { status: "RUNNING", attempts: job.attempts + 1, cell: spec.cellId },
      requestId: ctx.requestId,
    });
    return { claim: { adapter: resolved.adapter, spec, key: job.idempotency_key, cellRowId: cell.id } };
  });
  if (!("claim" in claimed)) return claimed;
  const { adapter, spec, key, cellRowId } = claimed.claim;

  // ---- external call: idempotent on the job's key.
  let outcome: { ok: true; endpointRef: string; health: string; version: string | null } | { ok: false; error: string; retryable: boolean };
  try {
    const handle = await adapter.provision(spec, { idempotencyKey: key });
    const health = await adapter.health(handle);
    outcome = { ok: true, endpointRef: handle.endpointRef, health: health.health, version: health.version };
  } catch (e) {
    outcome = { ok: false, error: errorText(e), retryable: e instanceof RuntimeAdapterError ? e.retryable : true };
  }

  // ---- tx 2: record the outcome.
  const finish = (status: "SUCCEEDED" | "FAILED", cellStatus: "ACTIVE" | "FAILED", error: string | null, extra: Record<string, unknown>) =>
    sql.transaction(async (tx) => {
      if (cellStatus === "ACTIVE" && outcome.ok) {
        await tx.query(
          `update public.runtime_cells set status = 'ACTIVE', endpoint_ref = $2, health = $3, version = $4, last_health_at = now() where id = $1`,
          [cellRowId, outcome.endpointRef, outcome.health, outcome.version],
        );
      } else {
        await tx.query("update public.runtime_cells set status = 'FAILED' where id = $1", [cellRowId]);
      }
      await tx.query("update public.provisioning_jobs set status = $2, last_error = $3 where id = $1", [jobId, status, error]);
      await writeAudit(tx, ctx.actor, {
        action: status === "SUCCEEDED" ? "provisioning.succeeded" : "provisioning.failed",
        targetType: "provisioning_job",
        targetId: jobId,
        after: { status, cell: spec.cellId, ...extra },
        requestId: ctx.requestId,
      });
    });

  if (outcome.ok) {
    try {
      await finish("SUCCEEDED", "ACTIVE", null, { health: outcome.health, version: outcome.version });
      return { ok: true, data: { status: "SUCCEEDED", cellId: spec.cellId } };
    } catch (e) {
      // e.g. the provisioning flag was switched off mid-run: SUCCEEDED is gated, FAILED is not.
      const why = `cell was provisioned but the job could not be completed: ${errorText(e)}`;
      await finish("FAILED", "FAILED", why, { retryable: true });
      return { ok: false, error: why };
    }
  }
  await finish("FAILED", "FAILED", outcome.error, { retryable: outcome.retryable });
  return { ok: false, error: `Provisioning failed: ${outcome.error}` };
}

/** BLOCKED or FAILED → QUEUED, once the gate is open. */
export async function requeueProvisioningJob(tx: Sql, ctx: OwnerContext, raw: unknown, env: ServerEnv): Promise<OwnerResult<{ status: string }>> {
  const { jobId } = JobIdInput.parse(raw);
  const job = await maybeOne<{ status: string; attempts: number }>(tx, "select status, attempts from public.provisioning_jobs where id = $1 for update", [jobId]);
  if (!job) return { ok: false, error: "Provisioning job not found." };
  if (job.status !== "BLOCKED" && job.status !== "FAILED") return { ok: false, error: `Only blocked or failed jobs can be queued (this one is ${job.status}).` };
  if (job.attempts >= MAX_ATTEMPTS) return { ok: false, error: `This job has used all ${MAX_ATTEMPTS} attempts.` };
  const flag = await maybeOne<{ enabled: boolean }>(tx, "select enabled from public.feature_flags where key = 'provisioning_enabled'");
  if (!effectiveFlag("provisioning_enabled", flag?.enabled, env)) return { ok: false, error: "Provisioning is disabled (environment ceiling or flag)." };
  await tx.query("update public.provisioning_jobs set status = 'QUEUED', blocked_reason = null where id = $1", [jobId]);
  await writeAudit(tx, ctx.actor, {
    action: "provisioning.requeue",
    targetType: "provisioning_job",
    targetId: jobId,
    before: { status: job.status },
    after: { status: "QUEUED" },
    requestId: ctx.requestId,
  });
  return { ok: true, data: { status: "QUEUED" } };
}

/** BLOCKED, QUEUED or FAILED → CANCELLED. Running and finished jobs cannot be cancelled. */
export async function cancelProvisioningJob(tx: Sql, ctx: OwnerContext, raw: unknown): Promise<OwnerResult<{ status: string }>> {
  const { jobId } = JobIdInput.parse(raw);
  const job = await maybeOne<{ status: string }>(tx, "select status from public.provisioning_jobs where id = $1 for update", [jobId]);
  if (!job) return { ok: false, error: "Provisioning job not found." };
  if (!["BLOCKED", "QUEUED", "FAILED"].includes(job.status)) return { ok: false, error: `A ${job.status} job cannot be cancelled.` };
  await tx.query("update public.provisioning_jobs set status = 'CANCELLED' where id = $1", [jobId]);
  await writeAudit(tx, ctx.actor, {
    action: "provisioning.cancel",
    targetType: "provisioning_job",
    targetId: jobId,
    before: { status: job.status },
    after: { status: "CANCELLED" },
    requestId: ctx.requestId,
  });
  return { ok: true, data: { status: "CANCELLED" } };
}
