/**
 * FLOW 01 worker: advances due runs (retries, timers, woken waits).
 *   DATABASE_URL=... npx tsx scripts/flow-worker.ts
 * Refuses to run where FLOW 01 is disabled (production until real adapters
 * pass acceptance). Stops cleanly on SIGINT/SIGTERM after the current run.
 */
import { createPostgresSql } from "../src/server/db/postgres-core";
import { Flow01Engine } from "../src/flow/flow01/engine";
import { createFlow01Adapters } from "../src/flow/flow01/adapter-set";
import { flow01Availability } from "../src/flow/flow01/runtime-policy";

const url = process.env.DATABASE_URL;
// Same inputs as the web process (src/flow/flow01/wiring.ts), so both use the same payment provider.
const availability = flow01Availability({
  NODE_ENV: process.env.NODE_ENV,
  databaseConfigured: Boolean(url),
  BILLING_ENABLED: process.env.BILLING_ENABLED === "true",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY?.trim() || undefined,
  STRIPE_ALLOW_LIVE: process.env.STRIPE_ALLOW_LIVE === "true",
});
if (!availability.enabled) {
  console.error(`flow-worker: not starting — ${availability.reason}`);
  process.exit(1);
}

const { sql, end } = createPostgresSql(url!, 3);
const adapters = createFlow01Adapters(sql, availability, {
  stripeSecretKey: process.env.STRIPE_SECRET_KEY?.trim(),
  stripeAllowLive: process.env.STRIPE_ALLOW_LIVE === "true",
});
const engine = new Flow01Engine({ sql, adapters, workerId: `worker-${process.pid}` });
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));

async function loop() {
  console.log(`flow-worker ${process.pid}: started (${availability.reason})`);
  while (!stopping) {
    const due = await engine.dueRuns(25);
    for (const id of due) {
      if (stopping) break;
      const r = await engine.advance(id).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      console.log(JSON.stringify({ at: new Date().toISOString(), workflowId: id, ...r }));
    }
    if (due.length === 0) await new Promise((r) => setTimeout(r, 5_000));
  }
  await end();
  console.log("flow-worker: stopped");
}

loop().catch((e) => {
  console.error(e);
  process.exit(1);
});
