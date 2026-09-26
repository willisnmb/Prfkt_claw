import { z } from "zod";
import type { PaymentAdapter } from "@/flow/flow01/adapters";
import { redactSecrets } from "@/security/secrets";

/**
 * Stripe payment adapter for FLOW 01 (F-008).
 *
 * Client choice: a small fetch client against https://api.stripe.com/v1
 * (form-encoded) instead of the `stripe` npm package. We use six endpoints;
 * plain fetch gives us the step-deadline AbortSignal (F-012) and an injectable
 * transport for tests, adds no dependency to audit (scan:deps), and keeps the
 * whole request surface short enough to review. The API version is pinned so
 * responses do not change when the account's default version moves.
 *
 * Nothing here is constructed unless BILLING_ENABLED=true and STRIPE_SECRET_KEY
 * is set (runtime-policy.ts). Live-mode keys are refused unless
 * STRIPE_ALLOW_LIVE=true. The key is held in a private field and never
 * appears in errors, logs or the side-effect ledger.
 */

export const STRIPE_API_BASE = "https://api.stripe.com/v1/";
export const STRIPE_API_VERSION = "2024-06-20";

/* ------------------------------------------------------------ key policy */

export type StripeMode = "test" | "live";
export type StripeKeyCheck = { ok: true; mode: StripeMode } | { ok: false; reason: string };

/** Secret (sk_) or restricted (rk_) keys only; publishable keys never reach the server path. */
const KEY_SHAPE = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/;

export function checkStripeKey(key: string | undefined, allowLive: boolean): StripeKeyCheck {
  if (!key) return { ok: false, reason: "STRIPE_SECRET_KEY is not set." };
  const m = KEY_SHAPE.exec(key);
  if (!m) return { ok: false, reason: "STRIPE_SECRET_KEY must be a Stripe secret (sk_…) or restricted (rk_…) key." };
  const mode = m[1] as StripeMode;
  if (mode === "live" && !allowLive) return { ok: false, reason: "STRIPE_SECRET_KEY is a live-mode key. Live keys are refused unless STRIPE_ALLOW_LIVE=true." };
  return { ok: true, mode };
}

export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

export class StripeApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when no response was received. */
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StripeApiError";
  }
}

/* ---------------------------------------------------------------- client */

export type FormValue = string | number | boolean | undefined | readonly FormValue[] | { readonly [key: string]: FormValue };

/** Stripe's form encoding: nested objects as `a[b]=…`, arrays as `a[0]=…`. */
export function formEncode(params: Readonly<Record<string, FormValue>>): string {
  const out = new URLSearchParams();
  const walk = (name: string, v: FormValue): void => {
    if (v === undefined) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${name}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(`${name}[${k}]`, x);
    else out.append(name, String(v));
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.toString();
}

export interface StripeClientConfig {
  apiKey: string;
  allowLive?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Base for exponential retry backoff; tests pass 0. */
  retryBaseMs?: number;
}

export interface StripeCallOpts {
  signal?: AbortSignal;
}

/** Relative API paths built from validated ids only (never user text). */
const PATH = /^[a-z_]+(?:\/[A-Za-z0-9_]+)*$/;

const StripeErrorBody = z.object({
  error: z.object({ message: z.string().optional(), code: z.string().optional(), type: z.string().optional() }),
});

export class StripeClient {
  readonly mode: StripeMode;
  readonly #key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;

  constructor(cfg: StripeClientConfig) {
    const check = checkStripeKey(cfg.apiKey, cfg.allowLive ?? false);
    if (!check.ok) throw new StripeConfigError(check.reason);
    this.mode = check.mode;
    this.#key = cfg.apiKey;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 20_000;
    this.maxAttempts = Math.max(1, cfg.maxAttempts ?? 3);
    this.retryBaseMs = cfg.retryBaseMs ?? 500;
  }

  get(path: string, query: Readonly<Record<string, FormValue>> = {}, opts: StripeCallOpts = {}): Promise<unknown> {
    return this.request("GET", path, query, undefined, opts.signal);
  }

  /** Every POST carries an idempotency key, so a retry (ours or the engine's) replays the original result. */
  post(path: string, params: Readonly<Record<string, FormValue>>, opts: StripeCallOpts & { idempotencyKey: string }): Promise<unknown> {
    if (!opts.idempotencyKey || opts.idempotencyKey.length > 255) throw new StripeApiError("a Stripe POST needs an idempotency key of at most 255 characters", 0, false);
    return this.request("POST", path, params, opts.idempotencyKey, opts.signal);
  }

  private async request(method: "GET" | "POST", path: string, params: Readonly<Record<string, FormValue>>, idempotencyKey: string | undefined, signal: AbortSignal | undefined): Promise<unknown> {
    if (!PATH.test(path)) throw new StripeApiError(`invalid Stripe path "${path}"`, 0, false);
    const url = new URL(path, STRIPE_API_BASE);
    const encoded = formEncode(params);
    if (method === "GET") url.search = encoded;
    const where = `stripe ${method} /v1/${path}`;
    let last: StripeApiError | undefined;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) await sleep(this.retryBaseMs * 2 ** (attempt - 1), signal);
      if (signal?.aborted) throw new StripeApiError(`${where} cancelled`, 0, false);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${this.#key}`,
            "stripe-version": STRIPE_API_VERSION,
            ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          body: method === "POST" ? encoded : undefined,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (signal?.aborted) throw new StripeApiError(`${where} cancelled`, 0, false);
        last = new StripeApiError(`${where} failed: ${redactSecrets(e instanceof Error ? e.message : String(e))}`, 0, true);
        continue;
      }
      const body: unknown = await res.json().catch(() => undefined);
      if (res.ok && body !== undefined) return body;
      const err = StripeErrorBody.safeParse(body);
      const code = err.success ? err.data.error.code : undefined;
      const detail = err.success && err.data.error.message ? `: ${redactSecrets(err.data.error.message).slice(0, 300)}` : "";
      // Stripe says explicitly when a retry is safe; otherwise retry only rate limits and server errors.
      const hint = res.headers.get("stripe-should-retry");
      const retryable = res.ok || hint === "true" || (hint !== "false" && (res.status === 429 || res.status >= 500));
      last = new StripeApiError(`${where} → ${res.status}${code ? ` (${code})` : ""}${res.ok ? ": invalid JSON" : detail}`, res.status, retryable, code);
      if (!retryable) throw last;
    }
    throw last ?? new StripeApiError(`${where} failed`, 0, true);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/* ------------------------------------------------------------- resources */

const stripeId = (prefix: string) => z.string().max(255).regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`));
export const StripeInvoiceId = stripeId("in");

const Customer = z.object({ id: stripeId("cus"), object: z.literal("customer") });
const CustomerList = z.object({ object: z.literal("list"), data: z.array(Customer) });

/** The invoice fields FLOW 01 relies on. They are stable across Stripe API versions, which matters for webhooks (rendered in the endpoint's version). */
export const StripeInvoice = z.object({
  id: StripeInvoiceId,
  object: z.literal("invoice"),
  status: z.string().nullable(),
  amount_due: z.number().int(),
  amount_paid: z.number().int(),
  currency: z.string().min(3).max(3),
  livemode: z.boolean(),
  metadata: z
    .record(z.string(), z.string())
    .nullish()
    .transform((m) => m ?? {}),
});
export type StripeInvoice = z.infer<typeof StripeInvoice>;
const InvoiceList = z.object({ object: z.literal("list"), data: z.array(StripeInvoice) });

export async function retrieveInvoice(client: StripeClient, invoiceId: string, opts: StripeCallOpts = {}): Promise<StripeInvoice> {
  const id = StripeInvoiceId.parse(invoiceId);
  return StripeInvoice.parse(await client.get(`invoices/${id}`, {}, opts));
}

/* --------------------------------------------------------------- adapter */

export interface StripePaymentConfig {
  client: StripeClient;
  /** Days the customer has to pay (collection_method=send_invoice). */
  daysUntilDue?: number;
  currency?: string;
  /** Invoice line description shown to the customer. */
  lineDescription?: string;
}

/** Metadata on every FLOW 01 invoice. `reference` is the workflow id; webhooks and reconciliation route payments by it. */
export const INVOICE_REFERENCE_KEY = "reference";
const IDEMPOTENCY_METADATA_KEY = "prfkt_idempotency_key";

const CreateInvoiceInput = z.object({
  idempotencyKey: z.string().min(8).max(200),
  customerEmail: z.email().max(254),
  // Stripe's ceiling for a USD amount is 99,999,999 cents.
  amountCents: z.number().int().min(1).max(99_999_999),
  reference: z.string().min(1).max(200),
});

export class StripePaymentAdapter implements PaymentAdapter {
  readonly currency: string;
  private readonly client: StripeClient;
  private readonly daysUntilDue: number;
  private readonly lineDescription: string;

  constructor(cfg: StripePaymentConfig) {
    this.client = cfg.client;
    this.daysUntilDue = z.number().int().min(1).max(365).parse(cfg.daysUntilDue ?? 14);
    this.currency = z.string().regex(/^[a-z]{3}$/).parse(cfg.currency ?? "usd");
    this.lineDescription = cfg.lineDescription ?? "PRFKT system setup";
  }

  /**
   * Finds or creates the customer, then issues one finalized send_invoice
   * invoice for exactly `amountCents`. Each POST uses the caller's key plus a
   * distinct suffix, so a retry replays Stripe's stored result; beyond Stripe's
   * 24-hour idempotency window the invoice is found again by its metadata, so
   * a late operator retry cannot issue a second invoice. The invoice is
   * finalized (payable) but not emailed: delivery is an owner decision (F-008).
   */
  async createInvoice(input: Parameters<PaymentAdapter["createInvoice"]>[0]): Promise<{ invoiceId: string }> {
    const { idempotencyKey: key, customerEmail, amountCents, reference } = CreateInvoiceInput.parse(input);
    const opts = { signal: input.signal };
    const c = this.client;

    const found = CustomerList.parse(await c.get("customers", { email: customerEmail, limit: 1 }, opts)).data[0];
    const customer = found ?? Customer.parse(await c.post("customers", { email: customerEmail, metadata: { prfkt_source: "flow01" } }, { ...opts, idempotencyKey: `${key}:customer` }));

    const invoices = InvoiceList.parse(await c.get("invoices", { customer: customer.id, limit: 100 }, opts)).data;
    let invoice = invoices.find((i) => i.status !== "void" && i.metadata[INVOICE_REFERENCE_KEY] === reference && i.metadata[IDEMPOTENCY_METADATA_KEY] === key);
    if (invoice && invoice.status !== "draft") return { invoiceId: this.checkIssued(invoice, amountCents).id };

    invoice ??= StripeInvoice.parse(
      await c.post(
        "invoices",
        {
          customer: customer.id,
          collection_method: "send_invoice",
          days_until_due: this.daysUntilDue,
          currency: this.currency,
          // We finalize explicitly below; Stripe must not auto-finalize a half-built draft.
          auto_advance: false,
          // Only the line we add belongs on this invoice, never other pending items of the customer.
          pending_invoice_items_behavior: "exclude",
          metadata: { [INVOICE_REFERENCE_KEY]: reference, [IDEMPOTENCY_METADATA_KEY]: key, prfkt_flow: "FLOW_01" },
        },
        { ...opts, idempotencyKey: `${key}:invoice` },
      ),
    );

    if (invoice.amount_due === 0) {
      await c.post(
        "invoiceitems",
        { customer: customer.id, invoice: invoice.id, amount: amountCents, currency: this.currency, description: this.lineDescription, metadata: { [INVOICE_REFERENCE_KEY]: reference } },
        { ...opts, idempotencyKey: `${key}:item` },
      );
    } else if (invoice.amount_due !== amountCents) {
      throw new StripeApiError(`draft invoice ${invoice.id} is for ${invoice.amount_due}, expected ${amountCents}; resolve it in Stripe`, 0, false);
    }

    const finalized = StripeInvoice.parse(await c.post(`invoices/${invoice.id}/finalize`, { auto_advance: false }, { ...opts, idempotencyKey: `${key}:finalize` }));
    return { invoiceId: this.checkIssued(finalized, amountCents).id };
  }

  private checkIssued(invoice: StripeInvoice, amountCents: number): StripeInvoice {
    if (invoice.status !== "open" && invoice.status !== "paid") throw new StripeApiError(`invoice ${invoice.id} is ${invoice.status ?? "unknown"}; resolve it in Stripe`, 0, false);
    if (invoice.currency !== this.currency || invoice.amount_due !== amountCents) {
      throw new StripeApiError(`invoice ${invoice.id} is for ${invoice.amount_due} ${invoice.currency}, expected ${amountCents} ${this.currency}`, 0, false);
    }
    return invoice;
  }
}
