import type { Sql } from "@/server/db/sql";
import { ingestFlow01Webhook } from "@/flow/flow01/engine";
import { redactSecrets } from "@/security/secrets";
import { retrieveInvoice, StripeInvoiceId, type StripeClient } from "./stripe";
import { paidInvoicePayment, recordStripePayment } from "./stripe-webhook";

/**
 * Stripe payment reconciliation for FLOW 01 (F-008): the safety net for
 * webhooks that never arrived or arrived before the run could accept them.
 * Finds runs waiting in PAYMENT_CONFIRMATION with a Stripe invoice and no
 * recorded payment, fetches each invoice (GET only; nothing in Stripe
 * changes), and records the paid ones through the webhook's own ingest path.
 * Idempotent: a recorded payment removes the run from the next selection, and
 * the synthetic event id `reconcile:<invoice>` dedupes like a Stripe event id.
 * It does not advance runs; the FLOW worker picks them up (status `running`).
 * No scheduler is attached — call it from scripts/reconcile-stripe.ts or a cron.
 */

export interface ReconcileItem {
  workflowId: string;
  invoiceId: string;
}

export interface StripeReconcileReport {
  checked: number;
  recorded: (ReconcileItem & { outcome: string })[];
  unpaid: (ReconcileItem & { status: string | null })[];
  skipped: (ReconcileItem & { reason: string })[];
  errors: (ReconcileItem & { error: string })[];
}

export function reconcileEventId(invoiceId: string): string {
  return `reconcile:${invoiceId}`;
}

export async function reconcileStripePayments(input: { sql: Sql; stripe: StripeClient; currency?: string; limit?: number; signal?: AbortSignal }): Promise<StripeReconcileReport> {
  const rows = await input.sql.query<{ workflow_id: string; invoice_id: string }>(
    `select workflow_id, output->>'invoiceId' as invoice_id from public.flow_runs
     where current_state = 'PAYMENT_CONFIRMATION' and output->'payment' is null
       and left(output->>'invoiceId', 3) = 'in_'
     order by updated_at limit $1`,
    [input.limit ?? 100],
  );
  const report: StripeReconcileReport = { checked: rows.length, recorded: [], unpaid: [], skipped: [], errors: [] };
  const opts = { currency: input.currency ?? "usd", allowLive: input.stripe.mode === "live" };

  for (const row of rows) {
    const item = { workflowId: row.workflow_id, invoiceId: row.invoice_id };
    if (input.signal?.aborted) break;
    if (!StripeInvoiceId.safeParse(item.invoiceId).success) {
      report.skipped.push({ ...item, reason: "invalid_invoice_id" });
      continue;
    }
    try {
      const invoice = await retrieveInvoice(input.stripe, item.invoiceId, { signal: input.signal });
      const decision = paidInvoicePayment(invoice, opts);
      if (!decision.apply) {
        if (decision.reason === "not_paid") report.unpaid.push({ ...item, status: invoice.status });
        else report.skipped.push({ ...item, reason: decision.reason });
        continue;
      }
      // The invoice must name this run; never move a payment onto a different one.
      if (decision.payment.workflowId !== item.workflowId) {
        report.skipped.push({ ...item, reason: "reference_mismatch" });
        continue;
      }
      const result = await recordStripePayment((i) => ingestFlow01Webhook(input.sql, i), reconcileEventId(invoice.id), decision.payment);
      report.recorded.push({ ...item, outcome: result.outcome });
    } catch (e) {
      report.errors.push({ ...item, error: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300) });
    }
  }
  return report;
}
