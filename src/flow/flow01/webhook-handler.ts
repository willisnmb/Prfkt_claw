import { z } from "zod";
import { verifyWebhook } from "@/security/webhooks";
import type { Flow01Engine } from "./engine";

/**
 * Inbound FLOW 01 webhook handling, independent of Next.js so it can be tested
 * against a real engine. Order: size limit → signature (with replay window)
 * → schema → dedupe/ingest → bounded advance. Responses never echo internals.
 */
export const FLOW01_WEBHOOK_PROVIDERS = ["fake-email", "fake-pay"] as const;
const MAX_BODY_BYTES = 64 * 1024;

const Envelope = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["lead.reply", "payment.succeeded"]),
  data: z.record(z.string(), z.unknown()),
});

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export async function handleFlow01Webhook(input: {
  provider: string;
  rawBody: string;
  signature: string | null;
  secret: string | undefined;
  engine: Flow01Engine | null;
  nowSeconds?: number;
}): Promise<WebhookResponse> {
  if (!(FLOW01_WEBHOOK_PROVIDERS as readonly string[]).includes(input.provider)) return { status: 404, body: { error: "unknown provider" } };
  if (!input.engine) return { status: 503, body: { error: "workflow processing is not available" } };
  if (!input.secret) return { status: 503, body: { error: "webhook verification is not configured" } };
  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_BODY_BYTES) return { status: 413, body: { error: "payload too large" } };

  const verified = verifyWebhook(input.secret, input.rawBody, input.signature, input.nowSeconds);
  if (!verified.ok) return { status: 401, body: { error: "invalid signature" } };

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }
  const env = Envelope.safeParse(json);
  if (!env.success) return { status: 400, body: { error: "invalid event" } };

  const result = await input.engine.ingestWebhook({ provider: input.provider, eventId: env.data.id, type: env.data.type, payload: env.data.data });
  if (!result.duplicate && result.outcome === "applied" && result.workflowId) {
    // Best effort: the worker will pick the run up if this fails or halts early.
    await input.engine.advance(result.workflowId, { maxSteps: 20 }).catch(() => undefined);
  }
  return { status: 200, body: { received: true, duplicate: result.duplicate, outcome: result.outcome } };
}
