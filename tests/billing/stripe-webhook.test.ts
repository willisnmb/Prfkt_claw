import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";

// The route resolves its engine through the server-only wiring; tests hand it a PGlite-backed one.
const wiring = vi.hoisted(() => ({ runtime: null as { engine: unknown; payment: "fake" | "stripe" } | null }));
vi.mock("@/flow/flow01/wiring", () => ({ getFlow01Runtime: () => wiring.runtime }));

import { POST } from "@/app/api/flow/webhooks/[provider]/route";
import type { Flow01Engine } from "@/flow/flow01/engine";
import { listApprovals, listEvidence } from "@/flow/flow01/store";
import { resetServerEnvForTests } from "@/server/env";
import { signWebhook, verifyWebhook } from "@/security/webhooks";
import { harness, pendingApproval, state, type Harness } from "../flow/support";
import { FakeStripe, fakeWebhookSecret, invoiceEvent } from "./fake-stripe";
import { countRows, runAwaitingPayment, setBillingFlag, stripeEngine } from "./support";

const SECRET = fakeWebhookSecret();
const now = () => Math.floor(Date.now() / 1000);

describe("Stripe-Signature verification", () => {
  const body = JSON.stringify(invoiceEvent("invoice.paid", { id: "in_1" }, "evt_sig_1"));
  const t = 1_800_000_000;
  const mac = (secret: string, payload: string, ts = t) => createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");

  it("accepts a valid signature over the raw body", () => {
    expect(verifyWebhook(SECRET, body, `t=${t},v1=${mac(SECRET, body)}`, t)).toEqual({ ok: true, timestamp: t });
  });

  it("accepts any of several v1 values (secret rotation) and ignores v0", () => {
    const header = `t=${t},v0=${mac("legacy", body)},v1=${mac(fakeWebhookSecret(2), body)},v1=${mac(SECRET, body)}`;
    expect(verifyWebhook(SECRET, body, header, t).ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhook(SECRET, body.replace("in_1", "in_2"), `t=${t},v1=${mac(SECRET, body)}`, t)).toMatchObject({ ok: false, reason: /mismatch/ });
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWebhook(SECRET, body, `t=${t},v1=${mac(fakeWebhookSecret(2), body)}`, t)).toMatchObject({ ok: false, reason: /mismatch/ });
  });

  it("rejects a stale (or far-future) timestamp even when the MAC is right", () => {
    expect(verifyWebhook(SECRET, body, `t=${t - 301},v1=${mac(SECRET, body, t - 301)}`, t)).toMatchObject({ ok: false, reason: /tolerance/ });
    expect(verifyWebhook(SECRET, body, `t=${t + 301},v1=${mac(SECRET, body, t + 301)}`, t)).toMatchObject({ ok: false, reason: /tolerance/ });
    expect(verifyWebhook(SECRET, body, `t=${t - 300},v1=${mac(SECRET, body, t - 300)}`, t).ok).toBe(true);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWebhook(SECRET, body, null, t)).toMatchObject({ ok: false, reason: /missing/ });
    expect(verifyWebhook(SECRET, body, "", t)).toMatchObject({ ok: false, reason: /missing/ });
    expect(verifyWebhook(SECRET, body, `t=${t}`, t)).toMatchObject({ ok: false, reason: /malformed/ });
    expect(verifyWebhook(SECRET, body, `v1=${mac(SECRET, body)}`, t)).toMatchObject({ ok: false, reason: /malformed/ });
    expect(verifyWebhook(SECRET, body, `t=${t},v1=nothex`, t)).toMatchObject({ ok: false, reason: /malformed/ });
  });
});

describe("POST /api/flow/webhooks/stripe (end to end on PGlite)", () => {
  let h: Harness;
  let stripe: FakeStripe;
  let engine: Flow01Engine;

  beforeEach(async () => {
    h = await harness();
    await setBillingFlag(h.sql, true);
    stripe = new FakeStripe();
    engine = stripeEngine(h, stripe);
    wiring.runtime = { engine, payment: "stripe" };
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("STRIPE_ALLOW_LIVE", "false");
    resetServerEnvForTests();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    resetServerEnvForTests();
    wiring.runtime = null;
    await h.db.close();
  });

  async function deliver(event: unknown, o: { raw?: string; header?: string | null; ts?: number; secret?: string; provider?: string; headers?: Record<string, string> } = {}) {
    const raw = o.raw ?? JSON.stringify(event);
    const headers = new Headers({ "content-type": "application/json", ...o.headers });
    const header = o.header === undefined ? signWebhook(o.secret ?? SECRET, raw, o.ts ?? now()) : o.header;
    if (header !== null) headers.set("stripe-signature", header);
    const provider = o.provider ?? "stripe";
    const res = await POST(new Request(`http://localhost/api/flow/webhooks/${provider}`, { method: "POST", body: raw, headers }), { params: Promise.resolve({ provider }) });
    expect(res.headers.get("cache-control")).toBe("no-store");
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  const stripeEvents = () => countRows(h.sql, "select 1 from public.flow_webhook_events where provider = 'stripe'");

  it("invoice.paid confirms payment for the run named in metadata.reference, and only that run", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-a-key");
    const b = await runAwaitingPayment(h, engine, "lead-b-key");
    expect(stripe.customers).toHaveLength(1); // same lead email: the customer is reused
    expect(stripe.invoices.map((i) => i.metadata.reference)).toEqual([a.workflowId, b.workflowId]);

    const res = await deliver(invoiceEvent("invoice.paid", stripe.pay(a.invoiceId), "evt_paid_a"));
    expect(res).toEqual({ status: 200, body: { received: true, duplicate: false, outcome: "applied" } });

    const runA = await state(h.sql, a.workflowId);
    expect(runA.output.payment).toEqual({ eventId: "evt_paid_a", invoiceId: a.invoiceId, amountCents: 250_000 });
    expect(runA).toMatchObject({ currentState: "PAYMENT_CONFIRMATION", status: "waiting_approval" });
    // Payment still needs the owner's reconciliation approval before anything is provisioned.
    expect((await pendingApproval(h.sql, a.workflowId, "PAYMENT")).payload).toMatchObject({ invoiceId: a.invoiceId, amountCents: 250_000, eventId: "evt_paid_a" });

    const runB = await state(h.sql, b.workflowId);
    expect(runB.output.payment).toBeUndefined();
    expect(runB).toMatchObject({ currentState: "PAYMENT_CONFIRMATION", status: "waiting_event" });
  });

  it("a redelivered event is a no-op, and the paired invoice.payment_succeeded changes nothing", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-a-key");
    const paid = stripe.pay(a.invoiceId);
    const event = invoiceEvent("invoice.paid", paid, "evt_paid_dup");
    expect((await deliver(event)).body).toMatchObject({ duplicate: false, outcome: "applied" });
    const before = await state(h.sql, a.workflowId);

    expect(await deliver(event)).toEqual({ status: 200, body: { received: true, duplicate: true, outcome: "duplicate_suppressed" } });
    expect((await deliver(invoiceEvent("invoice.payment_succeeded", paid, "evt_paid_succeeded"))).body).toMatchObject({ duplicate: false, outcome: "ignored_out_of_order" });

    const after = await state(h.sql, a.workflowId);
    expect(after.output.payment).toEqual(before.output.payment);
    expect(after.stateVersion).toBe(before.stateVersion);
    expect(after.metrics.duplicatesSuppressed).toBe(1);
    expect((await listApprovals(h.sql, a.workflowId)).filter((x) => x.kind === "PAYMENT")).toHaveLength(1);
    expect((await listEvidence(h.sql, a.workflowId)).filter((e) => e.kind === "payment")).toHaveLength(1);
    expect(await stripeEvents()).toBe(2);
  });

  it("an event for an unknown run, or without a reference, is acknowledged and changes no run", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-a-key");
    const paid = stripe.pay(a.invoiceId);
    const elsewhere = { ...paid, metadata: { reference: randomUUID() } };
    expect(await deliver(invoiceEvent("invoice.paid", elsewhere, "evt_unknown_run"))).toEqual({ status: 200, body: { received: true, duplicate: false, outcome: "unknown_workflow" } });
    expect((await deliver(invoiceEvent("invoice.paid", { ...paid, metadata: { reference: "not-a-workflow" } }, "evt_bad_ref"))).body).toMatchObject({ outcome: "rejected_invalid" });
    expect(await deliver(invoiceEvent("invoice.paid", { ...paid, metadata: {} }, "evt_no_ref"))).toEqual({ status: 200, body: { received: true, ignored: "no_reference" } });

    const run = await state(h.sql, a.workflowId);
    expect(run.output.payment).toBeUndefined();
    expect(run.status).toBe("waiting_event");
  });

  it("refuses bad signatures with 400 before parsing or storing anything", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-a-key");
    const event = invoiceEvent("invoice.paid", stripe.pay(a.invoiceId), "evt_forged");
    const raw = JSON.stringify(event);
    const cases = [
      { header: signWebhook(fakeWebhookSecret(2), raw, now()) }, // wrong secret
      { raw: raw.replace("250000", "1"), header: signWebhook(SECRET, raw, now()) }, // tampered body
      { ts: now() - 3600 }, // replayed from an hour ago
      { header: null }, // unsigned
      { header: "t=abc,v1=zz" }, // garbage
      { raw: "{not json", header: signWebhook(fakeWebhookSecret(2), "{not json", now()) }, // unparseable AND unsigned: signature is checked first
    ];
    for (const c of cases) expect(await deliver(event, c)).toEqual({ status: 400, body: { error: "invalid signature" } });

    expect(await stripeEvents()).toBe(0);
    expect((await state(h.sql, a.workflowId)).output.payment).toBeUndefined();
  });

  it("acknowledges unrelated events, unpaid invoices and live-mode events without acting", async () => {
    const a = await runAwaitingPayment(h, engine, "lead-a-key");
    const open = stripe.invoice(a.invoiceId);
    expect((await deliver({ id: "evt_cust", object: "event", type: "customer.created", livemode: false, data: { object: { id: "cus_1", object: "customer" } } })).body).toEqual({ received: true, ignored: "event_type" });
    expect((await deliver(invoiceEvent("invoice.paid", open, "evt_open"))).body).toEqual({ received: true, ignored: "not_paid" });
    expect((await deliver(invoiceEvent("invoice.paid", { ...stripe.pay(a.invoiceId), livemode: true }, "evt_live", true))).body).toEqual({ received: true, ignored: "livemode_refused" });
    // Each layer refuses on its own: a live event around a test invoice, and a live invoice in a test event.
    expect((await deliver(invoiceEvent("invoice.paid", stripe.invoice(a.invoiceId), "evt_live_event", true))).body).toEqual({ received: true, ignored: "livemode_refused" });
    expect((await deliver(invoiceEvent("invoice.paid", { ...stripe.invoice(a.invoiceId), livemode: true }, "evt_live_invoice"))).body).toEqual({ received: true, ignored: "livemode_refused" });
    expect((await deliver(invoiceEvent("invoice.paid", { ...stripe.invoice(a.invoiceId), currency: "eur" }, "evt_eur"))).body).toEqual({ received: true, ignored: "currency_mismatch" });
    expect((await deliver({ id: "evt_bad", object: "event", type: "invoice.paid", livemode: false, data: { object: { id: "x" } } })).status).toBe(400);
    expect(await stripeEvents()).toBe(0);
    expect((await state(h.sql, a.workflowId)).output.payment).toBeUndefined();
  });

  it("is closed unless FLOW 01 runs here with Stripe payments and a webhook secret", async () => {
    const event = invoiceEvent("invoice.paid", { id: "in_x" }, "evt_closed");
    wiring.runtime = { engine, payment: "fake" };
    expect((await deliver(event)).status).toBe(503);
    wiring.runtime = null;
    expect((await deliver(event)).status).toBe(503);
    wiring.runtime = { engine, payment: "stripe" };
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    resetServerEnvForTests();
    expect((await deliver(event)).status).toBe(503);
    expect(await stripeEvents()).toBe(0);
  });

  it("refuses oversized deliveries before reading them", async () => {
    const res = await deliver({}, { raw: "{}", headers: { "content-length": String(2 * 1024 * 1024) } });
    expect(res.status).toBe(413);
  });
});
