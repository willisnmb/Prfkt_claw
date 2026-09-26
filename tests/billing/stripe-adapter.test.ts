import { beforeEach, describe, expect, it } from "vitest";
import { checkStripeKey, formEncode, STRIPE_API_VERSION, StripeApiError, StripeClient, StripeConfigError, StripePaymentAdapter } from "@/billing/stripe";
import { FakeStripe, fakeStripeKey } from "./fake-stripe";

const KEY = "wf-0001:payment.createInvoice";
const REF = "0f8fad5b-d9cb-469f-a165-70867728950e";
const EMAIL = "dana@northwind.test";

let stripe: FakeStripe;
beforeEach(() => {
  stripe = new FakeStripe();
});

function adapter(o: { daysUntilDue?: number; maxAttempts?: number } = {}) {
  const client = new StripeClient({ apiKey: fakeStripeKey(), fetchImpl: stripe.fetch, retryBaseMs: 0, maxAttempts: o.maxAttempts });
  return new StripePaymentAdapter({ client, daysUntilDue: o.daysUntilDue });
}

const invoiceInput = (over: Record<string, unknown> = {}) => ({ idempotencyKey: KEY, customerEmail: EMAIL, amountCents: 250_000, reference: REF, ...over });

describe("Stripe key policy", () => {
  it("accepts test-mode secret and restricted keys", () => {
    expect(checkStripeKey(fakeStripeKey("test", "sk"), false)).toEqual({ ok: true, mode: "test" });
    expect(checkStripeKey(fakeStripeKey("test", "rk"), false)).toEqual({ ok: true, mode: "test" });
  });

  it("refuses live-mode keys unless STRIPE_ALLOW_LIVE=true", () => {
    for (const kind of ["sk", "rk"] as const) {
      expect(checkStripeKey(fakeStripeKey("live", kind), false)).toMatchObject({ ok: false, reason: /STRIPE_ALLOW_LIVE/ });
      expect(checkStripeKey(fakeStripeKey("live", kind), true)).toEqual({ ok: true, mode: "live" });
    }
    expect(() => new StripeClient({ apiKey: fakeStripeKey("live"), fetchImpl: stripe.fetch })).toThrow(StripeConfigError);
    expect(new StripeClient({ apiKey: fakeStripeKey("live"), allowLive: true, fetchImpl: stripe.fetch }).mode).toBe("live");
  });

  it("refuses publishable keys, malformed keys and a missing key", () => {
    expect(checkStripeKey(fakeStripeKey("test", "pk"), true).ok).toBe(false);
    expect(checkStripeKey("not-a-key", true).ok).toBe(false);
    expect(checkStripeKey(undefined, true)).toMatchObject({ ok: false, reason: /not set/ });
  });
});

describe("Stripe client", () => {
  it("form-encodes nested metadata and arrays the way Stripe expects", () => {
    expect(decodeURIComponent(formEncode({ a: 1, b: true, metadata: { reference: "x y" }, expand: ["lines", "customer"], skip: undefined }))).toBe(
      "a=1&b=true&metadata[reference]=x+y&expand[0]=lines&expand[1]=customer",
    );
  });

  it("never puts the key in an error, even when Stripe echoes it", async () => {
    const key = fakeStripeKey();
    stripe.failNext("GET customers", { status: 401, body: { error: { message: `Invalid API Key provided: ${key}`, type: "invalid_request_error" } } });
    const client = new StripeClient({ apiKey: key, fetchImpl: stripe.fetch, retryBaseMs: 0 });
    const err = await client.get("customers").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeApiError);
    expect((err as StripeApiError).retryable).toBe(false);
    expect(String((err as Error).message)).not.toContain(key);
    expect(JSON.stringify(client)).not.toContain(key);
  });

  it("refuses paths that are not built from validated ids", async () => {
    const client = new StripeClient({ apiKey: fakeStripeKey(), fetchImpl: stripe.fetch });
    await expect(client.get("invoices/../../v2/accounts")).rejects.toThrow(/invalid Stripe path/);
    await expect(client.get("/customers")).rejects.toThrow(/invalid Stripe path/);
    expect(stripe.calls).toHaveLength(0);
  });
});

describe("StripePaymentAdapter.createInvoice", () => {
  it("creates the customer and a finalized send_invoice invoice, with a distinct idempotency key per POST", async () => {
    const { invoiceId } = await adapter({ daysUntilDue: 30 }).createInvoice(invoiceInput());
    expect(invoiceId).toMatch(/^in_/);

    expect(stripe.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET customers",
      "POST customers",
      "GET invoices",
      "POST invoices",
      "POST invoiceitems",
      `POST invoices/${invoiceId}/finalize`,
    ]);
    const posts = stripe.posts();
    expect(posts.map((c) => c.idempotencyKey)).toEqual([`${KEY}:customer`, `${KEY}:invoice`, `${KEY}:item`, `${KEY}:finalize`]);
    expect(new Set(posts.map((c) => c.idempotencyKey)).size).toBe(posts.length);
    for (const c of stripe.calls) {
      expect(c.authorization).toBe(`Bearer ${fakeStripeKey()}`);
      expect(c.version).toBe(STRIPE_API_VERSION);
    }

    const create = posts[1]!.params;
    expect(Object.fromEntries(create)).toMatchObject({
      collection_method: "send_invoice",
      days_until_due: "30",
      currency: "usd",
      auto_advance: "false",
      pending_invoice_items_behavior: "exclude",
      "metadata[reference]": REF,
    });
    expect(Object.fromEntries(posts[2]!.params)).toMatchObject({ invoice: invoiceId, amount: "250000", currency: "usd" });

    const inv = stripe.invoice(invoiceId);
    expect(inv).toMatchObject({ status: "open", amount_due: 250_000, collection_method: "send_invoice", auto_advance: false });
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.customers[0]!.email).toBe(EMAIL);
  });

  it("reuses an existing customer with the same email", async () => {
    const existing = stripe.addCustomer(EMAIL);
    const { invoiceId } = await adapter().createInvoice(invoiceInput());
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.posts().map((c) => c.path)).not.toContain("customers");
    expect(stripe.invoice(invoiceId).customer).toBe(existing.id);
  });

  it("is idempotent: a repeated call returns the same invoice and issues nothing new", async () => {
    const a = await adapter().createInvoice(invoiceInput());
    const postsBefore = stripe.posts().length;
    const b = await adapter().createInvoice(invoiceInput());
    expect(b.invoiceId).toBe(a.invoiceId);
    expect(stripe.invoices).toHaveLength(1);
    expect(stripe.items).toHaveLength(1);
    expect(stripe.posts()).toHaveLength(postsBefore);
  });

  it("finds its own draft after Stripe's idempotency window and finishes it without a second invoice or line", async () => {
    // First attempt dies at finalize with an error Stripe says not to retry.
    stripe.failNext(`POST invoices/in_Fake000002/finalize`, { status: 400, body: { error: { message: "try later" } } });
    await expect(adapter().createInvoice(invoiceInput())).rejects.toThrow(StripeApiError);
    expect(stripe.invoices).toHaveLength(1);
    expect(stripe.invoices[0]).toMatchObject({ id: "in_Fake000002", status: "draft", amount_due: 250_000 });

    stripe.forgetIdempotencyKeys(); // days later: replaying the keys would no longer dedupe
    const { invoiceId } = await adapter().createInvoice(invoiceInput());
    expect(invoiceId).toBe("in_Fake000002");
    expect(stripe.invoices).toHaveLength(1);
    expect(stripe.items).toHaveLength(1);
    expect(stripe.invoice(invoiceId)).toMatchObject({ status: "open", amount_due: 250_000 });
  });

  it("retries rate limits, server errors and lost responses with the same idempotency key", async () => {
    stripe.failNext("POST invoices", { status: 503, body: { error: { message: "unavailable" } } }, "lost");
    stripe.failNext("POST invoiceitems", { status: 429, body: { error: { message: "slow down" } } });
    const { invoiceId } = await adapter().createInvoice(invoiceInput());
    const creates = stripe.posts().filter((c) => c.path === "invoices");
    expect(creates).toHaveLength(3);
    expect(new Set(creates.map((c) => c.idempotencyKey))).toEqual(new Set([`${KEY}:invoice`]));
    expect(stripe.invoices).toHaveLength(1); // the "lost" create was replayed, not repeated
    expect(stripe.items).toHaveLength(1);
    expect(stripe.invoice(invoiceId)).toMatchObject({ status: "open", amount_due: 250_000 });
  });

  it("does not retry a request Stripe marks as not retryable", async () => {
    stripe.failNext("GET customers", { status: 500, body: { error: { message: "no" } }, headers: { "stripe-should-retry": "false" } });
    await expect(adapter().createInvoice(invoiceInput())).rejects.toMatchObject({ name: "StripeApiError", status: 500, retryable: false });
    expect(stripe.calls).toHaveLength(1);
  });

  it("honours an already-aborted signal without calling Stripe", async () => {
    const ac = new AbortController();
    ac.abort(new Error("step deadline"));
    await expect(adapter().createInvoice({ ...invoiceInput(), signal: ac.signal })).rejects.toThrow(/cancelled/);
    expect(stripe.calls).toHaveLength(0);
  });

  it("stops mid-flight when the step deadline aborts, and never finalizes", async () => {
    stripe.hangOn = "POST invoices";
    const ac = new AbortController();
    const pending = adapter().createInvoice({ ...invoiceInput(), signal: ac.signal });
    await new Promise((r) => setTimeout(r, 20));
    ac.abort(new Error("step deadline"));
    await expect(pending).rejects.toThrow(/cancelled/);
    const paths = stripe.calls.map((c) => c.path);
    expect(paths).not.toContain("invoiceitems");
    expect(paths.some((p) => p.endsWith("/finalize"))).toBe(false);
  });

  it("rejects amounts Stripe cannot invoice before calling it", async () => {
    await expect(adapter().createInvoice(invoiceInput({ amountCents: 0 }))).rejects.toThrow();
    await expect(adapter().createInvoice(invoiceInput({ amountCents: 100_000_000 }))).rejects.toThrow();
    await expect(adapter().createInvoice(invoiceInput({ customerEmail: "not-an-email" }))).rejects.toThrow();
    expect(stripe.calls).toHaveLength(0);
  });
});
