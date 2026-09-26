/**
 * FLOW 01 process harness. Runs the real engine against a durable on-disk
 * PGlite database with the fake external world, so a test (or a person) can
 * kill the process at any point and start a new one on the same data.
 *
 *   FLOW_DATA_DIR=/tmp/flow  FLOW_ACTIONS='[{"op":"create"},{"op":"advance"},{"op":"hold"}]'  npx tsx scripts/flow01-harness.ts
 *
 * Env:
 *   FLOW_DATA_DIR     database directory (required)
 *   FLOW_ACTIONS      JSON array of actions: create | advance | approve{kind} | webhook{type} | inspect | hold
 *   FLOW_WORKER       worker id for leases (default: harness-<pid>)
 *   FLOW_LEASE_MS     lease duration (default 1500)
 *   FLOW_CRASH_AFTER  "adapter:operation" — SIGKILL this process right after that external effect is recorded
 *   FLOW_FAULTS       JSON FakeFaults
 * Output: one JSON object per line, prefixed with "@@".
 */
import { openMigratedPglite } from "../src/server/db/pglite";
import { one } from "../src/server/db/sql";
import { Flow01Engine } from "../src/flow/flow01/engine";
import { createFakeAdapters, fakeWorld, installFakeWorld } from "../src/flow/flow01/fakes";
import { getRun, listApprovals, listEvents, listSideEffects } from "../src/flow/flow01/store";
import type { ApprovalKind } from "../src/flow/flow01/definition";

type Action =
  | { op: "create" }
  | { op: "advance" }
  | { op: "approve"; kind: ApprovalKind }
  | { op: "webhook"; type: "reply" | "payment"; eventId?: string }
  | { op: "inspect" }
  | { op: "hold" };

const emit = (o: unknown) => process.stdout.write(`@@${JSON.stringify(o)}\n`);

function hardKill(reason: string): never {
  emit({ event: "self_kill", reason });
  process.kill(process.pid, "SIGKILL");
  // SIGKILL cannot be caught; never let another instruction touch the database.
  for (;;) {
    /* spin until the kernel reaps us */
  }
}

async function main() {
  const dataDir = process.env.FLOW_DATA_DIR;
  if (!dataDir) throw new Error("FLOW_DATA_DIR is required");
  const actions = JSON.parse(process.env.FLOW_ACTIONS ?? "[]") as Action[];
  const crashAfter = process.env.FLOW_CRASH_AFTER;
  const { sql, db } = await openMigratedPglite(dataDir);
  await installFakeWorld(sql);

  let crashed = false;
  const adapters = createFakeAdapters(sql, JSON.parse(process.env.FLOW_FAULTS ?? "{}"), {
    afterExternalEffect: (adapter, operation) => {
      if (!crashed && crashAfter === `${adapter}:${operation}`) {
        crashed = true;
        hardKill(`after ${adapter}:${operation}`);
      }
    },
  });
  const engine = new Flow01Engine({
    sql,
    adapters,
    workerId: process.env.FLOW_WORKER ?? `harness-${process.pid}`,
    leaseMs: Number(process.env.FLOW_LEASE_MS ?? 1500),
  });

  const workflowId = async () => (await one<{ workflow_id: string }>(sql, "select workflow_id from public.flow_runs order by created_at limit 1")).workflow_id;

  for (const a of actions) {
    switch (a.op) {
      case "create": {
        let tenant = (await sql.query<{ tenant_id: string }>("select tenant_id from public.tenant_members limit 1"))[0]?.tenant_id;
        if (!tenant) {
          await sql.query("insert into auth.users (email, email_confirmed_at) values ('harness@tenant.test', now())");
          tenant = (await one<{ tenant_id: string }>(sql, "select tenant_id from public.tenant_members limit 1")).tenant_id;
        }
        const { run, created } = await engine.createRun({
          tenantId: tenant,
          leadId: "harness-lead",
          idempotencyKey: "harness-lead-intake-0001",
          lead: { name: "Dana Reyes", company: "Northwind Supply", email: "dana@northwind.test", website: "https://www.northwind.test", source: "inbound_form" },
        });
        emit({ event: "created", workflowId: run.workflowId, created });
        break;
      }
      case "advance": {
        const id = await workflowId();
        const deadline = Date.now() + 20_000;
        let r = await engine.advance(id);
        // After a crash the dead worker's lease must expire before anyone may continue.
        while (r.halt === "lease_held" && Date.now() < deadline) {
          await new Promise((res) => setTimeout(res, 200));
          r = await engine.advance(id);
        }
        emit({ event: "advanced", ...r });
        break;
      }
      case "approve": {
        const id = await workflowId();
        const pending = (await listApprovals(sql, id)).find((x) => x.kind === a.kind && x.status === "pending");
        if (!pending) throw new Error(`no pending ${a.kind} approval`);
        await engine.decideApproval({ approvalId: pending.id, decision: "approved", actor: "owner:harness@prfkt.test" });
        emit({ event: "approved", kind: a.kind, approvalId: pending.id });
        break;
      }
      case "webhook": {
        const id = await workflowId();
        const run = (await getRun(sql, id))!;
        const r =
          a.type === "reply"
            ? await engine.ingestWebhook({ provider: "fake-email", eventId: a.eventId ?? "harness-reply-1", type: "lead.reply", payload: { workflowId: id, outcome: "accepted" } })
            : await engine.ingestWebhook({ provider: "fake-pay", eventId: a.eventId ?? "harness-pay-1", type: "payment.succeeded", payload: { workflowId: id, invoiceId: run.output.invoiceId, amountCents: run.lead.priceCents } });
        emit({ event: "webhook", type: a.type, ...r });
        break;
      }
      case "inspect": {
        const id = await workflowId();
        const run = (await getRun(sql, id))!;
        const events = await listEvents(sql, id);
        const transitions: Record<string, number> = {};
        for (const e of events) if (e.type === "transition" && e.to_state) transitions[e.to_state] = (transitions[e.to_state] ?? 0) + 1;
        emit({
          event: "inspect",
          workflowId: id,
          state: run.currentState,
          status: run.status,
          stateVersion: run.stateVersion,
          leaseOwner: run.leaseOwner,
          metrics: run.metrics,
          transitions,
          recovered: events.filter((e) => e.type === "recovered").length,
          outbox: (await fakeWorld.outbox(sql)).length,
          invoices: (await fakeWorld.invoices(sql)).length,
          resources: (await fakeWorld.resources(sql)).length,
          calls: {
            research: await fakeWorld.calls(sql, "research", "research"),
            emailSend: await fakeWorld.calls(sql, "email", "send"),
            createInvoice: await fakeWorld.calls(sql, "payment", "createInvoice"),
            provision: await fakeWorld.calls(sql, "provisioner", "provision"),
          },
          sideEffects: (await listSideEffects(sql, id)).map((s) => ({ op: `${s.adapter}:${s.operation}`, status: s.status, attempts: Number(s.attempts) })),
        });
        break;
      }
      case "hold":
        emit({ event: "holding", pid: process.pid });
        // Stay alive until an external SIGKILL.
        await new Promise(() => {});
    }
  }
  await db.close();
}

main().catch((err) => {
  emit({ event: "error", message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
