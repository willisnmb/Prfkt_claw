import { afterEach, beforeEach, describe, expect } from "vitest";
import { redclaw } from "./redclaw";
import { handleStripeWebhook } from "@/billing/stripe-webhook";
import { StripeClient, StripeConfigError } from "@/billing/stripe";
import type { Flow01Engine } from "@/flow/flow01/engine";
import { flow01Availability } from "@/flow/flow01/runtime-policy";
import { handleFlow01Webhook } from "@/flow/flow01/webhook-handler";
import { listApprovals } from "@/flow/flow01/store";
import { signWebhook } from "@/security/webhooks";
import { harness, state, LEAD, type Harness } from "../flow/support";
import { FakeStripe, fakeStripeKey, fakeWebhookSecret, invoiceEvent } from "../billing/fake-stripe";
import { runAwaitingPayment, setBillingFlag, stripeEngine } from "../billing/support";

const SECRET = fakeWebhookSecret();
const NOW = 1_800_000_000;

let h: Harness;
let stripe: FakeStripe;
let engine: Flow01Engine;
beforeEach(async () => {
  h = await harness();
  await setBillingFlag(h.sql, true);
  stripe = new FakeStripe();
  engine = stripeEngine(h, stripe);
});
afterEach(() => h.db.close());

function stripeDelivery(raw: string, signature: string | null) {
  return handleStripeWebhook({ rawBody: raw, signature, secret: SECRET, engine, allowLive: false, nowSeconds: NOW });
}

describe("Stripe billing under attack", () => {
  redclaw("duplicate_webhook", "a forged Stripe invoice.paid (wrong secret, tampered, replayed, unsigned) never confirms payment", async () => {
    const run = await runAwaitingPayment(h, engine, "lead-forged-key");
    const raw = JSON.stringify(invoiceEvent("invoice.paid", stripe.pay(run.invoiceId), "evt_forged"));
    const forged = [
      stripeDelivery(raw, signWebhook(fakeWebhookSecret(9), raw, NOW)),
      stripeDelivery(raw.replaceAll("250000", "250001"), signWebhook(SECRET, raw, NOW)),
      stripeDelivery(raw, signWebhook(SECRET, raw, NOW - 3600)),
      stripeDelivery(raw, null),
    ];
    for (const res of await Promise.all(forged)) expect(res.status).toBe(400);
    expect((await state(h.sql, run.workflowId)).output.payment).toBeUndefined();
    expect(await h.sql.query("select 1 from public.flow_webhook_events where provider = 'stripe'")).toHaveLength(0);
  });

  redclaw("duplicate_webhook", "concurrent redeliveries of one Stripe event record one payment and one approval", async () => {
    const run = await runAwaitingPayment(h, engine, "lead-redeliver-key");
    const raw = JSON.stringify(invoiceEvent("invoice.paid", stripe.pay(run.invoiceId), "evt_redelivered"));
    const results = await Promise.all(Array.from({ length: 6 }, () => stripeDelivery(raw, signWebhook(SECRET, raw, NOW))));
    expect(results.filter((r) => r.body.outcome === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.body.duplicate === true)).toHaveLength(5);
    expect((await listApprovals(h.sql, run.workflowId)).filter((a) => a.kind === "PAYMENT")).toHaveLength(1);
  });

  redclaw("unauthorized_spend", "with Stripe active, PRFKT-signed fake payment confirmations are refused", async () => {
    const run = await runAwaitingPayment(h, engine, "lead-fakepay-key");
    const prfktSecret = fakeWebhookSecret(3);
    const event = { id: "evt_fake_pay", type: "payment.succeeded", data: { workflowId: run.workflowId, invoiceId: run.invoiceId, amountCents: LEAD.priceCents } };
    const raw = JSON.stringify(event);
    const send = (provider: string) =>
      handleFlow01Webhook({ provider, rawBody: raw, signature: signWebhook(prfktSecret, raw, NOW), secret: prfktSecret, engine, paymentMode: "stripe", nowSeconds: NOW });
    expect((await send("fake-pay")).status).toBe(404);
    expect((await send("fake-email")).status).toBe(400);
    expect((await state(h.sql, run.workflowId)).output.payment).toBeUndefined();
  });

  redclaw("unauthorized_spend", "a genuine Stripe payment for a different amount blocks the run instead of confirming it", async () => {
    const run = await runAwaitingPayment(h, engine, "lead-amount-key");
    const underpaid = { ...stripe.pay(run.invoiceId), amount_paid: 100 };
    const raw = JSON.stringify(invoiceEvent("invoice.paid", underpaid, "evt_underpaid"));
    expect((await stripeDelivery(raw, signWebhook(SECRET, raw, NOW))).body).toMatchObject({ outcome: "applied" });
    const after = await state(h.sql, run.workflowId);
    expect(after).toMatchObject({ currentState: "PAYMENT_CONFIRMATION", status: "blocked" });
    expect(after.lastError).toMatch(/payment does not match invoice/);
    expect((await listApprovals(h.sql, run.workflowId)).filter((a) => a.kind === "PAYMENT")).toHaveLength(0);
  });

  redclaw("unauthorized_spend", "a live-mode Stripe key cannot be used unless STRIPE_ALLOW_LIVE=true", async () => {
    const live = fakeStripeKey("live");
    expect(flow01Availability({ NODE_ENV: "development", databaseConfigured: true, BILLING_ENABLED: true, STRIPE_SECRET_KEY: live }).enabled).toBe(false);
    expect(() => new StripeClient({ apiKey: live, fetchImpl: stripe.fetch })).toThrow(StripeConfigError);
    expect(stripe.calls).toHaveLength(0);
  });
});
