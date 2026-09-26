import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleFlow01Webhook } from "@/flow/flow01/webhook-handler";
import { flow01Availability } from "@/flow/flow01/runtime-policy";
import { signWebhook } from "@/security/webhooks";
import { fakeWorld } from "@/flow/flow01/fakes";
import { harness, newRun, driveToWaitingForReply, state, type Harness } from "./support";

const SECRET = ["whsec", "flow", "test", "only", "0123456789"].join("_");
const NOW = 1_800_000_000;
let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => h.db.close());

function deliver(engine: ReturnType<Harness["engine"]> | null, provider: string, event: unknown, opts: { secret?: string; ts?: number; sig?: string | null } = {}) {
  const rawBody = JSON.stringify(event);
  return handleFlow01Webhook({
    provider,
    rawBody,
    signature: opts.sig === undefined ? signWebhook(opts.secret ?? SECRET, rawBody, opts.ts ?? NOW) : opts.sig,
    secret: SECRET,
    engine,
    nowSeconds: NOW,
  });
}

describe("FLOW 01 webhook endpoint handler", () => {
  it("verifies, ingests, dedupes and advances", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await driveToWaitingForReply(h, e, wf);
    const ev = { id: "evt_reply_1", type: "lead.reply", data: { workflowId: wf, outcome: "accepted" } };
    expect(await deliver(e, "fake-email", ev)).toEqual({ status: 200, body: { received: true, duplicate: false, outcome: "applied" } });
    expect((await state(h.sql, wf)).currentState).toBe("PAYMENT_CONFIRMATION");
    expect(await deliver(e, "fake-email", ev)).toEqual({ status: 200, body: { received: true, duplicate: true, outcome: "duplicate_suppressed" } });
    expect(await fakeWorld.invoices(h.sql)).toHaveLength(1);
  });

  it("rejects bad signatures, replays, oversize bodies, unknown providers and malformed events", async () => {
    const e = h.engine();
    const ev = { id: "evt_1", type: "lead.reply", data: {} };
    expect((await deliver(e, "fake-email", ev, { secret: "wrong" })).status).toBe(401);
    expect((await deliver(e, "fake-email", ev, { ts: NOW - 3600 })).status).toBe(401);
    expect((await deliver(e, "fake-email", ev, { sig: null })).status).toBe(401);
    expect((await deliver(e, "stripe", ev)).status).toBe(404);
    expect((await deliver(e, "fake-email", { id: "x", type: "account.deleted", data: {} })).status).toBe(400);
    expect((await deliver(e, "fake-email", { id: "big", type: "lead.reply", data: { pad: "x".repeat(70_000) } })).status).toBe(413);
  });

  it("fails closed when the engine or the secret is unavailable", async () => {
    const ev = { id: "evt_1", type: "lead.reply", data: {} };
    expect((await deliver(null, "fake-email", ev)).status).toBe(503);
    const rawBody = JSON.stringify(ev);
    expect((await handleFlow01Webhook({ provider: "fake-email", rawBody, signature: signWebhook(SECRET, rawBody, NOW), secret: undefined, engine: h.engine(), nowSeconds: NOW })).status).toBe(503);
  });
});

describe("FLOW 01 availability policy", () => {
  it("never runs fake adapters in production and needs a database", () => {
    expect(flow01Availability({ NODE_ENV: "production", databaseConfigured: true }).enabled).toBe(false);
    expect(flow01Availability({ NODE_ENV: "development", databaseConfigured: false }).enabled).toBe(false);
    expect(flow01Availability({ NODE_ENV: "development", databaseConfigured: true })).toMatchObject({ enabled: true, adapters: "fake" });
  });
});
