import { z } from "zod";
import { verifyWebhook } from "@/security/webhooks";
import type { WebhookIngest, WebhookIngestResult } from "@/flow/flow01/engine";
import type { WebhookResponse } from "@/flow/flow01/webhook-handler";
import { INVOICE_REFERENCE_KEY, StripeInvoice } from "./stripe";

/**
 * Inbound Stripe webhooks for FLOW 01 (F-008), independent of Next.js.
 * Order: availability → size limit → `Stripe-Signature` over the RAW body
 * (HMAC-SHA256, 300 s tolerance, any of several v1 values) → JSON → schema →
 * event filter → dedupe/ingest on the Stripe event id → bounded advance.
 * A bad signature is a 400 and nothing is parsed or stored. Events we do not
 * act on get a 200 so Stripe stops retrying them. Responses never echo internals.
 */
export const STRIPE_PROVIDER = "stripe";
export const STRIPE_PAID_EVENTS = ["invoice.paid", "invoice.payment_succeeded"] as const;
/** Invoice events carry the whole invoice; allow more than the PRFKT envelope. */
const MAX_BODY_BYTES = 512 * 1024;

const StripeEvent = z.object({
  id: z.string().max(200).regex(/^evt_[A-Za-z0-9_]+$/),
  object: z.literal("event"),
  type: z.string().min(1).max(100),
  livemode: z.boolean(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type Ingest = (input: WebhookIngest) => Promise<WebhookIngestResult>;

export type PaidInvoiceDecision =
  | { apply: true; payment: { workflowId: string; invoiceId: string; amountCents: number } }
  | { apply: false; reason: "not_paid" | "no_reference" | "currency_mismatch" | "livemode_refused" };

/** Which run a paid Stripe invoice pays for, if any. Shared by the webhook and reconciliation. */
export function paidInvoicePayment(invoice: StripeInvoice, opts: { currency: string; allowLive: boolean }): PaidInvoiceDecision {
  if (invoice.livemode && !opts.allowLive) return { apply: false, reason: "livemode_refused" };
  if (invoice.status !== "paid") return { apply: false, reason: "not_paid" };
  const reference = invoice.metadata[INVOICE_REFERENCE_KEY];
  if (!reference) return { apply: false, reason: "no_reference" };
  if (invoice.currency !== opts.currency) return { apply: false, reason: "currency_mismatch" };
  return { apply: true, payment: { workflowId: reference, invoiceId: invoice.id, amountCents: invoice.amount_paid } };
}

/**
 * Records a paid invoice as FLOW 01's `payment.succeeded` through the same
 * ingest as every other webhook. The engine checks the run is waiting on
 * payment and, before asking the owner to approve, that invoice id and amount
 * match what it issued; an unknown reference is stored as `unknown_workflow`.
 */
export function recordStripePayment(ingest: Ingest, eventId: string, payment: { workflowId: string; invoiceId: string; amountCents: number }): Promise<WebhookIngestResult> {
  return ingest({ provider: STRIPE_PROVIDER, eventId, type: "payment.succeeded", payload: payment });
}

export interface StripeWebhookEngine {
  ingestWebhook: Ingest;
  advance(workflowId: string, opts?: { maxSteps?: number }): Promise<unknown>;
}

export async function handleStripeWebhook(input: {
  rawBody: string;
  signature: string | null;
  secret: string | undefined;
  /** Null unless FLOW 01 is available here AND payments go through Stripe. */
  engine: StripeWebhookEngine | null;
  allowLive: boolean;
  currency?: string;
  nowSeconds?: number;
}): Promise<WebhookResponse> {
  if (!input.engine) return { status: 503, body: { error: "Stripe billing is not enabled here" } };
  if (!input.secret) return { status: 503, body: { error: "webhook verification is not configured" } };
  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_BODY_BYTES) return { status: 413, body: { error: "payload too large" } };

  // Verify the exact bytes Stripe signed before anything reads them.
  const verified = verifyWebhook(input.secret, input.rawBody, input.signature, input.nowSeconds);
  if (!verified.ok) return { status: 400, body: { error: "invalid signature" } };

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }
  const event = StripeEvent.safeParse(json);
  if (!event.success) return { status: 400, body: { error: "invalid event" } };
  if (!(STRIPE_PAID_EVENTS as readonly string[]).includes(event.data.type)) return { status: 200, body: { received: true, ignored: "event_type" } };
  if (event.data.livemode && !input.allowLive) return { status: 200, body: { received: true, ignored: "livemode_refused" } };

  const invoice = StripeInvoice.safeParse(event.data.data.object);
  if (!invoice.success) return { status: 400, body: { error: "invalid invoice" } };
  const decision = paidInvoicePayment(invoice.data, { currency: input.currency ?? "usd", allowLive: input.allowLive });
  if (!decision.apply) return { status: 200, body: { received: true, ignored: decision.reason } };

  const engine = input.engine;
  const result = await recordStripePayment((i) => engine.ingestWebhook(i), event.data.id, decision.payment);
  if (!result.duplicate && result.outcome === "applied" && result.workflowId) {
    // Best effort: the worker picks the run up if this fails or halts early.
    await engine.advance(result.workflowId, { maxSteps: 20 }).catch(() => undefined);
  }
  return { status: 200, body: { received: true, duplicate: result.duplicate, outcome: result.outcome } };
}
