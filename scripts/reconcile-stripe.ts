/**
 * Stripe payment reconciliation for FLOW 01 (F-008). Records payment for runs
 * whose Stripe invoice is paid but whose webhook never arrived; the FLOW
 * worker then advances them to the owner's PAYMENT approval.
 *
 *   DATABASE_URL=... BILLING_ENABLED=true STRIPE_SECRET_KEY=... npx tsx scripts/reconcile-stripe.ts
 *
 * Read-only against Stripe (GET /v1/invoices/:id) and idempotent: running it
 * twice records nothing new. Refuses to run unless billing is enabled and the
 * key passes the same policy as the app (live keys need STRIPE_ALLOW_LIVE=true).
 * Meant for a future cron; no scheduler is attached. Exits 1 on any error.
 */
import { createPostgresSql } from "../src/server/db/postgres-core";
import { checkStripeKey, StripeClient } from "../src/billing/stripe";
import { reconcileStripePayments } from "../src/billing/reconcile";
import { redactSecrets } from "../src/security/secrets";

const url = process.env.DATABASE_URL;
const key = process.env.STRIPE_SECRET_KEY?.trim() || undefined;
const allowLive = process.env.STRIPE_ALLOW_LIVE === "true";

function refuse(reason: string): never {
  console.error(`reconcile-stripe: not running — ${reason}`);
  process.exit(1);
}

if (!url) refuse("DATABASE_URL is not configured.");
if (process.env.BILLING_ENABLED !== "true") refuse("BILLING_ENABLED is not true.");
const check = checkStripeKey(key, allowLive);
if (!check.ok) refuse(check.reason);

const { sql, end } = createPostgresSql(url, 2);
const stripe = new StripeClient({ apiKey: key!, allowLive });

reconcileStripePayments({ sql, stripe })
  .then(async (report) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), mode: stripe.mode, ...report }, null, 2));
    await end();
    process.exit(report.errors.length > 0 ? 1 : 0);
  })
  .catch(async (e: unknown) => {
    console.error(`reconcile-stripe: failed — ${redactSecrets(e instanceof Error ? e.message : String(e))}`);
    await end();
    process.exit(1);
  });
