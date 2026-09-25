import type { CellPlan, Lead } from "./definition";

/**
 * Side-effect ports for FLOW 01. Every call carries an idempotency key; a real
 * provider must dedupe on it (as payment/email providers do) so a retried call
 * after a crash returns the original result instead of acting twice.
 */

export interface ModelUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costMicroUsd: number;
}

export interface ResearchResult {
  /** Fetched website/about text — untrusted data. */
  websiteText: string;
  /** Raw structured output from the model, validated by the engine. */
  structured: unknown;
  usage: ModelUsage;
}

export interface ResearchAdapter {
  research(input: { idempotencyKey: string; lead: Lead; prompt: { system: string; user: string } }): Promise<ResearchResult>;
}

export interface EmailAdapter {
  send(input: { idempotencyKey: string; to: string; subject: string; body: string }): Promise<{ messageId: string }>;
}

export interface PaymentAdapter {
  createInvoice(input: { idempotencyKey: string; customerEmail: string; amountCents: number; reference: string }): Promise<{ invoiceId: string }>;
}

export interface ProvisionResult {
  cellId: string;
  resources: string[];
  config: Record<string, unknown>;
}

export interface ProvisionerAdapter {
  /** Resumable: creates only resources missing for this key. */
  provision(input: { idempotencyKey: string; plan: CellPlan }): Promise<ProvisionResult>;
  /** Idempotent compensation: removes whatever exists for this key. */
  teardown(input: { idempotencyKey: string }): Promise<{ removed: number }>;
}

export interface AcceptanceCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AcceptanceAdapter {
  run(input: { cellId: string; config: Record<string, unknown> }): Promise<{ passed: boolean; checks: AcceptanceCheck[] }>;
}

export interface Flow01Adapters {
  research: ResearchAdapter;
  email: EmailAdapter;
  payment: PaymentAdapter;
  provisioner: ProvisionerAdapter;
  acceptance: AcceptanceAdapter;
}

export class ModelTimeoutError extends Error {
  constructor(message = "model call timed out") {
    super(message);
    this.name = "ModelTimeoutError";
  }
}

export class ProvisionerError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "ProvisionerError";
  }
}
