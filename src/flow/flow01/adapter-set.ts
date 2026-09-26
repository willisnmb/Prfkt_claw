import type { Sql } from "@/server/db/sql";
import { StripeClient, StripePaymentAdapter } from "@/billing/stripe";
import type { Flow01Adapters, PaymentAdapter } from "./adapters";
import { createFakeAdapters } from "./fakes";
import type { Flow01Availability } from "./runtime-policy";

/**
 * FLOW 01's side-effect adapters for an availability decision. Shared by the
 * web process (wiring.ts) and the worker (scripts/flow-worker.ts) so both
 * always act through the same providers.
 */

export class BillingDisabledError extends Error {
  constructor() {
    super("billing is disabled: the billing_enabled flag is off, so no invoice was created");
    this.name = "BillingDisabledError";
  }
}

/**
 * The stored `billing_enabled` flag. The environment ceiling
 * (BILLING_ENABLED=true) is already required to select Stripe at all; the
 * flag lets an owner stop invoicing without a redeploy (src/server/flags.ts).
 */
export async function billingFlagOn(sql: Sql): Promise<boolean> {
  const rows = await sql.query<{ enabled: boolean }>("select enabled from public.feature_flags where key = 'billing_enabled'");
  return rows[0]?.enabled === true;
}

/** Checks the gate before every call, so turning billing off takes effect on the next invoice. */
export function gatePayment(adapter: PaymentAdapter, isEnabled: () => Promise<boolean>): PaymentAdapter {
  return {
    async createInvoice(input) {
      if (!(await isEnabled())) throw new BillingDisabledError();
      return adapter.createInvoice(input);
    },
  };
}

export function createFlow01Adapters(
  sql: Sql,
  availability: Extract<Flow01Availability, { enabled: true }>,
  opts: { stripeSecretKey?: string; stripeAllowLive?: boolean; fetchImpl?: typeof fetch } = {},
): Flow01Adapters {
  const fakes = createFakeAdapters(sql);
  if (availability.payment === "fake") return fakes;
  const client = new StripeClient({ apiKey: opts.stripeSecretKey ?? "", allowLive: opts.stripeAllowLive, fetchImpl: opts.fetchImpl });
  return { ...fakes, payment: gatePayment(new StripePaymentAdapter({ client }), () => billingFlagOn(sql)) };
}
