import { checkStripeKey } from "@/billing/stripe";

/**
 * Where FLOW 01 may run, and with which adapters. Fake adapters exist to prove
 * the workflow; they must never touch real leads. Until real email, payment
 * and provisioning adapters pass acceptance (BUILD_INSTRUCTIONS.md §9, §11),
 * FLOW 01 is disabled in production.
 *
 * Payments: the Stripe adapter (src/billing/stripe.ts) replaces the fake one
 * only when BILLING_ENABLED=true AND STRIPE_SECRET_KEY is set. A key that is
 * set but refused (malformed, or live without STRIPE_ALLOW_LIVE=true) disables
 * FLOW 01 rather than silently falling back to fake payments.
 */
export type PaymentMode = "fake" | "stripe";

export type Flow01Availability =
  | { enabled: true; adapters: "fake"; payment: PaymentMode; reason: string }
  | { enabled: false; reason: string };

export interface Flow01PolicyEnv {
  NODE_ENV?: string;
  databaseConfigured: boolean;
  BILLING_ENABLED?: boolean;
  STRIPE_SECRET_KEY?: string;
  STRIPE_ALLOW_LIVE?: boolean;
}

export function flow01Availability(env: Flow01PolicyEnv): Flow01Availability {
  if (!env.databaseConfigured) return { enabled: false, reason: "DATABASE_URL is not configured." };
  if (env.NODE_ENV === "production") {
    return { enabled: false, reason: "FLOW 01 is disabled in production until real email, payment and provisioning adapters pass acceptance. Fake adapters are never used on real leads." };
  }
  if (env.BILLING_ENABLED === true && env.STRIPE_SECRET_KEY) {
    const key = checkStripeKey(env.STRIPE_SECRET_KEY, env.STRIPE_ALLOW_LIVE === true);
    if (!key.ok) return { enabled: false, reason: `Billing is enabled but the Stripe key was refused: ${key.reason}` };
    return { enabled: true, adapters: "fake", payment: "stripe", reason: `Development/test: payments through Stripe (${key.mode} mode); email, research and provisioning adapters are fakes.` };
  }
  return { enabled: true, adapters: "fake", payment: "fake", reason: "Development/test: fake side-effect adapters only." };
}
