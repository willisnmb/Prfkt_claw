import { NextResponse } from "next/server";
import { handleStripeWebhook, STRIPE_PROVIDER } from "@/billing/stripe-webhook";
import { handleFlow01Webhook } from "@/flow/flow01/webhook-handler";
import { getFlow01Runtime } from "@/flow/flow01/wiring";
import { serverEnv } from "@/server/env";

export const dynamic = "force-dynamic";

/** Refuse obviously oversized deliveries before reading them; handlers enforce exact limits. */
const MAX_CONTENT_LENGTH = 1024 * 1024;

export async function POST(request: Request, ctx: RouteContext<"/api/flow/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: "payload too large" }, { status: 413, headers: { "cache-control": "no-store" } });
  }
  // The raw text is what the sender signed; handlers verify it before any JSON parsing.
  const rawBody = await request.text();
  const env = serverEnv();
  const flow = getFlow01Runtime();
  const res =
    provider === STRIPE_PROVIDER
      ? await handleStripeWebhook({
          rawBody,
          signature: request.headers.get("stripe-signature"),
          secret: env.STRIPE_WEBHOOK_SECRET,
          engine: flow?.payment === "stripe" ? flow.engine : null,
          allowLive: env.STRIPE_ALLOW_LIVE,
        })
      : await handleFlow01Webhook({
          provider,
          rawBody,
          signature: request.headers.get("x-prfkt-signature"),
          secret: env.PAYMENT_WEBHOOK_SECRET,
          engine: flow?.engine ?? null,
          paymentMode: flow?.payment,
        });
  return NextResponse.json(res.body, { status: res.status, headers: { "cache-control": "no-store" } });
}
