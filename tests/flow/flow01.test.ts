import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeWorld } from "@/flow/flow01/fakes";
import { FlowConflictError, SimulatedCrash } from "@/flow/flow01/engine";
import { FLOW01_TRANSITIONS, FLOW01_STATES } from "@/flow/flow01/definition";
import { listApprovals, listEvents, listEvidence, listSideEffects } from "@/flow/flow01/store";
import {
  approve,
  driveFromReplyToProvisioning,
  driveToWaitingForReply,
  harness,
  LEAD,
  newRun,
  pendingApproval,
  state,
  transitionsInto,
  type Harness,
} from "./support";

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => h.db.close());

/** Every transition event must follow the declared graph, with contiguous versions. */
async function assertLegalHistory(workflowId: string) {
  const events = (await listEvents(h.sql, workflowId)).filter((e) => e.type === "transition");
  events.forEach((e, i) => {
    expect(FLOW01_TRANSITIONS[e.from_state as keyof typeof FLOW01_TRANSITIONS]).toContain(e.to_state);
    expect(e.state_version).toBe(i + 1);
  });
}

describe("FLOW 01 definition", () => {
  it("TypeScript transition graph equals the database transition table", async () => {
    const rows = await h.sql.query<{ from_state: string; to_state: string }>("select from_state, to_state from public.flow_transitions");
    const db = rows.map((r) => `${r.from_state}->${r.to_state}`).sort();
    const ts = FLOW01_STATES.flatMap((s) => FLOW01_TRANSITIONS[s].map((t) => `${s}->${t}`)).sort();
    expect(db).toEqual(ts);
  });

  it("run creation is idempotent on its key", async () => {
    const e = h.engine();
    const a = await e.createRun({ tenantId: h.tenantId, leadId: "L1", lead: LEAD, idempotencyKey: "intake-form-abc123" });
    const b = await e.createRun({ tenantId: h.tenantId, leadId: "L1", lead: LEAD, idempotencyKey: "intake-form-abc123" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.run.workflowId).toBe(a.run.workflowId);
  });
});

describe("Scenario 1 — normal path reaches ACTIVE exactly once", () => {
  it("runs Lead-to-Customer end to end with all four mandatory approvals", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);

    const first = await e.advance(wf);
    expect(first).toMatchObject({ state: "WAITING_FOR_APPROVAL", status: "waiting_approval", halt: "waiting" });
    expect(await fakeWorld.outbox(h.sql)).toHaveLength(0); // nothing sent before approval

    await approve(h, e, wf, "PROPOSAL_SEND");
    expect(await state(h.sql, wf)).toMatchObject({ currentState: "WAITING_FOR_REPLY", status: "waiting_timer" });
    expect(await fakeWorld.outbox(h.sql)).toHaveLength(1);

    const last = await driveFromReplyToProvisioning(h, e, wf);
    expect(last).toMatchObject({ state: "DEPLOYMENT_APPROVAL", status: "waiting_approval" });
    const done = await approve(h, e, wf, "PRODUCTION_ACTIVATION");
    expect(done).toMatchObject({ state: "ACTIVE", status: "completed", halt: "terminal" });

    // Advancing a completed run is a no-op.
    expect(await e.advance(wf)).toMatchObject({ state: "ACTIVE", steps: 0, halt: "terminal" });

    expect(await transitionsInto(h.sql, wf, "ACTIVE")).toBe(1);
    await assertLegalHistory(wf);
    expect(await fakeWorld.outbox(h.sql)).toHaveLength(1);
    expect(await fakeWorld.invoices(h.sql)).toHaveLength(1);
    expect(await fakeWorld.resources(h.sql)).toHaveLength(5);

    const run = await state(h.sql, wf);
    expect(run.completedAt).not.toBeNull();
    expect(run.metrics).toMatchObject({ modelCalls: 1, tokensIn: 1200, tokensOut: 300, estCostMicroUsd: 4200, approvalsTotal: 4, retriesTotal: 0, failuresTotal: 0, recoveryCount: 0 });
    expect(run.metrics.activeComputeMs).toBeGreaterThanOrEqual(0);
    const approvals = await listApprovals(h.sql, wf);
    expect(approvals.map((a) => `${a.kind}:${a.status}`)).toEqual(["PROPOSAL_SEND:approved", "PAYMENT:approved", "PROVISIONING:approved", "PRODUCTION_ACTIVATION:approved"]);
    const evidence = await listEvidence(h.sql, wf);
    expect(evidence.map((x) => x.kind)).toEqual(expect.arrayContaining(["source_verification", "research", "validator", "proposal", "send", "payment", "provisioning", "config_validation", "acceptance_test"]));
    expect(run.evidenceIds.length).toBeGreaterThan(5);
  });
});

describe("Scenario 2 — kill at WAITING_FOR_APPROVAL, restart, resume", () => {
  it("a fresh engine resumes from persisted state without re-running completed steps", async () => {
    const e1 = h.engine({ workerId: "worker-1" });
    const wf = await newRun(h, e1);
    await e1.advance(wf);
    expect((await state(h.sql, wf)).currentState).toBe("WAITING_FOR_APPROVAL");
    const researchCalls = await fakeWorld.calls(h.sql, "research", "research");
    const transitionsBefore = (await listEvents(h.sql, wf)).filter((x) => x.type === "transition").length;

    // "Restart": discard engine 1 entirely; engine 2 knows nothing but the database.
    const e2 = h.engine({ workerId: "worker-2" });
    await approve(h, e2, wf, "PROPOSAL_SEND");

    expect(await fakeWorld.calls(h.sql, "research", "research")).toBe(researchCalls);
    const events = (await listEvents(h.sql, wf)).filter((x) => x.type === "transition");
    expect(events.length).toBeGreaterThan(transitionsBefore);
    for (const s of ["SOURCE_VERIFICATION", "RESEARCH", "RESEARCH_COMPLETE", "QUALIFICATION_REVIEW", "QUALIFIED", "PROPOSAL_DRAFT", "WAITING_FOR_APPROVAL"]) {
      expect(await transitionsInto(h.sql, wf, s), s).toBe(1);
    }
    expect((await state(h.sql, wf)).currentState).toBe("WAITING_FOR_REPLY");
  });

  it("a crash after the email provider accepted the send, before the ledger committed, does not send twice", async () => {
    let armed = true;
    const crashing = h.engine({
      workerId: "worker-1",
      fakeHooks: {
        afterExternalEffect: (adapter) => {
          if (adapter === "email" && armed) {
            armed = false;
            throw new SimulatedCrash("after email.send");
          }
        },
      },
    });
    const wf = await newRun(h, crashing);
    await crashing.advance(wf);
    const a = await pendingApproval(h.sql, wf, "PROPOSAL_SEND");
    await crashing.decideApproval({ approvalId: a.id, decision: "approved", actor: "owner:o@prfkt.test" });
    await expect(crashing.advance(wf)).rejects.toThrow(SimulatedCrash);

    const mid = await state(h.sql, wf);
    expect(mid.currentState).toBe("SEND_REQUESTED");
    expect(mid.leaseOwner).toBe("worker-1"); // the dead worker's lease is left behind
    expect(await fakeWorld.outbox(h.sql)).toHaveLength(1); // provider already sent
    expect((await listSideEffects(h.sql, wf)).find((x) => x.operation === "send")?.status).toBe("started");

    // Another worker is locked out until the lease expires, then recovers.
    const e2 = h.engine({ workerId: "worker-2" });
    expect(await e2.advance(wf)).toMatchObject({ halt: "lease_held" });
    h.clock.tick(31_000);
    const resumed = await e2.advance(wf);
    expect(resumed.state).toBe("WAITING_FOR_REPLY");

    expect(await fakeWorld.outbox(h.sql)).toHaveLength(1);
    expect(await fakeWorld.calls(h.sql, "email", "send")).toBe(2); // re-called with the same key, deduped by provider
    const send = (await listSideEffects(h.sql, wf)).find((x) => x.operation === "send")!;
    expect(send).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(await transitionsInto(h.sql, wf, "SENT")).toBe(1);
    const run = await state(h.sql, wf);
    expect(run.metrics.recoveryCount).toBe(1);
    expect((await listEvents(h.sql, wf)).some((x) => x.type === "recovered")).toBe(true);
  });
});

describe("Scenario 3 — reject proposal", () => {
  it("rejection sends nothing and the revision needs a new approval", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await e.advance(wf);
    const first = await pendingApproval(h.sql, wf, "PROPOSAL_SEND");
    await e.decideApproval({ approvalId: first.id, decision: "rejected", actor: "owner:o@prfkt.test", reason: "Lead with the ops outcome, not price." });
    const after = await e.advance(wf);

    expect(after).toMatchObject({ state: "WAITING_FOR_APPROVAL", status: "waiting_approval" });
    expect(await fakeWorld.outbox(h.sql)).toHaveLength(0);
    expect(await fakeWorld.calls(h.sql, "email", "send")).toBe(0);
    expect(await transitionsInto(h.sql, wf, "REJECTED_FOR_REVISION")).toBe(1);

    const second = await pendingApproval(h.sql, wf, "PROPOSAL_SEND");
    expect(second.id).not.toBe(first.id);
    expect(second.payloadHash).not.toBe(first.payloadHash);
    expect((second.payload as { revision: number }).revision).toBe(2);

    // The rejected approval cannot be flipped to approved afterwards.
    await expect(e.decideApproval({ approvalId: first.id, decision: "approved", actor: "owner:o@prfkt.test" })).rejects.toThrow(FlowConflictError);
    await expect(h.sql.query("update public.flow_approvals set status = 'approved', decided_at = now() where id = $1", [first.id])).rejects.toThrow(/already decided/);

    await e.decideApproval({ approvalId: second.id, decision: "approved", actor: "owner:o@prfkt.test" });
    await e.advance(wf);
    const outbox = await fakeWorld.outbox(h.sql);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.body).toContain("Revised per review: Lead with the ops outcome");
  });

  it("the database refuses APPROVED_FOR_SEND without an approved approval", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await e.advance(wf);
    await expect(
      h.sql.query(
        "update public.flow_runs set current_state = 'APPROVED_FOR_SEND', previous_state = 'WAITING_FOR_APPROVAL', state_version = state_version + 1 where workflow_id = $1",
        [wf],
      ),
    ).rejects.toThrow(/requires an approved PROPOSAL_SEND/);
  });
});

describe("Scenario 4 — duplicate webhook", () => {
  it("duplicate reply and payment deliveries cause one transition and no duplicate side effects", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);

    const reply = { provider: "fake-email", eventId: "evt-reply-1", type: "lead.reply", payload: { workflowId: wf, outcome: "accepted" } };
    const results = await Promise.all([e.ingestWebhook(reply), e.ingestWebhook(reply), e.ingestWebhook(reply)]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(2);
    await e.advance(wf);
    expect(await e.ingestWebhook(reply)).toMatchObject({ duplicate: true });
    await e.advance(wf);

    expect(await transitionsInto(h.sql, wf, "CUSTOMER_ACCEPTED")).toBe(1);
    expect(await fakeWorld.invoices(h.sql)).toHaveLength(1);

    const run = await state(h.sql, wf);
    const pay = { provider: "fake-pay", eventId: "evt-pay-1", type: "payment.succeeded", payload: { workflowId: wf, invoiceId: run.output.invoiceId, amountCents: LEAD.priceCents } };
    await e.ingestWebhook(pay);
    await e.advance(wf);
    await e.ingestWebhook(pay);
    await e.advance(wf);
    expect((await listApprovals(h.sql, wf)).filter((a) => a.kind === "PAYMENT")).toHaveLength(1);
    await approve(h, e, wf, "PAYMENT");
    await e.ingestWebhook(pay);
    await e.advance(wf);
    expect(await transitionsInto(h.sql, wf, "PAYMENT_CONFIRMED")).toBe(1);
    expect((await listEvidence(h.sql, wf)).filter((x) => x.kind === "payment")).toHaveLength(1);
    expect((await state(h.sql, wf)).metrics.duplicatesSuppressed).toBe(5);
  });

  it("an out-of-order event is recorded but changes nothing", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await e.advance(wf);
    const r = await e.ingestWebhook({ provider: "fake-pay", eventId: "early-pay", type: "payment.succeeded", payload: { workflowId: wf, invoiceId: "inv_x", amountCents: 1 } });
    expect(r.outcome).toBe("ignored_out_of_order");
    expect((await state(h.sql, wf)).currentState).toBe("WAITING_FOR_APPROVAL");
  });

  it("a payment that does not match the invoice blocks instead of confirming", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    await e.ingestWebhook({ provider: "fake-email", eventId: "r", type: "lead.reply", payload: { workflowId: wf, outcome: "accepted" } });
    await e.advance(wf);
    const run = await state(h.sql, wf);
    await e.ingestWebhook({ provider: "fake-pay", eventId: "p", type: "payment.succeeded", payload: { workflowId: wf, invoiceId: run.output.invoiceId, amountCents: 100 } });
    expect(await e.advance(wf)).toMatchObject({ state: "PAYMENT_CONFIRMATION", status: "blocked" });
    expect((await listApprovals(h.sql, wf)).filter((a) => a.kind === "PAYMENT")).toHaveLength(0);
  });
});

describe("Scenario 5 — model timeout", () => {
  it("retries with backoff and advances only after a successful call", async () => {
    const e = h.engine({ faults: { research: { timeouts: 2 } } });
    const wf = await newRun(h, e);
    expect(await e.advance(wf)).toMatchObject({ state: "RESEARCH", status: "retry_wait", halt: "retry_scheduled" });
    expect(await e.advance(wf)).toMatchObject({ state: "RESEARCH", halt: "retry_scheduled", steps: 0 }); // not due yet
    h.clock.tick(1_000);
    expect(await e.advance(wf)).toMatchObject({ state: "RESEARCH", status: "retry_wait" });
    h.clock.tick(2_000);
    expect(await e.advance(wf)).toMatchObject({ state: "WAITING_FOR_APPROVAL" });
    const run = await state(h.sql, wf);
    expect(run.metrics).toMatchObject({ retriesTotal: 2, modelCalls: 3 });
    expect(run.retryCount).toBe(0);
  });

  it("stops at the retry ceiling without advancing", async () => {
    const e = h.engine({ faults: { research: { timeouts: 100 } } });
    const wf = await newRun(h, e);
    for (let i = 0; i < 10; i++) {
      await e.advance(wf);
      h.clock.tick(60_000);
    }
    const run = await state(h.sql, wf);
    expect(run).toMatchObject({ currentState: "RESEARCH", status: "failed" });
    expect(run.lastError).toMatch(/model timeout/);
    expect(run.metrics.modelCalls).toBe(4); // 1 + maxRetries(3)
    expect(await fakeWorld.calls(h.sql, "research", "research")).toBe(4);
    expect(await transitionsInto(h.sql, wf, "RESEARCH_COMPLETE")).toBe(0);
    expect(await e.advance(wf)).toMatchObject({ halt: "failed", steps: 0 });
  });
});

describe("Scenario 6 — malformed structured output", () => {
  it("rejects output that fails the schema and keeps it out of run state", async () => {
    const e = h.engine({ faults: { research: { malformed: 1 } } });
    const wf = await newRun(h, e);
    await e.advance(wf);
    let run = await state(h.sql, wf);
    expect(run).toMatchObject({ currentState: "RESEARCH", status: "retry_wait" });
    expect(run.output.research).toBeUndefined();
    expect(run.validatorResult).toMatchObject({ ok: false, schema: "ResearchOutput" });
    const issues = (run.validatorResult as { issues: { path: string }[] }).issues.map((i) => i.path);
    expect(issues).toEqual(expect.arrayContaining(["score", "employeeEstimate"]));
    expect((await listEvidence(h.sql, wf)).find((x) => x.kind === "validator")?.passed).toBe(false);

    h.clock.tick(1_000);
    await e.advance(wf);
    run = await state(h.sql, wf);
    expect(run.currentState).toBe("WAITING_FOR_APPROVAL");
    expect(run.validatorResult).toMatchObject({ ok: true });
    expect(run.output.research?.score).toBe(78);
  });

  it("persistently malformed output fails the step instead of advancing", async () => {
    const e = h.engine({ faults: { research: { malformed: 100 } } });
    const wf = await newRun(h, e);
    for (let i = 0; i < 8; i++) {
      await e.advance(wf);
      h.clock.tick(60_000);
    }
    expect(await state(h.sql, wf)).toMatchObject({ currentState: "RESEARCH", status: "failed" });
    expect(await transitionsInto(h.sql, wf, "RESEARCH_COMPLETE")).toBe(0);
  });
});

describe("Scenario 7 — provisioner failure", () => {
  it("transient failures resume idempotently to exactly one set of resources", async () => {
    const e = h.engine({ faults: { provisioner: { transientFailures: 2, failAfterResources: 2 } } });
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    const r = await driveFromReplyToProvisioning(h, e, wf);
    expect(r).toMatchObject({ state: "PROVISIONING", status: "retry_wait" });
    expect(await fakeWorld.resources(h.sql)).toHaveLength(2);
    h.clock.tick(1_000);
    await e.advance(wf);
    h.clock.tick(2_000);
    const done = await e.advance(wf);
    expect(done).toMatchObject({ state: "DEPLOYMENT_APPROVAL" });
    const resources = await fakeWorld.resources(h.sql);
    expect(resources).toHaveLength(5);
    expect(new Set(resources.map((x) => x.idempotency_key)).size).toBe(1);
    const ledger = (await listSideEffects(h.sql, wf)).filter((x) => x.operation === "provision");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ status: "succeeded", attempts: 3 });
    expect(await transitionsInto(h.sql, wf, "CONFIG_VALIDATION")).toBe(1);
  });

  it("a permanent failure compensates idempotently and does not advance", async () => {
    const e = h.engine({ faults: { provisioner: { permanent: true, failAfterResources: 3 } } });
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    const r = await driveFromReplyToProvisioning(h, e, wf);
    expect(r).toMatchObject({ state: "PROVISIONING", status: "failed" });
    expect(await fakeWorld.resources(h.sql)).toHaveLength(0);
    expect((await listEvidence(h.sql, wf)).filter((x) => x.kind === "compensation")).toHaveLength(1);

    // Operator retry: fails again, compensates again, still nothing left behind.
    await e.retryRun(wf, "owner:o@prfkt.test");
    expect(await e.advance(wf)).toMatchObject({ state: "PROVISIONING", status: "failed" });
    expect(await fakeWorld.resources(h.sql)).toHaveLength(0);
    expect(await fakeWorld.calls(h.sql, "provisioner", "teardown")).toBe(2);
    expect(await transitionsInto(h.sql, wf, "CONFIG_VALIDATION")).toBe(0);
  });
});

describe("Scenario 8 — failed acceptance blocks ACTIVE", () => {
  it("blocks at ACCEPTANCE_TEST; the database refuses ACTIVE even if forced; a passing re-run proceeds", async () => {
    const e = h.engine({ faults: { acceptance: { failures: 1 } } });
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    const r = await driveFromReplyToProvisioning(h, e, wf);
    expect(r).toMatchObject({ state: "ACCEPTANCE_TEST", status: "blocked", halt: "blocked" });
    const run = await state(h.sql, wf);
    expect(run.lastError).toMatch(/acceptance test failed: tenant-isolation/);
    expect(await e.advance(wf)).toMatchObject({ halt: "blocked", steps: 0 });

    // Force the path directly in SQL with a fabricated approval: ACTIVE must still be refused.
    await h.sql.transaction(async (tx) => {
      await tx.query("update public.flow_runs set current_state = 'DEPLOYMENT_APPROVAL', previous_state = 'ACCEPTANCE_TEST', state_version = state_version + 1 where workflow_id = $1", [wf]);
    });
    const fake = await h.sql.query<{ id: string }>(
      `insert into public.flow_approvals (workflow_id, tenant_id, kind, action_class, payload, payload_hash, requested_state_version, status, decided_by, decided_at)
       values ($1, $2, 'PRODUCTION_ACTIVATION', 'DEPLOY', '{}'::jsonb, 'forged', 0, 'approved', 'attacker', now()) returning id`,
      [wf, h.tenantId],
    );
    await expect(
      h.sql.query("update public.flow_runs set current_state = 'ACTIVE', previous_state = 'DEPLOYMENT_APPROVAL', state_version = state_version + 1, approval_id = $2 where workflow_id = $1", [wf, fake[0]!.id]),
    ).rejects.toThrow(/latest acceptance test to have passed/);
    expect(await transitionsInto(h.sql, wf, "ACTIVE")).toBe(0);
  });

  it("after an operator retry with a passing acceptance run, activation is possible", async () => {
    const e = h.engine({ faults: { acceptance: { failures: 1 } } });
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    await driveFromReplyToProvisioning(h, e, wf);
    await e.retryRun(wf, "owner:o@prfkt.test");
    expect(await e.advance(wf)).toMatchObject({ state: "DEPLOYMENT_APPROVAL", status: "waiting_approval" });
    expect(await approve(h, e, wf, "PRODUCTION_ACTIVATION")).toMatchObject({ state: "ACTIVE" });
    const acceptance = (await listEvidence(h.sql, wf)).filter((x) => x.kind === "acceptance_test").map((x) => x.passed);
    expect(acceptance).toEqual([false, true]);
  });
});

describe("follow-ups and loss", () => {
  it("no reply leads to approval-gated follow-ups, then LOST", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    for (let i = 0; i < 2; i++) {
      h.clock.tick(3 * 24 * 3600_000 + 1);
      expect(await e.advance(wf)).toMatchObject({ state: "WAITING_FOR_APPROVAL" });
      await approve(h, e, wf, "PROPOSAL_SEND");
    }
    h.clock.tick(3 * 24 * 3600_000 + 1);
    expect(await e.advance(wf)).toMatchObject({ state: "LOST", status: "closed" });
    expect(await fakeWorld.outbox(h.sql)).toHaveLength(3);
    expect((await listApprovals(h.sql, wf)).filter((a) => a.kind === "PROPOSAL_SEND")).toHaveLength(3);
  });
});

describe("in-transaction audit hooks", () => {
  it("an audit failure rolls back the approval decision", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await e.advance(wf);
    const a = await pendingApproval(h.sql, wf, "PROPOSAL_SEND");
    await expect(
      e.decideApproval({ approvalId: a.id, decision: "approved", actor: "owner:o@prfkt.test", audit: async () => { throw new Error("audit store down"); } }),
    ).rejects.toThrow(/audit store down/);
    expect((await pendingApproval(h.sql, wf, "PROPOSAL_SEND")).status).toBe("pending");
  });
});
