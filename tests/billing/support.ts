import { StripeClient } from "@/billing/stripe";
import { createFlow01Adapters } from "@/flow/flow01/adapter-set";
import { Flow01Engine } from "@/flow/flow01/engine";
import { flow01Availability } from "@/flow/flow01/runtime-policy";
import type { Sql } from "@/server/db/sql";
import { driveToWaitingForReply, newRun, state, type Harness } from "../flow/support";
import { FakeStripe, fakeStripeKey } from "./fake-stripe";

export async function setBillingFlag(sql: Sql, enabled: boolean) {
  await sql.query(
    "insert into public.feature_flags (key, enabled, description) values ('billing_enabled', $1, 'test') on conflict (key) do update set enabled = excluded.enabled",
    [enabled],
  );
}

/** A FLOW 01 engine wired exactly as the app wires it with BILLING_ENABLED=true and a test key, against the fake Stripe. */
export function stripeEngine(h: Harness, stripe: FakeStripe): Flow01Engine {
  const availability = flow01Availability({ NODE_ENV: "test", databaseConfigured: true, BILLING_ENABLED: true, STRIPE_SECRET_KEY: fakeStripeKey() });
  if (!availability.enabled || availability.payment !== "stripe") throw new Error("setup: expected Stripe payments");
  const adapters = createFlow01Adapters(h.sql, availability, { stripeSecretKey: fakeStripeKey(), fetchImpl: stripe.fetch });
  return new Flow01Engine({ sql: h.sql, adapters, workerId: "worker-A", clock: h.clock.fn, retryBaseMs: 1_000 });
}

export function stripeClient(stripe: FakeStripe): StripeClient {
  return new StripeClient({ apiKey: fakeStripeKey(), fetchImpl: stripe.fetch, retryBaseMs: 0 });
}

/** Creates a run and drives it to PAYMENT_CONFIRMATION, invoiced through the fake Stripe. */
export async function runAwaitingPayment(h: Harness, engine: Flow01Engine, key: string): Promise<{ workflowId: string; invoiceId: string }> {
  const workflowId = await newRun(h, engine, key);
  await driveToWaitingForReply(h, engine, workflowId);
  await engine.ingestWebhook({ provider: "fake-email", eventId: `reply-${workflowId}`, type: "lead.reply", payload: { workflowId, outcome: "accepted" } });
  await engine.advance(workflowId);
  const run = await state(h.sql, workflowId);
  if (run.currentState !== "PAYMENT_CONFIRMATION" || !run.output.invoiceId) throw new Error(`setup: run is in ${run.currentState} (${run.lastError ?? "no error"})`);
  return { workflowId, invoiceId: run.output.invoiceId };
}

export async function countRows(sql: Sql, text: string, params: unknown[] = []): Promise<number> {
  const rows = await sql.query<{ n: number }>(`select count(*)::int as n from (${text}) q`, params);
  return rows[0]!.n;
}
