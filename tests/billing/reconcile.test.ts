import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconcileEventId, reconcileStripePayments } from "@/billing/reconcile";
import { handleStripeWebhook } from "@/billing/stripe-webhook";
import type { Flow01Engine } from "@/flow/flow01/engine";
import { listEvents, listEvidence } from "@/flow/flow01/store";
import { signWebhook } from "@/security/webhooks";
import { harness, pendingApproval, state, type Harness } from "../flow/support";
import { FakeStripe, fakeWebhookSecret, invoiceEvent } from "./fake-stripe";
import { countRows, runAwaitingPayment, setBillingFlag, stripeClient, stripeEngine } from "./support";

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

/** Everything reconciliation could touch, to prove a second pass changes nothing. */
async function snapshot(workflowId: string) {
  return {
    run: await state(h.sql, workflowId),
    events: (await listEvents(h.sql, workflowId)).length,
    evidence: (await listEvidence(h.sql, workflowId)).length,
    webhookRows: await countRows(h.sql, "select 1 from public.flow_webhook_events"),
  };
}

describe("Stripe reconciliation (missed webhooks)", () => {
  it("records a paid invoice exactly once through the webhook path, and leaves unpaid ones waiting", async () => {
    const paid = await runAwaitingPayment(h, engine, "lead-paid-key");
    const unpaid = await runAwaitingPayment(h, engine, "lead-unpaid-key");
    stripe.pay(paid.invoiceId); // the invoice.paid webhook never arrives
    const postsBefore = stripe.posts().length;

    const first = await reconcileStripePayments({ sql: h.sql, stripe: stripeClient(stripe) });
    expect(first).toEqual({
      checked: 2,
      recorded: [{ ...paid, outcome: "applied" }],
      unpaid: [{ ...unpaid, status: "open" }],
      skipped: [],
      errors: [],
    });
    expect(stripe.posts()).toHaveLength(postsBefore); // read-only against Stripe

    const run = await state(h.sql, paid.workflowId);
    expect(run.output.payment).toEqual({ eventId: reconcileEventId(paid.invoiceId), invoiceId: paid.invoiceId, amountCents: 250_000 });
    expect(run.status).toBe("running"); // the worker picks it up
    expect((await state(h.sql, unpaid.workflowId)).output.payment).toBeUndefined();

    const before = await snapshot(paid.workflowId);
    const second = await reconcileStripePayments({ sql: h.sql, stripe: stripeClient(stripe) });
    expect(second).toEqual({ checked: 1, recorded: [], unpaid: [{ ...unpaid, status: "open" }], skipped: [], errors: [] });
    const after = await snapshot(paid.workflowId);
    expect({ ...after, run: { ...after.run, updatedAt: null } }).toEqual({ ...before, run: { ...before.run, updatedAt: null } });

    // The worker advances it to the owner's payment approval, exactly as after a webhook.
    await engine.advance(paid.workflowId);
    expect((await pendingApproval(h.sql, paid.workflowId, "PAYMENT")).payload).toMatchObject({ invoiceId: paid.invoiceId, amountCents: 250_000 });
  });

  it("a webhook that arrives after reconciliation does not record the payment twice", async () => {
    const paid = await runAwaitingPayment(h, engine, "lead-late-key");
    const invoice = stripe.pay(paid.invoiceId);
    await reconcileStripePayments({ sql: h.sql, stripe: stripeClient(stripe) });

    const secret = fakeWebhookSecret();
    const raw = JSON.stringify(invoiceEvent("invoice.paid", invoice, "evt_late"));
    const res = await handleStripeWebhook({ rawBody: raw, signature: signWebhook(secret, raw, 1_800_000_000), secret, engine, allowLive: false, nowSeconds: 1_800_000_000 });
    expect(res.body).toMatchObject({ duplicate: false, outcome: "ignored_out_of_order" });
    expect((await state(h.sql, paid.workflowId)).output.payment?.eventId).toBe(reconcileEventId(paid.invoiceId));
    expect((await listEvidence(h.sql, paid.workflowId)).filter((e) => e.kind === "payment")).toHaveLength(1);
  });

  it("never moves a payment onto a run the invoice does not name", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-a-key");
    const b = await runAwaitingPayment(h, engine, "lead-b-key");
    stripe.pay(a.invoiceId);
    stripe.invoice(a.invoiceId).metadata.reference = b.workflowId; // edited in the Stripe dashboard

    const report = await reconcileStripePayments({ sql: h.sql, stripe: stripeClient(stripe) });
    expect(report.skipped).toEqual([{ ...a, reason: "reference_mismatch" }]);
    expect(report.recorded).toEqual([]);
    expect((await state(h.sql, a.workflowId)).output.payment).toBeUndefined();
    expect((await state(h.sql, b.workflowId)).output.payment).toBeUndefined();
  });

  it("skips live-mode invoices when the key is a test key", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-live-key");
    stripe.pay(a.invoiceId);
    stripe.invoice(a.invoiceId).livemode = true;
    const report = await reconcileStripePayments({ sql: h.sql, stripe: stripeClient(stripe) });
    expect(report.skipped).toEqual([{ ...a, reason: "livemode_refused" }]);
    expect((await state(h.sql, a.workflowId)).output.payment).toBeUndefined();
  });

  it("reports Stripe errors per invoice and carries on", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-a-key");
    const b = await runAwaitingPayment(h, engine, "lead-b-key");
    stripe.pay(b.invoiceId);
    stripe.failNext(`GET invoices/${a.invoiceId}`, { status: 404, body: { error: { message: "No such invoice", code: "resource_missing" } } });

    const report = await reconcileStripePayments({ sql: h.sql, stripe: stripeClient(stripe) });
    expect(report.errors).toEqual([{ ...a, error: expect.stringMatching(/404 \(resource_missing\)/) }]);
    expect(report.recorded).toEqual([{ ...b, outcome: "applied" }]);
  });
});
