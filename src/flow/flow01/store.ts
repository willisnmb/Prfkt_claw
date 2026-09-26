import { createHash } from "node:crypto";
import type { Sql } from "@/server/db/sql";
import { maybeOne, one } from "@/server/db/sql";
import { canonicalJson } from "@/security/firewall";
import { redactDeep } from "@/security/secrets";
import type { ApprovalKind, Flow01State, Lead, Proposal, ResearchOutput } from "./definition";

/** Accumulated run output (flow_runs.output). */
export interface RunOutput {
  verifiedContact?: string;
  research?: ResearchOutput;
  researchSignals?: { id: string; description: string }[];
  proposal?: Proposal;
  lastRejection?: { approvalId: string; reason: string | null };
  followUps?: number;
  followUpAt?: string;
  sentMessageId?: string;
  sentAt?: string;
  reply?: { outcome: "accepted" | "declined"; eventId: string };
  invoiceId?: string;
  payment?: { eventId: string; invoiceId: string; amountCents: number };
  cellPlan?: Record<string, unknown>;
  cell?: { cellId: string; resources: string[]; config: Record<string, unknown> };
  acceptance?: { passed: boolean; checks: { name: string; passed: boolean; detail: string }[]; evidenceId: string };
}

export type RunStatus =
  | "running"
  | "retry_wait"
  | "waiting_approval"
  | "waiting_event"
  | "waiting_timer"
  | "failed"
  | "blocked"
  | "completed"
  | "closed";

export interface FlowRun {
  workflowId: string;
  tenantId: string;
  leadId: string;
  lead: Lead;
  currentState: Flow01State;
  previousState: Flow01State | null;
  stateVersion: number;
  status: RunStatus;
  idempotencyKey: string;
  evidenceIds: string[];
  output: RunOutput;
  validatorResult: unknown;
  approvalId: string | null;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  metrics: RunMetrics;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface RunMetrics {
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
  estCostMicroUsd: number;
  activeComputeMs: number;
  retriesTotal: number;
  approvalsTotal: number;
  failuresTotal: number;
  recoveryCount: number;
  duplicatesSuppressed: number;
}

export type MetricsDelta = Partial<Pick<RunMetrics, "modelCalls" | "tokensIn" | "tokensOut" | "estCostMicroUsd" | "activeComputeMs" | "approvalsTotal" | "failuresTotal">>;

type Row = Record<string, unknown>;

export function mapRun(r: Row): FlowRun {
  return {
    workflowId: r.workflow_id as string,
    tenantId: r.tenant_id as string,
    leadId: r.lead_id as string,
    lead: r.lead as Lead,
    currentState: r.current_state as Flow01State,
    previousState: (r.previous_state as Flow01State | null) ?? null,
    stateVersion: Number(r.state_version),
    status: r.status as RunStatus,
    idempotencyKey: r.idempotency_key as string,
    evidenceIds: (r.evidence_ids as string[] | null) ?? [],
    output: (r.output as RunOutput) ?? {},
    validatorResult: r.validator_result ?? null,
    approvalId: (r.approval_id as string | null) ?? null,
    retryCount: Number(r.retry_count),
    lastError: (r.last_error as string | null) ?? null,
    nextAttemptAt: (r.next_attempt_at as Date | null) ?? null,
    leaseOwner: (r.lease_owner as string | null) ?? null,
    leaseExpiresAt: (r.lease_expires_at as Date | null) ?? null,
    metrics: {
      modelCalls: Number(r.model_calls),
      tokensIn: Number(r.tokens_in),
      tokensOut: Number(r.tokens_out),
      estCostMicroUsd: Number(r.est_cost_micro_usd),
      activeComputeMs: Number(r.active_compute_ms),
      retriesTotal: Number(r.retries_total),
      approvalsTotal: Number(r.approvals_total),
      failuresTotal: Number(r.failures_total),
      recoveryCount: Number(r.recovery_count),
      duplicatesSuppressed: Number(r.duplicates_suppressed),
    },
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    completedAt: (r.completed_at as Date | null) ?? null,
  };
}

export function contentHash(v: unknown): string {
  return createHash("sha256").update(canonicalJson(v)).digest("hex");
}

export async function getRun(sql: Sql, workflowId: string): Promise<FlowRun | undefined> {
  const r = await maybeOne<Row>(sql, "select * from public.flow_runs where workflow_id = $1", [workflowId]);
  return r ? mapRun(r) : undefined;
}

export async function appendEvent(
  sql: Sql,
  run: Pick<FlowRun, "workflowId" | "tenantId">,
  e: { type: string; from?: string | null; to?: string | null; stateVersion?: number | null; actor?: string; detail?: unknown },
): Promise<void> {
  await sql.query(
    `insert into public.flow_events (workflow_id, tenant_id, type, from_state, to_state, state_version, actor, detail)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [run.workflowId, run.tenantId, e.type, e.from ?? null, e.to ?? null, e.stateVersion ?? null, e.actor ?? "system", JSON.stringify(redactDeep(e.detail ?? {}))],
  );
}

export interface EvidenceInput {
  kind: "source_verification" | "research" | "validator" | "proposal" | "send" | "payment" | "provisioning" | "config_validation" | "acceptance_test" | "compensation";
  passed: boolean | null;
  content: unknown;
}

export async function insertEvidence(sql: Sql, run: Pick<FlowRun, "workflowId" | "tenantId">, ev: EvidenceInput): Promise<string> {
  const content = redactDeep(ev.content);
  const r = await one<{ id: string }>(
    sql,
    `insert into public.flow_evidence (workflow_id, tenant_id, kind, passed, content, content_hash)
     values ($1, $2, $3, $4, $5::jsonb, $6) returning id`,
    [run.workflowId, run.tenantId, ev.kind, ev.passed, JSON.stringify(content), contentHash(content)],
  );
  return r.id;
}

export interface ApprovalRow {
  id: string;
  workflowId: string;
  tenantId: string;
  kind: ApprovalKind;
  actionClass: string;
  payload: unknown;
  payloadHash: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  reason: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
}

export function mapApproval(r: Row): ApprovalRow {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    tenantId: r.tenant_id as string,
    kind: r.kind as ApprovalKind,
    actionClass: r.action_class as string,
    payload: r.payload,
    payloadHash: r.payload_hash as string,
    status: r.status as ApprovalRow["status"],
    decidedBy: (r.decided_by as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    requestedAt: r.requested_at as Date,
    decidedAt: (r.decided_at as Date | null) ?? null,
  };
}

export async function findApproval(sql: Sql, workflowId: string, kind: ApprovalKind, payloadHash: string): Promise<ApprovalRow | undefined> {
  const r = await maybeOne<Row>(sql, "select * from public.flow_approvals where workflow_id = $1 and kind = $2 and payload_hash = $3", [workflowId, kind, payloadHash]);
  return r ? mapApproval(r) : undefined;
}

export async function getApproval(sql: Sql, id: string): Promise<ApprovalRow | undefined> {
  const r = await maybeOne<Row>(sql, "select * from public.flow_approvals where id = $1", [id]);
  return r ? mapApproval(r) : undefined;
}

export async function listEvents(sql: Sql, workflowId: string) {
  return sql.query<{ id: number; type: string; from_state: string | null; to_state: string | null; state_version: number | null; actor: string; detail: unknown; created_at: Date }>(
    "select id, type, from_state, to_state, state_version, actor, detail, created_at from public.flow_events where workflow_id = $1 order by id",
    [workflowId],
  );
}

export async function listEvidence(sql: Sql, workflowId: string) {
  return sql.query<{ id: string; kind: string; passed: boolean | null; content: unknown; content_hash: string; created_at: Date }>(
    "select id, kind, passed, content, content_hash, created_at from public.flow_evidence where workflow_id = $1 order by seq",
    [workflowId],
  );
}

export async function listApprovals(sql: Sql, workflowId: string): Promise<ApprovalRow[]> {
  const rows = await sql.query<Row>("select * from public.flow_approvals where workflow_id = $1 order by requested_at", [workflowId]);
  return rows.map(mapApproval);
}

export async function listSideEffects(sql: Sql, workflowId: string) {
  return sql.query<{ idempotency_key: string; adapter: string; operation: string; status: string; attempts: number; updated_at: Date }>(
    "select idempotency_key, adapter, operation, status, attempts, updated_at from public.flow_side_effects where workflow_id = $1 order by created_at",
    [workflowId],
  );
}
