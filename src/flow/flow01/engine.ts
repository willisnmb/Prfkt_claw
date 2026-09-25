import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { Sql } from "@/server/db/sql";
import { maybeOne, one } from "@/server/db/sql";
import { evaluateAction, payloadHash } from "@/security/firewall";
import { checkBlastRadius, ZERO_USAGE } from "@/security/blast-radius";
import { assemblePrompt, detectInjectionSignals } from "@/security/untrusted";
import { assertNoSecretValues } from "@/security/secret-refs";
import { redactSecrets } from "@/security/secrets";
import {
  ALLOWED_LEAD_SOURCES,
  APPROVAL_GATES,
  CellPlan,
  FLOW01_POLICY,
  FLOW01_STATES,
  FOLLOW_UP_AFTER_MS,
  Lead,
  MAX_FOLLOW_UPS,
  Proposal,
  QUALIFICATION_THRESHOLD,
  ResearchOutput,
  STATE_ACTION,
  TERMINAL_STATES,
  isAllowedTransition,
  type ApprovalKind,
  type Flow01State,
} from "./definition";
import { ModelTimeoutError, ProvisionerError, type Flow01Adapters } from "./adapters";
import {
  appendEvent,
  findApproval,
  getApproval,
  getRun,
  insertEvidence,
  mapApproval,
  mapRun,
  type ApprovalRow,
  type EvidenceInput,
  type FlowRun,
  type MetricsDelta,
  type RunOutput,
  type RunStatus,
} from "./store";

/* ================================================================ outcomes */

type StepOutcome =
  | {
      type: "transition";
      to: Flow01State;
      patch?: Partial<RunOutput>;
      evidence?: EvidenceInput[];
      approvalId?: string | null;
      validator?: unknown;
      metrics?: MetricsDelta;
      detail?: Record<string, unknown>;
      nextAttemptAt?: Date | null;
    }
  | { type: "wait"; status: Extract<RunStatus, "waiting_approval" | "waiting_event" | "waiting_timer">; nextAttemptAt?: Date | null; detail?: Record<string, unknown>; metrics?: MetricsDelta }
  | { type: "retry"; error: string; validator?: unknown; evidence?: EvidenceInput[]; metrics?: MetricsDelta }
  | { type: "fail"; status: "failed" | "blocked"; error: string; evidence?: EvidenceInput[]; metrics?: MetricsDelta; patch?: Partial<RunOutput> };

/** Runs inside the same transaction as the operation, so its audit record commits (or rolls back) with it. */
export type InTxAudit<T> = (tx: Sql, subject: T) => Promise<void>;

export type AdvanceResult = {
  workflowId: string;
  state: Flow01State;
  status: RunStatus;
  steps: number;
  halt: "waiting" | "retry_scheduled" | "failed" | "blocked" | "terminal" | "lease_held" | "max_steps" | "not_found" | "conflict";
};

export interface EngineHooks {
  /** Injected into the fakes' afterExternalEffect for crash tests; also called between ledger phases. */
  afterLedgerStarted?: (key: string) => void | Promise<void>;
}

export interface EngineOptions {
  sql: Sql;
  adapters: Flow01Adapters;
  workerId: string;
  clock?: () => Date;
  leaseMs?: number;
  hooks?: EngineHooks;
  /** Base for exponential retry backoff. */
  retryBaseMs?: number;
}

export class FlowConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowConflictError";
  }
}

const WebhookPayloads = {
  "lead.reply": z.object({ workflowId: z.uuid(), outcome: z.enum(["accepted", "declined"]) }),
  "payment.succeeded": z.object({ workflowId: z.uuid(), invoiceId: z.string().min(3).max(100), amountCents: z.number().int().min(0) }),
} as const;
export type WebhookType = keyof typeof WebhookPayloads;

/* ================================================================== engine */

export class Flow01Engine {
  private readonly sql: Sql;
  private readonly adapters: Flow01Adapters;
  private readonly workerId: string;
  private readonly clock: () => Date;
  private readonly leaseMs: number;
  private readonly hooks: EngineHooks;
  private readonly retryBaseMs: number;
  private readonly graph;
  private readonly inFlight = new Set<string>();

  constructor(o: EngineOptions) {
    this.sql = o.sql;
    this.adapters = o.adapters;
    this.workerId = o.workerId;
    this.clock = o.clock ?? (() => new Date());
    this.leaseMs = o.leaseMs ?? 30_000;
    this.hooks = o.hooks ?? {};
    this.retryBaseMs = o.retryBaseMs ?? 1_000;
    this.graph = this.buildGraph();
  }

  /* ------------------------------------------------------------ public API */

  /** Idempotent run creation: the same idempotency key always returns the same run. */
  async createRun(input: { tenantId: string; leadId: string; lead: unknown; idempotencyKey: string; audit?: InTxAudit<FlowRun> }): Promise<{ run: FlowRun; created: boolean }> {
    const lead = Lead.parse(input.lead);
    return this.sql.transaction(async (tx) => {
      const inserted = await maybeOne<Record<string, unknown>>(
        tx,
        `insert into public.flow_runs (tenant_id, lead_id, lead, idempotency_key)
         values ($1, $2, $3::jsonb, $4) on conflict (idempotency_key) do nothing returning *`,
        [input.tenantId, input.leadId, JSON.stringify(lead), input.idempotencyKey],
      );
      if (inserted) {
        const run = mapRun(inserted);
        await appendEvent(tx, run, { type: "run_created", to: "NEW_LEAD", stateVersion: 0, detail: { leadId: input.leadId } });
        await input.audit?.(tx, run);
        return { run, created: true };
      }
      const existing = mapRun(await one(tx, "select * from public.flow_runs where idempotency_key = $1", [input.idempotencyKey]));
      if (existing.tenantId !== input.tenantId) throw new FlowConflictError("idempotency key belongs to another tenant");
      return { run: existing, created: false };
    });
  }

  /** Advances a run as far as it can go now, through the LangGraph graph. */
  async advance(workflowId: string, opts: { maxSteps?: number } = {}): Promise<AdvanceResult> {
    // Leases serialise workers; this serialises concurrent calls within one worker.
    if (this.inFlight.has(workflowId)) {
      const run = await getRun(this.sql, workflowId);
      return { workflowId, state: run?.currentState ?? "NEW_LEAD", status: run?.status ?? "failed", steps: 0, halt: run ? "lease_held" : "not_found" };
    }
    this.inFlight.add(workflowId);
    try {
      return await this.advanceLeased(workflowId, opts.maxSteps ?? 60);
    } finally {
      this.inFlight.delete(workflowId);
    }
  }

  private async advanceLeased(workflowId: string, maxSteps: number): Promise<AdvanceResult> {
    const leased = await this.acquireLease(workflowId);
    if (!leased) {
      const run = await getRun(this.sql, workflowId);
      if (!run) return { workflowId, state: "NEW_LEAD", status: "failed", steps: 0, halt: "not_found" };
      return { workflowId, state: run.currentState, status: run.status, steps: 0, halt: "lease_held" };
    }
    let final;
    try {
      final = await this.graph.invoke(
        { workflowId, state: leased.currentState, halt: null, steps: 0, maxSteps },
        { recursionLimit: maxSteps * 2 + 10 },
      );
    } catch (err) {
      // A simulated crash must look like a dead process: the lease stays behind.
      if (err instanceof SimulatedCrash) throw err;
      await this.releaseLease(workflowId);
      if (err instanceof FlowConflictError) {
        // Another worker advanced this run (e.g. after our lease expired mid-step). Nothing was applied twice.
        const run = (await getRun(this.sql, workflowId))!;
        return { workflowId, state: run.currentState, status: run.status, steps: 0, halt: "conflict" };
      }
      throw err;
    }
    await this.releaseLease(workflowId);
    const run = (await getRun(this.sql, workflowId))!;
    return { workflowId, state: run.currentState, status: run.status, steps: final.steps, halt: (final.halt ?? "max_steps") as AdvanceResult["halt"] };
  }

  /** Records an owner decision on a pending approval. Authorization is the caller's job (requireOwner). */
  async decideApproval(input: { approvalId: string; decision: "approved" | "rejected"; actor: string; reason?: string; audit?: InTxAudit<ApprovalRow> }): Promise<ApprovalRow> {
    return this.sql.transaction(async (tx) => {
      const row = await maybeOne<Record<string, unknown>>(
        tx,
        `update public.flow_approvals set status = $2, decided_by = $3, reason = $4, decided_at = $5
         where id = $1 and status = 'pending' returning *`,
        [input.approvalId, input.decision, input.actor, input.reason ? redactSecrets(input.reason).slice(0, 2000) : null, this.clock()],
      );
      if (!row) throw new FlowConflictError("approval not found or already decided");
      const approval = mapApproval(row);
      const run = mapRun(await one(tx, "select * from public.flow_runs where workflow_id = $1 for update", [approval.workflowId]));
      if (run.currentState !== APPROVAL_GATES[approval.kind].state) throw new FlowConflictError("run is not waiting on this approval");
      await tx.query("update public.flow_runs set status = 'running', next_attempt_at = null where workflow_id = $1", [run.workflowId]);
      await appendEvent(tx, run, {
        type: "approval_decided",
        from: run.currentState,
        stateVersion: run.stateVersion,
        actor: input.actor,
        detail: { approvalId: approval.id, kind: approval.kind, decision: input.decision, reason: input.reason ?? null },
      });
      await input.audit?.(tx, approval);
      return approval;
    });
  }

  /**
   * Inbound webhook. Deduplicated on (provider, event_id): a duplicate is
   * recorded as suppressed and changes nothing else.
   */
  async ingestWebhook(input: { provider: string; eventId: string; type: string; payload: unknown }): Promise<{ duplicate: boolean; outcome: string; workflowId?: string }> {
    return this.sql.transaction(async (tx) => {
      const inserted = await maybeOne<{ provider: string }>(
        tx,
        `insert into public.flow_webhook_events (provider, event_id, type, payload) values ($1, $2, $3, $4::jsonb)
         on conflict (provider, event_id) do nothing returning provider`,
        [input.provider, input.eventId, input.type, JSON.stringify(input.payload ?? {})],
      );
      if (!inserted) {
        const prior = await maybeOne<{ workflow_id: string | null }>(tx, "select workflow_id from public.flow_webhook_events where provider = $1 and event_id = $2", [input.provider, input.eventId]);
        if (prior?.workflow_id) {
          const run = mapRun(await one(tx, "update public.flow_runs set duplicates_suppressed = duplicates_suppressed + 1 where workflow_id = $1 returning *", [prior.workflow_id]));
          await appendEvent(tx, run, { type: "webhook_duplicate", from: run.currentState, actor: `webhook:${input.provider}`, detail: { eventId: input.eventId, type: input.type } });
        }
        return { duplicate: true, outcome: "duplicate_suppressed", workflowId: prior?.workflow_id ?? undefined };
      }

      const schema = WebhookPayloads[input.type as WebhookType];
      const parsed = schema?.safeParse(input.payload);
      if (!schema || !parsed?.success) {
        await tx.query("update public.flow_webhook_events set outcome = 'rejected_invalid' where provider = $1 and event_id = $2", [input.provider, input.eventId]);
        return { duplicate: false, outcome: "rejected_invalid" };
      }
      const data = parsed.data as { workflowId: string } & Record<string, unknown>;
      const runRow = await maybeOne<Record<string, unknown>>(tx, "select * from public.flow_runs where workflow_id = $1 for update", [data.workflowId]);
      if (!runRow) {
        await tx.query("update public.flow_webhook_events set outcome = 'unknown_workflow' where provider = $1 and event_id = $2", [input.provider, input.eventId]);
        return { duplicate: false, outcome: "unknown_workflow" };
      }
      const run = mapRun(runRow);
      await tx.query("update public.flow_webhook_events set workflow_id = $3 where provider = $1 and event_id = $2", [input.provider, input.eventId, run.workflowId]);

      let patch: Partial<RunOutput> | undefined;
      if (input.type === "lead.reply" && run.currentState === "WAITING_FOR_REPLY" && !run.output.reply) {
        patch = { reply: { outcome: data.outcome as "accepted" | "declined", eventId: input.eventId } };
      } else if (input.type === "payment.succeeded" && run.currentState === "PAYMENT_CONFIRMATION" && !run.output.payment) {
        patch = { payment: { eventId: input.eventId, invoiceId: data.invoiceId as string, amountCents: data.amountCents as number } };
        await insertEvidence(tx, run, { kind: "payment", passed: null, content: { eventId: input.eventId, invoiceId: data.invoiceId, amountCents: data.amountCents } });
      }
      const outcome = patch ? "applied" : "ignored_out_of_order";
      await tx.query("update public.flow_webhook_events set outcome = $3 where provider = $1 and event_id = $2", [input.provider, input.eventId, outcome]);
      if (patch) {
        await tx.query("update public.flow_runs set output = output || $2::jsonb, status = 'running', next_attempt_at = null where workflow_id = $1", [run.workflowId, JSON.stringify(patch)]);
      }
      await appendEvent(tx, run, { type: patch ? "webhook_received" : "webhook_ignored", from: run.currentState, actor: `webhook:${input.provider}`, detail: { eventId: input.eventId, type: input.type } });
      return { duplicate: false, outcome, workflowId: run.workflowId };
    });
  }

  /** Operator retry for failed/blocked runs. Authorization is the caller's job. */
  async retryRun(workflowId: string, actor: string, audit?: InTxAudit<FlowRun>): Promise<void> {
    await this.sql.transaction(async (tx) => {
      const row = await maybeOne<Record<string, unknown>>(
        tx,
        "update public.flow_runs set status = 'running', retry_count = 0, next_attempt_at = null, last_error = null where workflow_id = $1 and status in ('failed', 'blocked') returning *",
        [workflowId],
      );
      if (!row) throw new FlowConflictError("run is not failed or blocked");
      const run = mapRun(row);
      await appendEvent(tx, run, { type: "operator_retry", from: run.currentState, stateVersion: run.stateVersion, actor });
      await audit?.(tx, run);
    });
  }

  /** Runs the worker should pick up now. */
  async dueRuns(limit = 25): Promise<string[]> {
    const rows = await this.sql.query<{ workflow_id: string }>(
      `select workflow_id from public.flow_runs
       where status in ('running', 'retry_wait', 'waiting_timer', 'waiting_event')
         and (next_attempt_at is null or next_attempt_at <= $1)
         and (status = 'running' or next_attempt_at is not null)
         and (lease_owner is null or lease_expires_at < $1)
       order by updated_at limit $2`,
      [this.clock(), limit],
    );
    return rows.map((r) => r.workflow_id);
  }

  /* ---------------------------------------------------------------- lease */

  private async acquireLease(workflowId: string): Promise<FlowRun | undefined> {
    return this.sql.transaction(async (tx) => {
      const row = await maybeOne<Record<string, unknown>>(tx, "select * from public.flow_runs where workflow_id = $1 for update", [workflowId]);
      if (!row) return undefined;
      const run = mapRun(row);
      const now = this.clock();
      const heldByOther = run.leaseOwner && run.leaseOwner !== this.workerId && run.leaseExpiresAt && run.leaseExpiresAt > now;
      if (heldByOther) return undefined;
      // A lease left behind by another worker means that worker died mid-step.
      const recovered = !!run.leaseOwner && run.leaseOwner !== this.workerId;
      const updated = mapRun(
        await one(
          tx,
          `update public.flow_runs set lease_owner = $2, lease_expires_at = $3, recovery_count = recovery_count + $4 where workflow_id = $1 returning *`,
          [workflowId, this.workerId, new Date(now.getTime() + this.leaseMs), recovered ? 1 : 0],
        ),
      );
      if (recovered) {
        await appendEvent(tx, updated, {
          type: "recovered",
          from: updated.currentState,
          stateVersion: updated.stateVersion,
          detail: { previousWorker: run.leaseOwner, leaseExpiredAt: run.leaseExpiresAt },
        });
      }
      return updated;
    });
  }

  private async renewLease(workflowId: string): Promise<void> {
    await this.sql.query("update public.flow_runs set lease_expires_at = $3 where workflow_id = $1 and lease_owner = $2", [
      workflowId,
      this.workerId,
      new Date(this.clock().getTime() + this.leaseMs),
    ]);
  }

  private async releaseLease(workflowId: string): Promise<void> {
    await this.sql.query("update public.flow_runs set lease_owner = null, lease_expires_at = null where workflow_id = $1 and lease_owner = $2", [workflowId, this.workerId]);
  }

  /* ---------------------------------------------------------------- graph */

  private buildGraph() {
    const GraphState = Annotation.Root({
      workflowId: Annotation<string>(),
      state: Annotation<Flow01State>(),
      halt: Annotation<AdvanceResult["halt"] | null>(),
      steps: Annotation<number>(),
      maxSteps: Annotation<number>(),
    });
    type GS = typeof GraphState.State;

    const route = (gs: GS): string => (gs.halt ? END : gs.steps >= gs.maxSteps ? END : gs.state);
    // Nodes are added dynamically from the state list, so the builder is typed loosely here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = new StateGraph(GraphState);
    for (const s of FLOW01_STATES) {
      g.addNode(s, async (gs: GS) => this.stepNode(gs, s));
    }
    g.addNode("load", async (gs: GS) => {
      const run = await getRun(this.sql, gs.workflowId);
      return run ? { state: run.currentState } : { halt: "not_found" };
    });
    g.addEdge(START, "load");
    const targets = [...FLOW01_STATES, END];
    g.addConditionalEdges("load", route, targets);
    for (const s of FLOW01_STATES) g.addConditionalEdges(s, route, targets);
    return g.compile() as { invoke(input: GS, config: { recursionLimit: number }): Promise<GS> };
  }

  private async stepNode(gs: { workflowId: string; steps: number }, expected: Flow01State) {
    const run = await getRun(this.sql, gs.workflowId);
    if (!run) return { halt: "not_found" as const };
    if (run.currentState !== expected) return { state: run.currentState, steps: gs.steps };
    const now = this.clock();

    if (TERMINAL_STATES.includes(run.currentState)) return { halt: "terminal" as const };
    if (run.status === "failed") return { halt: "failed" as const };
    if (run.status === "blocked") return { halt: "blocked" as const };
    if (run.status === "retry_wait" && run.nextAttemptAt && run.nextAttemptAt > now) return { halt: "retry_scheduled" as const };
    if ((run.status === "waiting_timer" || run.status === "waiting_event") && run.nextAttemptAt && run.nextAttemptAt > now && !run.output.reply && !run.output.payment) {
      return { halt: "waiting" as const };
    }

    await this.renewLease(run.workflowId);
    const started = performance.now();
    let outcome: StepOutcome;
    try {
      outcome = await withTimeout(this.handle(run), FLOW01_POLICY.limits.stepTimeoutMs, `${run.currentState} step timed out`);
    } catch (err) {
      if (err instanceof SimulatedCrash) throw err;
      outcome =
        err instanceof FirewallBlocked
          ? { type: "fail", status: "blocked", error: errorMessage(err) }
          : { type: "retry", error: errorMessage(err) };
    }
    const elapsed = Math.round(performance.now() - started);
    const applied = await this.apply(run, outcome, elapsed);
    return { ...applied, steps: gs.steps + 1 };
  }

  /* ---------------------------------------------------------------- apply */

  private async apply(run: FlowRun, o: StepOutcome, elapsedMs: number): Promise<{ state: Flow01State; halt: AdvanceResult["halt"] | null }> {
    const m = { ...o.metrics, activeComputeMs: (o.metrics?.activeComputeMs ?? 0) + elapsedMs };
    const metricsSql = `model_calls = model_calls + $M1, tokens_in = tokens_in + $M2, tokens_out = tokens_out + $M3,
      est_cost_micro_usd = est_cost_micro_usd + $M4, active_compute_ms = active_compute_ms + $M5,
      approvals_total = approvals_total + $M6, failures_total = failures_total + $M7`;
    const metricParams = [m.modelCalls ?? 0, m.tokensIn ?? 0, m.tokensOut ?? 0, m.estCostMicroUsd ?? 0, m.activeComputeMs ?? 0, m.approvalsTotal ?? 0, m.failuresTotal ?? 0];
    const withMetrics = (sqlText: string, base: unknown[]) => {
      let text = sqlText;
      metricParams.forEach((_, i) => (text = text.replace(`$M${i + 1}`, `$${base.length + i + 1}`)));
      return { text, params: [...base, ...metricParams] };
    };

    return this.sql.transaction(async (tx) => {
      const now = this.clock();
      if (o.type === "transition") {
        if (!isAllowedTransition(run.currentState, o.to)) throw new Error(`engine bug: illegal transition ${run.currentState} -> ${o.to}`);
        const evidenceIds: string[] = [];
        for (const ev of o.evidence ?? []) evidenceIds.push(await insertEvidence(tx, run, ev));
        const terminal = TERMINAL_STATES.includes(o.to);
        const status: RunStatus = terminal ? (o.to === "ACTIVE" ? "completed" : "closed") : "running";
        const q = withMetrics(
          `update public.flow_runs set current_state = $3, previous_state = $4, state_version = state_version + 1,
             status = $5, output = output || $6::jsonb, evidence_ids = evidence_ids || $7::uuid[],
             validator_result = coalesce($8::jsonb, validator_result), approval_id = $9,
             retry_count = 0, last_error = null, next_attempt_at = $10, completed_at = $11, ${metricsSql}
           where workflow_id = $1 and state_version = $2 returning *`,
          [
            run.workflowId,
            run.stateVersion,
            o.to,
            run.currentState,
            status,
            JSON.stringify(o.patch ?? {}),
            evidenceIds,
            o.validator === undefined ? null : JSON.stringify(o.validator),
            o.approvalId === undefined ? run.approvalId : o.approvalId,
            o.nextAttemptAt ?? null,
            terminal ? now : null,
          ],
        );
        const row = await maybeOne<Record<string, unknown>>(tx, q.text, q.params);
        if (!row) throw new FlowConflictError("state_version changed underneath this step");
        await appendEvent(tx, run, { type: "transition", from: run.currentState, to: o.to, stateVersion: run.stateVersion + 1, detail: { ...o.detail, evidenceIds } });
        return { state: o.to, halt: terminal ? "terminal" : null };
      }

      if (o.type === "wait") {
        const q = withMetrics(`update public.flow_runs set status = $2, next_attempt_at = $3, ${metricsSql} where workflow_id = $1`, [run.workflowId, o.status, o.nextAttemptAt ?? null]);
        await tx.query(q.text, q.params);
        if (run.status !== o.status) await appendEvent(tx, run, { type: o.status, from: run.currentState, stateVersion: run.stateVersion, detail: o.detail });
        return { state: run.currentState, halt: "waiting" };
      }

      const evidenceIds: string[] = [];
      for (const ev of o.evidence ?? []) evidenceIds.push(await insertEvidence(tx, run, ev));

      if (o.type === "retry" && run.retryCount < FLOW01_POLICY.limits.maxRetries) {
        const delay = this.retryBaseMs * 2 ** run.retryCount;
        const next = new Date(now.getTime() + delay);
        const q = withMetrics(
          `update public.flow_runs set status = 'retry_wait', retry_count = retry_count + 1, retries_total = retries_total + 1,
             last_error = $2, next_attempt_at = $3, validator_result = coalesce($4::jsonb, validator_result),
             evidence_ids = evidence_ids || $5::uuid[], ${metricsSql}
           where workflow_id = $1`,
          [run.workflowId, redactSecrets(o.error), next, o.validator === undefined ? null : JSON.stringify(o.validator), evidenceIds],
        );
        await tx.query(q.text, q.params);
        await appendEvent(tx, run, { type: "retry_scheduled", from: run.currentState, stateVersion: run.stateVersion, detail: { error: o.error, attempt: run.retryCount + 1, nextAttemptAt: next.toISOString() } });
        return { state: run.currentState, halt: "retry_scheduled" };
      }

      // Retries exhausted, or a hard failure: stop without advancing.
      const status = o.type === "fail" ? o.status : "failed";
      metricParams[6] = (metricParams[6] ?? 0) + 1; // failures_total
      const q = withMetrics(
        `update public.flow_runs set status = $2, last_error = $3, next_attempt_at = null,
           output = output || $4::jsonb,
           validator_result = coalesce($5::jsonb, validator_result), evidence_ids = evidence_ids || $6::uuid[], ${metricsSql}
         where workflow_id = $1`,
        [
          run.workflowId,
          status,
          redactSecrets(o.error),
          JSON.stringify(o.type === "fail" ? (o.patch ?? {}) : {}),
          o.type === "retry" && o.validator !== undefined ? JSON.stringify(o.validator) : null,
          evidenceIds,
        ],
      );
      await tx.query(q.text, q.params);
      await appendEvent(tx, run, {
        type: status === "blocked" ? "blocked" : "step_failed",
        from: run.currentState,
        stateVersion: run.stateVersion,
        detail: { error: o.error, retriesExhausted: o.type === "retry" },
      });
      return { state: run.currentState, halt: status };
    });
  }

  /* ---------------------------------------------------------- side effects */

  /**
   * Ledgered side effect. Marks 'started' (committed) before calling out; a
   * crash between the call and 'succeeded' leaves 'started', and the next
   * attempt calls again with the SAME idempotency key so the provider returns
   * the original result instead of acting twice.
   */
  private async effect<T>(run: FlowRun, adapter: string, operation: string, key: string, request: unknown, fn: () => Promise<T>): Promise<T> {
    const existing = await maybeOne<{ status: string; result: T }>(this.sql, "select status, result from public.flow_side_effects where idempotency_key = $1", [key]);
    if (existing?.status === "succeeded") return existing.result;
    if (existing) {
      await this.sql.query("update public.flow_side_effects set attempts = attempts + 1, status = 'started', updated_at = now() where idempotency_key = $1", [key]);
    } else {
      await this.sql.query(
        `insert into public.flow_side_effects (idempotency_key, workflow_id, tenant_id, adapter, operation, status, request_hash)
         values ($1, $2, $3, $4, $5, 'started', $6)`,
        [key, run.workflowId, run.tenantId, adapter, operation, payloadHash(request)],
      );
    }
    await this.hooks.afterLedgerStarted?.(key);
    try {
      const result = await fn();
      await this.sql.query("update public.flow_side_effects set status = 'succeeded', result = $2::jsonb, updated_at = now() where idempotency_key = $1", [key, JSON.stringify(result ?? null)]);
      return result;
    } catch (err) {
      if (err instanceof SimulatedCrash) throw err;
      await this.sql.query("update public.flow_side_effects set status = 'failed', result = $2::jsonb, updated_at = now() where idempotency_key = $1", [key, JSON.stringify({ error: errorMessage(err) })]);
      throw err;
    }
  }

  /* ------------------------------------------------------------- firewall */

  private authorize(run: FlowRun, request: { payloadHash: string; recipients?: string[]; amountCents?: number }, approval?: ApprovalRow) {
    const action = STATE_ACTION[run.currentState];
    const decision = evaluateAction(
      FLOW01_POLICY,
      { action, payloadHash: request.payloadHash, tainted: false, target: { recipients: request.recipients, amountCents: request.amountCents } },
      { approval: approval && { id: approval.id, action: approval.actionClass as never, payloadHash: approval.payloadHash, decision: approval.status === "approved" ? "approved" : "rejected" }, now: this.clock() },
    );
    if (decision.outcome !== "execute") throw new FirewallBlocked(`${action} not authorised: ${decision.reason}`);
    return decision;
  }

  private async requestApproval(run: FlowRun, kind: ApprovalKind, payload: unknown): Promise<StepOutcome | ApprovalRow> {
    const hash = payloadHash(payload);
    const existing = await findApproval(this.sql, run.workflowId, kind, hash);
    if (existing?.status === "pending") return { type: "wait", status: "waiting_approval", detail: { approvalId: existing.id, kind } };
    if (existing) return existing;
    const created = await this.sql.transaction(async (tx) => {
      const row = mapApproval(
        await one(
          tx,
          `insert into public.flow_approvals (workflow_id, tenant_id, kind, action_class, payload, payload_hash, requested_state_version)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning *`,
          [run.workflowId, run.tenantId, kind, APPROVAL_GATES[kind].action, JSON.stringify(payload), hash, run.stateVersion],
        ),
      );
      await appendEvent(tx, run, { type: "approval_requested", from: run.currentState, stateVersion: run.stateVersion, detail: { approvalId: row.id, kind } });
      return row;
    });
    return { type: "wait", status: "waiting_approval", detail: { approvalId: created.id, kind }, metrics: { approvalsTotal: 1 } };
  }

  /* -------------------------------------------------------------- handlers */

  private async handle(run: FlowRun): Promise<StepOutcome> {
    const out = run.output;
    const lead = run.lead;
    switch (run.currentState) {
      case "NEW_LEAD": {
        const parsed = Lead.safeParse(lead);
        if (!parsed.success) return { type: "fail", status: "blocked", error: "lead failed validation" };
        return { type: "transition", to: "SOURCE_VERIFICATION" };
      }

      case "SOURCE_VERIFICATION": {
        const website = new URL(lead.website).hostname.replace(/^www\./, "").toLowerCase();
        const emailDomain = lead.email.split("@")[1]!.toLowerCase();
        const sourceOk = (ALLOWED_LEAD_SOURCES as readonly string[]).includes(lead.source);
        const domainOk = emailDomain === website || emailDomain.endsWith(`.${website}`) || website.endsWith(`.${emailDomain}`);
        const passed = sourceOk && domainOk;
        const evidence: EvidenceInput = { kind: "source_verification", passed, content: { source: lead.source, sourceOk, emailDomain, website, domainOk } };
        if (!passed) return { type: "transition", to: "DISQUALIFIED", evidence: [evidence], detail: { reason: "source verification failed" } };
        // The verified contact comes from the lead record, never from model output.
        return { type: "transition", to: "RESEARCH", evidence: [evidence], patch: { verifiedContact: lead.email.toLowerCase() } };
      }

      case "RESEARCH": {
        const prompt = assemblePrompt({
          system: "You are a B2B research analyst. Return only the requested JSON fields.",
          task: "Summarise the company, estimate headcount, list fit signals and risks, and score fit 0-100.",
          context: [{ source: "third_party_message", ref: "lead-form", text: JSON.stringify({ company: lead.company, website: lead.website }) }],
        });
        const key = `${run.workflowId}:research:v${run.stateVersion}:a${run.retryCount}`;
        let result;
        try {
          result = await this.effect(run, "research", "research", key, { v: run.stateVersion, a: run.retryCount }, () =>
            this.adapters.research.research({ idempotencyKey: key, lead, prompt: { system: prompt.messages[0]!.content, user: prompt.messages[1]!.content } }),
          );
        } catch (err) {
          if (err instanceof ModelTimeoutError) return { type: "retry", error: "model timeout during research", metrics: { modelCalls: 1 } };
          throw err;
        }
        const usage = { modelCalls: 1, tokensIn: result.usage.tokensIn, tokensOut: result.usage.tokensOut, estCostMicroUsd: result.usage.costMicroUsd };
        const signals = detectInjectionSignals(result.websiteText);
        const validated = ResearchOutput.safeParse(result.structured);
        if (!validated.success) {
          const validator = { ok: false, schema: "ResearchOutput", issues: validated.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
          return {
            type: "retry",
            error: "structured output rejected by schema",
            validator,
            evidence: [{ kind: "validator", passed: false, content: validator }],
            metrics: usage,
          };
        }
        const validator = { ok: true, schema: "ResearchOutput" };
        return {
          type: "transition",
          to: "RESEARCH_COMPLETE",
          patch: { research: validated.data, researchSignals: signals },
          validator,
          evidence: [
            { kind: "research", passed: true, content: { output: validated.data, injectionSignals: signals, model: result.usage.model } },
            { kind: "validator", passed: true, content: validator },
          ],
          metrics: usage,
        };
      }

      case "RESEARCH_COMPLETE":
        return { type: "transition", to: "QUALIFICATION_REVIEW" };

      case "QUALIFICATION_REVIEW": {
        // Deterministic rule — critical state changes never depend on free model judgement.
        const r = out.research!;
        const qualified = r.score >= QUALIFICATION_THRESHOLD && !r.disqualifying;
        return { type: "transition", to: qualified ? "QUALIFIED" : "DISQUALIFIED", detail: { rule: `score >= ${QUALIFICATION_THRESHOLD} and not disqualifying`, score: r.score, disqualifying: r.disqualifying } };
      }

      case "QUALIFIED":
        return { type: "transition", to: "PROPOSAL_DRAFT" };

      case "PROPOSAL_DRAFT": {
        const revision = (out.proposal?.revision ?? 0) + 1;
        const followUp = run.previousState === "FOLLOW_UP_DUE" ? (out.followUps ?? 0) : (out.proposal?.followUp ?? 0);
        const proposal = Proposal.parse({
          revision,
          followUp,
          // Recipient is the verified contact. Research output (derived from untrusted web content) never sets it.
          to: out.verifiedContact!,
          subject: followUp > 0 ? `Following up: PRFKT proposal for ${lead.company}` : `PRFKT proposal for ${lead.company}`,
          body: [
            `Hi ${lead.name},`,
            "",
            `Thanks for your interest in PRFKT. Based on your request we propose the ${lead.planSlug} system for ${lead.company}.`,
            `Price: ${(lead.priceCents / 100).toFixed(2)} USD setup, quoted after scoping for ongoing usage.`,
            out.lastRejection?.reason ? `Revised per review: ${out.lastRejection.reason}` : "",
            "Nothing is provisioned until you accept and payment is confirmed.",
            "",
            "— PRFKT",
          ]
            .filter((l) => l !== "")
            .join("\n"),
          planSlug: lead.planSlug,
          priceCents: lead.priceCents,
        });
        return { type: "transition", to: "WAITING_FOR_APPROVAL", patch: { proposal }, evidence: [{ kind: "proposal", passed: null, content: { revision, hash: payloadHash(proposal) } }] };
      }

      case "WAITING_FOR_APPROVAL": {
        const r = await this.requestApproval(run, "PROPOSAL_SEND", out.proposal!);
        if ("type" in r) return r;
        if (r.status === "approved") return { type: "transition", to: "APPROVED_FOR_SEND", approvalId: r.id, detail: { approvalId: r.id } };
        return { type: "transition", to: "REJECTED_FOR_REVISION", approvalId: null, patch: { lastRejection: { approvalId: r.id, reason: r.reason } }, detail: { approvalId: r.id } };
      }

      case "REJECTED_FOR_REVISION":
        return { type: "transition", to: "PROPOSAL_DRAFT" };

      case "APPROVED_FOR_SEND":
        return { type: "transition", to: "SEND_REQUESTED" };

      case "SEND_REQUESTED": {
        const proposal = out.proposal!;
        const approval = run.approvalId ? await getApproval(this.sql, run.approvalId) : undefined;
        this.authorize(run, { payloadHash: payloadHash(proposal), recipients: [proposal.to] }, approval);
        const limits = { ...FLOW01_POLICY.limits, allowedRecipients: [out.verifiedContact!] };
        const blast = checkBlastRadius(limits, ZERO_USAGE, { sends: 1, recipients: [proposal.to] });
        if (!blast.ok) return { type: "fail", status: "blocked", error: `blast radius: ${blast.detail}` };
        const key = `${run.workflowId}:email.send:${approval!.id}`;
        const sent = await this.effect(run, "email", "send", key, { to: proposal.to, hash: payloadHash(proposal) }, () =>
          this.adapters.email.send({ idempotencyKey: key, to: proposal.to, subject: proposal.subject, body: proposal.body }),
        );
        const sentAt = this.clock();
        return {
          type: "transition",
          to: "SENT",
          patch: { sentMessageId: sent.messageId, sentAt: sentAt.toISOString() },
          evidence: [{ kind: "send", passed: true, content: { messageId: sent.messageId, to: proposal.to, approvalId: approval!.id, revision: proposal.revision } }],
        };
      }

      case "SENT": {
        const followUpAt = new Date(this.clock().getTime() + FOLLOW_UP_AFTER_MS);
        return { type: "transition", to: "WAITING_FOR_REPLY", patch: { followUpAt: followUpAt.toISOString() }, nextAttemptAt: followUpAt };
      }

      case "WAITING_FOR_REPLY": {
        if (out.reply?.outcome === "accepted") return { type: "transition", to: "CUSTOMER_ACCEPTED", detail: { eventId: out.reply.eventId } };
        if (out.reply?.outcome === "declined") return { type: "transition", to: "LOST", detail: { eventId: out.reply.eventId } };
        const due = out.followUpAt ? new Date(out.followUpAt) : this.clock();
        if (this.clock() >= due) return { type: "transition", to: "FOLLOW_UP_DUE" };
        return { type: "wait", status: "waiting_timer", nextAttemptAt: due };
      }

      case "FOLLOW_UP_DUE": {
        const n = out.followUps ?? 0;
        if (n >= MAX_FOLLOW_UPS) return { type: "transition", to: "LOST", detail: { reason: "no reply after follow-ups" } };
        return { type: "transition", to: "PROPOSAL_DRAFT", patch: { followUps: n + 1 } };
      }

      case "CUSTOMER_ACCEPTED": {
        const proposal = out.proposal!;
        const key = `${run.workflowId}:payment.createInvoice`;
        // Draft invoice for exactly the approved proposal amount; payment itself is confirmed by webhook + owner approval.
        const invoice = await this.effect(run, "payment", "createInvoice", key, { amount: proposal.priceCents }, () =>
          this.adapters.payment.createInvoice({ idempotencyKey: key, customerEmail: proposal.to, amountCents: proposal.priceCents, reference: run.workflowId }),
        );
        return { type: "transition", to: "PAYMENT_CONFIRMATION", patch: { invoiceId: invoice.invoiceId } };
      }

      case "PAYMENT_CONFIRMATION": {
        if (!out.payment) return { type: "wait", status: "waiting_event", detail: { waitingFor: "payment.succeeded" } };
        const expected = out.proposal!.priceCents;
        if (out.payment.invoiceId !== out.invoiceId || out.payment.amountCents !== expected) {
          return { type: "fail", status: "blocked", error: `payment does not match invoice (${out.payment.invoiceId}, ${out.payment.amountCents} vs ${out.invoiceId}, ${expected})` };
        }
        const r = await this.requestApproval(run, "PAYMENT", { invoiceId: out.invoiceId, amountCents: expected, eventId: out.payment.eventId });
        if ("type" in r) return r;
        if (r.status === "rejected") return { type: "fail", status: "blocked", error: "payment reconciliation rejected by owner" };
        return { type: "transition", to: "PAYMENT_CONFIRMED", approvalId: r.id };
      }

      case "PAYMENT_CONFIRMED": {
        const plan = CellPlan.parse({
          tenantId: run.tenantId,
          cellName: `cell-${run.workflowId.slice(0, 8)}`,
          profile: "SAFE",
          runtime: "openclaw",
          modelPolicy: "local-first",
          limits: { maxToolActionsPerRun: 50, maxModelCostCentsPerDay: 500 },
          secretRefs: { modelProviderRef: `secret://${run.tenantId}/model-provider` },
        });
        return { type: "transition", to: "PROVISIONING_REVIEW", patch: { cellPlan: plan } };
      }

      case "PROVISIONING_REVIEW": {
        const r = await this.requestApproval(run, "PROVISIONING", out.cellPlan!);
        if ("type" in r) return r;
        if (r.status === "rejected") return { type: "fail", status: "blocked", error: "provisioning rejected by owner" };
        return { type: "transition", to: "PROVISIONING", approvalId: r.id };
      }

      case "PROVISIONING": {
        const plan = CellPlan.parse(out.cellPlan);
        const approval = run.approvalId ? await getApproval(this.sql, run.approvalId) : undefined;
        this.authorize(run, { payloadHash: payloadHash(out.cellPlan) }, approval);
        const key = `${run.workflowId}:provision:${approval!.id}`;
        try {
          const cell = await this.effect(run, "provisioner", "provision", key, plan, () => this.adapters.provisioner.provision({ idempotencyKey: key, plan }));
          return {
            type: "transition",
            to: "CONFIG_VALIDATION",
            patch: { cell },
            evidence: [{ kind: "provisioning", passed: true, content: { cellId: cell.cellId, resources: cell.resources } }],
          };
        } catch (err) {
          if (!(err instanceof ProvisionerError)) throw err;
          if (err.transient && run.retryCount < FLOW01_POLICY.limits.maxRetries) {
            // Resumable: the next attempt reuses the same key and only creates what is missing.
            return { type: "retry", error: err.message };
          }
          // Permanent or exhausted: compensate idempotently, then stop without advancing.
          const tkey = `${run.workflowId}:teardown:${approval!.id}:${run.metrics.failuresTotal}`;
          const removed = await this.effect(run, "provisioner", "teardown", tkey, { key }, () => this.adapters.provisioner.teardown({ idempotencyKey: key }));
          return {
            type: "fail",
            status: "failed",
            error: `provisioning failed and was compensated: ${err.message}`,
            evidence: [{ kind: "compensation", passed: true, content: { provisionKey: key, removed: removed.removed } }],
          };
        }
      }

      case "CONFIG_VALIDATION": {
        const cell = out.cell!;
        const problems: string[] = [];
        const parsed = CellPlan.safeParse(cell.config);
        if (!parsed.success) problems.push("config does not match the approved cell schema");
        if (cell.config.tenantId !== run.tenantId) problems.push("cell belongs to another tenant");
        if (cell.config.profile !== "SAFE") problems.push("customer cell must run SAFE by default");
        if (payloadHash(cell.config) !== payloadHash(out.cellPlan)) problems.push("provisioned config differs from the approved plan");
        try {
          assertNoSecretValues(cell.config, run.tenantId);
        } catch (e) {
          problems.push(errorMessage(e));
        }
        const passed = problems.length === 0;
        const evidence: EvidenceInput = { kind: "config_validation", passed, content: { cellId: cell.cellId, problems } };
        if (!passed) return { type: "fail", status: "blocked", error: `config validation failed: ${problems.join("; ")}`, evidence: [evidence] };
        return { type: "transition", to: "ACCEPTANCE_TEST", evidence: [evidence] };
      }

      case "ACCEPTANCE_TEST": {
        const cell = out.cell!;
        const result = await this.adapters.acceptance.run({ cellId: cell.cellId, config: cell.config });
        const evidenceId = await insertEvidence(this.sql, run, { kind: "acceptance_test", passed: result.passed, content: result });
        if (!result.passed) {
          const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
          return { type: "fail", status: "blocked", error: `acceptance test failed: ${failed.join(", ")}`, patch: { acceptance: { ...result, evidenceId } } };
        }
        return { type: "transition", to: "DEPLOYMENT_APPROVAL", patch: { acceptance: { ...result, evidenceId } }, detail: { evidenceId } };
      }

      case "DEPLOYMENT_APPROVAL": {
        const payload = { cellId: out.cell!.cellId, acceptanceEvidenceId: out.acceptance!.evidenceId };
        const r = await this.requestApproval(run, "PRODUCTION_ACTIVATION", payload);
        if ("type" in r) return r;
        if (r.status === "rejected") return { type: "fail", status: "blocked", error: "production activation rejected by owner" };
        this.authorize(run, { payloadHash: payloadHash(payload) }, r);
        return { type: "transition", to: "ACTIVE", approvalId: r.id };
      }

      case "DISQUALIFIED":
      case "LOST":
      case "ACTIVE":
        throw new Error("terminal state has no handler");
    }
  }
}

/* ================================================================= helpers */

export class FirewallBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirewallBlocked";
  }
}

/** Thrown by crash-injection hooks in tests; the engine never catches or records it. */
export class SimulatedCrash extends Error {
  constructor(where: string) {
    super(`simulated crash at ${where}`);
    this.name = "SimulatedCrash";
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
