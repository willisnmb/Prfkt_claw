import { createTestDb, createUser, type TestDb } from "../support/db";
import { Flow01Engine, type EngineHooks } from "@/flow/flow01/engine";
import { createFakeAdapters, installFakeWorld, type FakeFaults, type FakeHooks } from "@/flow/flow01/fakes";
import { getRun, listApprovals, listEvents } from "@/flow/flow01/store";
import type { Sql } from "@/server/db/sql";
import type { ApprovalKind } from "@/flow/flow01/definition";

export const LEAD = {
  name: "Dana Reyes",
  company: "Northwind Supply",
  email: "dana@northwind.test",
  website: "https://www.northwind.test",
  source: "inbound_form",
  planSlug: "chief-of-staff",
  priceCents: 250_000,
};

export class TestClock {
  constructor(public now = new Date("2026-09-25T12:00:00Z")) {}
  tick(ms: number) {
    this.now = new Date(this.now.getTime() + ms);
  }
  fn = () => this.now;
}

export interface Harness {
  db: TestDb;
  sql: Sql;
  tenantId: string;
  userId: string;
  clock: TestClock;
  engine(opts?: { workerId?: string; faults?: FakeFaults; fakeHooks?: FakeHooks; hooks?: EngineHooks; leaseMs?: number }): Flow01Engine;
}

export async function harness(): Promise<Harness> {
  const db = await createTestDb();
  await installFakeWorld(db.sql);
  const { tenantId, userId } = await createUser(db.sql, `owner-${Math.random().toString(36).slice(2)}@tenant.test`);
  const clock = new TestClock();
  return {
    db,
    sql: db.sql,
    tenantId,
    userId,
    clock,
    engine: (o = {}) =>
      new Flow01Engine({
        sql: db.sql,
        adapters: createFakeAdapters(db.sql, o.faults ?? {}, o.fakeHooks ?? {}),
        workerId: o.workerId ?? "worker-A",
        clock: clock.fn,
        leaseMs: o.leaseMs ?? 30_000,
        hooks: o.hooks,
        retryBaseMs: 1_000,
      }),
  };
}

export async function newRun(h: Harness, engine: Flow01Engine, key = "lead-0001-key", lead: Record<string, unknown> = LEAD) {
  const { run } = await engine.createRun({ tenantId: h.tenantId, leadId: key, lead, idempotencyKey: key });
  return run.workflowId;
}

export async function pendingApproval(sql: Sql, workflowId: string, kind: ApprovalKind) {
  const a = (await listApprovals(sql, workflowId)).filter((x) => x.kind === kind && x.status === "pending");
  if (a.length !== 1) throw new Error(`expected one pending ${kind} approval, found ${a.length}`);
  return a[0]!;
}

export async function approve(h: Harness, engine: Flow01Engine, workflowId: string, kind: ApprovalKind) {
  const a = await pendingApproval(h.sql, workflowId, kind);
  await engine.decideApproval({ approvalId: a.id, decision: "approved", actor: "owner:owner@prfkt.test" });
  return engine.advance(workflowId);
}

export async function transitionsInto(sql: Sql, workflowId: string, state: string) {
  return (await listEvents(sql, workflowId)).filter((e) => e.type === "transition" && e.to_state === state).length;
}

export async function state(sql: Sql, workflowId: string) {
  const r = await getRun(sql, workflowId);
  return r!;
}

/** Drives a run from creation to WAITING_FOR_REPLY with the proposal sent. */
export async function driveToWaitingForReply(h: Harness, engine: Flow01Engine, workflowId: string) {
  await engine.advance(workflowId);
  await approve(h, engine, workflowId, "PROPOSAL_SEND");
}

/** Continues from WAITING_FOR_REPLY through payment and provisioning approval. */
export async function driveFromReplyToProvisioning(h: Harness, engine: Flow01Engine, workflowId: string) {
  await engine.ingestWebhook({ provider: "fake-email", eventId: `reply-${workflowId}`, type: "lead.reply", payload: { workflowId, outcome: "accepted" } });
  await engine.advance(workflowId);
  const run = await state(h.sql, workflowId);
  await engine.ingestWebhook({ provider: "fake-pay", eventId: `pay-${workflowId}`, type: "payment.succeeded", payload: { workflowId, invoiceId: run.output.invoiceId, amountCents: LEAD.priceCents } });
  await engine.advance(workflowId);
  await approve(h, engine, workflowId, "PAYMENT");
  return approve(h, engine, workflowId, "PROVISIONING");
}
