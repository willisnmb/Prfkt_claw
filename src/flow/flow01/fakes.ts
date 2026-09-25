import type { Sql } from "@/server/db/sql";
import { one } from "@/server/db/sql";
import {
  ModelTimeoutError,
  ProvisionerError,
  type Flow01Adapters,
  type ProvisionResult,
} from "./adapters";

/**
 * Fake side-effect adapters (PRFKT_FLOW_01.md → Fake adapters). They persist
 * their "external world" in schema fake_ext of the same database so that a
 * process kill and restart sees exactly what the outside world saw, and they
 * dedupe on idempotency keys the way real providers do. Faults are counted in
 * the database too, so "fail the first N calls" survives restarts.
 *
 * Never used in production: the worker wires fakes only when billing and
 * provisioning are disabled (see src/flow/flow01/wiring.ts).
 */

export interface FakeFaults {
  research?: { timeouts?: number; malformed?: number; websiteText?: string; score?: number; disqualifying?: boolean };
  provisioner?: { transientFailures?: number; permanent?: boolean; failAfterResources?: number };
  acceptance?: { failures?: number };
}

export interface FakeHooks {
  /** Called after an external effect is durably recorded, before returning. Used to inject crashes. */
  afterExternalEffect?: (adapter: string, operation: string) => void | Promise<void>;
}

const FAKE_SCHEMA = `
create schema if not exists fake_ext;
create table if not exists fake_ext.calls (id bigint generated always as identity primary key, adapter text not null, operation text not null, idempotency_key text not null, at timestamptz not null default now());
create table if not exists fake_ext.outbox (idempotency_key text primary key, message_id text not null, recipient text not null, subject text not null, body text not null, sent_at timestamptz not null default now());
create table if not exists fake_ext.invoices (idempotency_key text primary key, invoice_id text not null, customer_email text not null, amount_cents integer not null, created_at timestamptz not null default now());
create table if not exists fake_ext.resources (idempotency_key text not null, name text not null, created_at timestamptz not null default now(), primary key (idempotency_key, name));
`;

export async function installFakeWorld(sql: Sql): Promise<void> {
  for (const stmt of FAKE_SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await sql.query(stmt);
}

async function countCalls(sql: Sql, adapter: string, operation: string): Promise<number> {
  const r = await one<{ n: number }>(sql, "select count(*)::int n from fake_ext.calls where adapter = $1 and operation = $2", [adapter, operation]);
  return r.n;
}

async function recordCall(sql: Sql, adapter: string, operation: string, key: string): Promise<number> {
  await sql.query("insert into fake_ext.calls (adapter, operation, idempotency_key) values ($1, $2, $3)", [adapter, operation, key]);
  return countCalls(sql, adapter, operation);
}

const RESOURCES = ["namespace", "network-policy", "secret-refs", "runtime", "egress-allowlist"];

export function createFakeAdapters(sql: Sql, faults: FakeFaults = {}, hooks: FakeHooks = {}): Flow01Adapters {
  const after = async (a: string, o: string) => hooks.afterExternalEffect?.(a, o);

  return {
    research: {
      async research({ idempotencyKey, lead }) {
        const n = await recordCall(sql, "research", "research", idempotencyKey);
        if (n <= (faults.research?.timeouts ?? 0)) throw new ModelTimeoutError();
        const malformed = n - (faults.research?.timeouts ?? 0) <= (faults.research?.malformed ?? 0);
        const usage = { model: "fake-research-1", tokensIn: 1200, tokensOut: 300, costMicroUsd: 4200 };
        const websiteText =
          faults.research?.websiteText ?? `${lead.company} builds practical software for regional distributors. About 45 staff. Contact: ${lead.email}.`;
        if (malformed) {
          return { websiteText, usage, structured: { companySummary: "x", score: "ninety", extra: "field", employeeEstimate: -3 } };
        }
        return {
          websiteText,
          usage,
          structured: {
            companySummary: `${lead.company} is a regional software business serving distributors.`,
            industry: "Software",
            employeeEstimate: 45,
            fitSignals: ["Repetitive lead handling", "Small ops team"],
            risks: [],
            disqualifying: faults.research?.disqualifying ?? false,
            score: faults.research?.score ?? 78,
          },
        };
      },
    },

    email: {
      async send({ idempotencyKey, to, subject, body }) {
        await recordCall(sql, "email", "send", idempotencyKey);
        const messageId = `msg_${idempotencyKey.replace(/[^a-z0-9]/gi, "").slice(-16)}`;
        await sql.query(
          "insert into fake_ext.outbox (idempotency_key, message_id, recipient, subject, body) values ($1, $2, $3, $4, $5) on conflict (idempotency_key) do nothing",
          [idempotencyKey, messageId, to, subject, body],
        );
        await after("email", "send");
        const row = await one<{ message_id: string }>(sql, "select message_id from fake_ext.outbox where idempotency_key = $1", [idempotencyKey]);
        return { messageId: row.message_id };
      },
    },

    payment: {
      async createInvoice({ idempotencyKey, customerEmail, amountCents }) {
        await recordCall(sql, "payment", "createInvoice", idempotencyKey);
        const invoiceId = `inv_${idempotencyKey.replace(/[^a-z0-9]/gi, "").slice(-16)}`;
        await sql.query(
          "insert into fake_ext.invoices (idempotency_key, invoice_id, customer_email, amount_cents) values ($1, $2, $3, $4) on conflict (idempotency_key) do nothing",
          [idempotencyKey, invoiceId, customerEmail, amountCents],
        );
        await after("payment", "createInvoice");
        const row = await one<{ invoice_id: string }>(sql, "select invoice_id from fake_ext.invoices where idempotency_key = $1", [idempotencyKey]);
        return { invoiceId: row.invoice_id };
      },
    },

    provisioner: {
      async provision({ idempotencyKey, plan }): Promise<ProvisionResult> {
        const n = await recordCall(sql, "provisioner", "provision", idempotencyKey);
        const f = faults.provisioner ?? {};
        const failing = f.permanent || n <= (f.transientFailures ?? 0);
        const upTo = failing ? Math.min(f.failAfterResources ?? 2, RESOURCES.length - 1) : RESOURCES.length;
        for (const name of RESOURCES.slice(0, upTo)) {
          await sql.query("insert into fake_ext.resources (idempotency_key, name) values ($1, $2) on conflict do nothing", [idempotencyKey, name]);
        }
        await after("provisioner", "provision");
        if (failing) throw new ProvisionerError(`fake provisioner failed after ${upTo} resources`, !f.permanent);
        return {
          cellId: plan.cellName,
          resources: [...RESOURCES],
          config: {
            tenantId: plan.tenantId,
            cellName: plan.cellName,
            profile: plan.profile,
            runtime: plan.runtime,
            modelPolicy: plan.modelPolicy,
            limits: plan.limits,
            secretRefs: plan.secretRefs,
          },
        };
      },
      async teardown({ idempotencyKey }) {
        await recordCall(sql, "provisioner", "teardown", idempotencyKey);
        const rows = await sql.query("delete from fake_ext.resources where idempotency_key = $1 returning name", [idempotencyKey]);
        await after("provisioner", "teardown");
        return { removed: rows.length };
      },
    },

    acceptance: {
      async run({ cellId, config }) {
        const n = await recordCall(sql, "acceptance", "run", cellId);
        const fail = n <= (faults.acceptance?.failures ?? 0);
        const checks = [
          { name: "health", passed: true, detail: "runtime responded" },
          { name: "tenant-isolation", passed: !fail, detail: fail ? "cross-tenant probe was answered" : "cross-tenant probe refused" },
          { name: "profile", passed: config.profile === "SAFE", detail: `profile ${String(config.profile)}` },
          { name: "approval-gate", passed: true, detail: "unapproved send was held" },
        ];
        return { passed: checks.every((c) => c.passed), checks };
      },
    },
  };
}

/** Test/inspection helpers over the fake external world. */
export const fakeWorld = {
  async outbox(sql: Sql) {
    return sql.query<{ idempotency_key: string; recipient: string; subject: string; body: string }>("select idempotency_key, recipient, subject, body from fake_ext.outbox order by sent_at");
  },
  async invoices(sql: Sql) {
    return sql.query<{ idempotency_key: string; invoice_id: string; amount_cents: number }>("select idempotency_key, invoice_id, amount_cents from fake_ext.invoices");
  },
  async resources(sql: Sql) {
    return sql.query<{ idempotency_key: string; name: string }>("select idempotency_key, name from fake_ext.resources order by name");
  },
  async calls(sql: Sql, adapter: string, operation: string) {
    return countCalls(sql, adapter, operation);
  },
};
