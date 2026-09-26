/**
 * In-memory stand-in for the slice of the Stripe API the adapter uses. It
 * speaks the wire format (form-encoded requests, JSON responses) through an
 * injectable fetch, so tests never touch the network. Like Stripe, a POST
 * repeated with the same Idempotency-Key replays the stored response snapshot.
 */

// Fake credentials are assembled at runtime so no key-shaped literal exists in source (secrets scan).
export const fakeStripeKey = (mode: "test" | "live" = "test", kind: "sk" | "rk" | "pk" = "sk") => [kind, mode, "Fake".repeat(6)].join("_");
export const fakeWebhookSecret = (n = 1) => ["whsec", `Fake${n}`.repeat(5)].join("_");

export interface FakeInvoice {
  id: string;
  object: "invoice";
  customer: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  amount_due: number;
  amount_paid: number;
  currency: string;
  livemode: boolean;
  collection_method: string;
  days_until_due: number | null;
  auto_advance: boolean;
  metadata: Record<string, string>;
}

export interface FakeCall {
  method: string;
  path: string;
  idempotencyKey: string | null;
  params: URLSearchParams;
  authorization: string | null;
  version: string | null;
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
/** A scripted failure: a reply instead of handling, or "lost" = handled by Stripe but the response never arrives. */
export type Failure = Reply | "lost";

export class FakeStripe {
  customers: { id: string; object: "customer"; email: string; metadata: Record<string, string> }[] = [];
  invoices: FakeInvoice[] = [];
  items: { id: string; invoice: string | null; amount: number }[] = [];
  calls: FakeCall[] = [];
  /** Scripted failures per request ("POST invoices"), consumed in order. */
  private failures = new Map<string, Failure[]>();
  /** When set (e.g. "POST invoices"), that request never answers until its signal aborts. */
  hangOn: string | null = null;
  private idempotency = new Map<string, Reply>();
  private seq = 0;

  /** Simulates Stripe's 24-hour idempotency window expiring. */
  forgetIdempotencyKeys() {
    this.idempotency.clear();
  }

  failNext(request: string, ...failures: Failure[]) {
    this.failures.set(request, [...(this.failures.get(request) ?? []), ...failures]);
  }

  addCustomer(email: string) {
    const c = { id: `cus_${this.next()}`, object: "customer" as const, email, metadata: {} };
    this.customers.push(c);
    return c;
  }

  invoice(id: string): FakeInvoice {
    const inv = this.invoices.find((i) => i.id === id);
    if (!inv) throw new Error(`no fake invoice ${id}`);
    return inv;
  }

  /** The customer pays in full (what Stripe does before sending invoice.paid). */
  pay(id: string): FakeInvoice {
    const inv = this.invoice(id);
    inv.status = "paid";
    inv.amount_paid = inv.amount_due;
    return structuredClone(inv);
  }

  posts(): FakeCall[] {
    return this.calls.filter((c) => c.method === "POST");
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const signal = init?.signal ?? undefined;
    const path = url.pathname.replace(/^\/v1\//, "");
    if (signal?.aborted) throw signal.reason;
    const params = new URLSearchParams(method === "POST" ? String(init?.body ?? "") : url.search);
    const idempotencyKey = headers.get("idempotency-key");
    this.calls.push({ method, path, idempotencyKey, params, authorization: headers.get("authorization"), version: headers.get("stripe-version") });
    if (this.hangOn === `${method} ${path}`) {
      await new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
    const failure = this.failures.get(`${method} ${path}`)?.shift();
    if (failure && failure !== "lost") return respond(failure);
    if (method === "POST" && idempotencyKey) {
      const prior = this.idempotency.get(idempotencyKey);
      if (prior) return respond(prior);
    }
    const reply = this.handle(method, path, params);
    const snapshot = { ...reply, body: structuredClone(reply.body) };
    if (method === "POST" && idempotencyKey && reply.status < 500) this.idempotency.set(idempotencyKey, snapshot);
    if (failure === "lost") throw new TypeError("fetch failed: connection reset");
    return respond(snapshot);
  };

  private next() {
    this.seq += 1;
    return `Fake${String(this.seq).padStart(6, "0")}`;
  }

  private handle(method: string, path: string, p: URLSearchParams): Reply {
    const parts = path.split("/");
    if (method === "GET" && path === "customers") {
      const data = this.customers.filter((c) => c.email === p.get("email")).reverse().slice(0, Number(p.get("limit") ?? 10));
      return ok({ object: "list", data, has_more: false });
    }
    if (method === "POST" && path === "customers") {
      const c = { id: `cus_${this.next()}`, object: "customer" as const, email: p.get("email") ?? "", metadata: bracket(p, "metadata") };
      this.customers.push(c);
      return ok(c);
    }
    if (method === "GET" && path === "invoices") {
      const data = this.invoices.filter((i) => i.customer === p.get("customer")).reverse().slice(0, Number(p.get("limit") ?? 10));
      return ok({ object: "list", data, has_more: false });
    }
    if (method === "POST" && path === "invoices") {
      const customer = p.get("customer") ?? "";
      if (!this.customers.some((c) => c.id === customer)) return missing("customer");
      const inv: FakeInvoice = {
        id: `in_${this.next()}`,
        object: "invoice",
        customer,
        status: "draft",
        amount_due: 0,
        amount_paid: 0,
        currency: p.get("currency") ?? "usd",
        livemode: false,
        collection_method: p.get("collection_method") ?? "charge_automatically",
        days_until_due: p.has("days_until_due") ? Number(p.get("days_until_due")) : null,
        auto_advance: p.get("auto_advance") !== "false",
        metadata: bracket(p, "metadata"),
      };
      this.invoices.push(inv);
      return ok(inv);
    }
    if (method === "POST" && path === "invoiceitems") {
      const invoiceId = p.get("invoice");
      const inv = invoiceId ? this.invoices.find((i) => i.id === invoiceId) : undefined;
      if (invoiceId && !inv) return missing("invoice");
      if (inv && inv.status !== "draft") return { status: 400, body: { error: { message: "invoice is not a draft", code: "invoice_not_editable" } } };
      const item = { id: `ii_${this.next()}`, invoice: invoiceId, amount: Number(p.get("amount")) };
      this.items.push(item);
      if (inv) inv.amount_due += item.amount;
      return ok({ ...item, object: "invoiceitem" });
    }
    if (method === "POST" && parts[0] === "invoices" && parts[2] === "finalize") {
      const inv = this.invoices.find((i) => i.id === parts[1]);
      if (!inv) return missing("invoice");
      if (inv.status !== "draft") return { status: 400, body: { error: { message: "invoice is already finalized", code: "invoice_not_editable" } } };
      inv.status = inv.amount_due === 0 ? "paid" : "open";
      inv.auto_advance = p.get("auto_advance") !== "false";
      return ok(inv);
    }
    if (method === "GET" && parts[0] === "invoices" && parts.length === 2) {
      const inv = this.invoices.find((i) => i.id === parts[1]);
      return inv ? ok(inv) : missing("invoice");
    }
    return { status: 404, body: { error: { message: `unrecognized request URL (${method} ${path})`, code: "resource_missing" } } };
  }
}

/** A Stripe event envelope around an invoice, as delivered to webhooks. */
export function invoiceEvent(type: string, invoice: unknown, id = `evt_${Math.random().toString(36).slice(2, 12)}`, livemode = false) {
  return { id, object: "event", api_version: "2024-06-20", created: 1_800_000_000, type, livemode, data: { object: invoice } };
}

function bracket(p: URLSearchParams, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of p) {
    const m = new RegExp(`^${name}\\[([^\\]]+)\\]$`).exec(k);
    if (m) out[m[1]!] = v;
  }
  return out;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const missing = (what: string): Reply => ({ status: 404, body: { error: { message: `No such ${what}`, code: "resource_missing" } } });

function respond(r: Reply): Response {
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...r.headers } });
}
