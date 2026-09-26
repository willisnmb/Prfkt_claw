import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flow01Availability } from "@/flow/flow01/runtime-policy";
import { fakeWorld } from "@/flow/flow01/fakes";
import { harness, newRun, driveToWaitingForReply, state, type Harness } from "../flow/support";
import { FakeStripe, fakeStripeKey } from "./fake-stripe";
import { runAwaitingPayment, setBillingFlag, stripeEngine } from "./support";

describe("FLOW 01 payment wiring", () => {
  const base = { NODE_ENV: "development", databaseConfigured: true };

  it("keeps fake payments unless BILLING_ENABLED=true AND a Stripe key is set", () => {
    expect(flow01Availability(base)).toMatchObject({ enabled: true, adapters: "fake", payment: "fake" });
    expect(flow01Availability({ ...base, STRIPE_SECRET_KEY: fakeStripeKey() })).toMatchObject({ enabled: true, payment: "fake" });
    expect(flow01Availability({ ...base, BILLING_ENABLED: true })).toMatchObject({ enabled: true, payment: "fake" });
    expect(flow01Availability({ ...base, BILLING_ENABLED: true, STRIPE_SECRET_KEY: fakeStripeKey() })).toMatchObject({ enabled: true, payment: "stripe", reason: /test mode/ });
  });

  it("fails closed on a refused key instead of falling back to fake payments", () => {
    const live = flow01Availability({ ...base, BILLING_ENABLED: true, STRIPE_SECRET_KEY: fakeStripeKey("live") });
    expect(live).toMatchObject({ enabled: false, reason: /STRIPE_ALLOW_LIVE/ });
    expect(flow01Availability({ ...base, BILLING_ENABLED: true, STRIPE_SECRET_KEY: fakeStripeKey("live"), STRIPE_ALLOW_LIVE: true })).toMatchObject({ enabled: true, payment: "stripe", reason: /live mode/ });
    expect(flow01Availability({ ...base, BILLING_ENABLED: true, STRIPE_SECRET_KEY: fakeStripeKey("test", "pk") })).toMatchObject({ enabled: false });
  });

  it("stays disabled in production whatever the billing configuration", () => {
    for (const env of [{}, { BILLING_ENABLED: true, STRIPE_SECRET_KEY: fakeStripeKey() }]) {
      expect(flow01Availability({ ...base, ...env, NODE_ENV: "production" }).enabled).toBe(false);
    }
  });
});

describe("billing_enabled flag gates Stripe invoicing", () => {
  let h: Harness;
  let stripe: FakeStripe;
  beforeEach(async () => {
    h = await harness();
    stripe = new FakeStripe();
  });
  afterEach(() => h.db.close());

  it("with the stored flag off, no invoice is created and the run retries instead of advancing", async () => {
    await setBillingFlag(h.sql, false);
    const e = stripeEngine(h, stripe);
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    await e.ingestWebhook({ provider: "fake-email", eventId: `reply-${wf}`, type: "lead.reply", payload: { workflowId: wf, outcome: "accepted" } });
    await e.advance(wf);

    const run = await state(h.sql, wf);
    expect(run).toMatchObject({ currentState: "CUSTOMER_ACCEPTED", status: "retry_wait" });
    expect(run.lastError).toMatch(/billing is disabled/);
    expect(stripe.calls).toHaveLength(0);
    expect(await fakeWorld.invoices(h.sql)).toHaveLength(0); // and never the fake either
  });

  it("with the flag on, the run is invoiced through Stripe, never the fake", async () => {
    await setBillingFlag(h.sql, true);
    const { invoiceId } = await runAwaitingPayment(h, stripeEngine(h, stripe), "lead-on-key");
    expect(stripe.invoice(invoiceId).status).toBe("open");
    expect(await fakeWorld.invoices(h.sql)).toHaveLength(0);
  });
});
