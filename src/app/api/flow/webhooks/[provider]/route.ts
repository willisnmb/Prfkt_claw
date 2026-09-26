import { NextResponse } from "next/server";
import { handleFlow01Webhook } from "@/flow/flow01/webhook-handler";
import { getFlow01Engine } from "@/flow/flow01/wiring";
import { serverEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: RouteContext<"/api/flow/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  const rawBody = await request.text();
  const res = await handleFlow01Webhook({
    provider,
    rawBody,
    signature: request.headers.get("x-prfkt-signature"),
    secret: serverEnv().PAYMENT_WEBHOOK_SECRET,
    engine: getFlow01Engine(),
  });
  return NextResponse.json(res.body, { status: res.status, headers: { "cache-control": "no-store" } });
}
