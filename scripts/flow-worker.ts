/**
 * FLOW 01 worker: advances due runs (retries, timers, woken waits).
 *   DATABASE_URL=... npx tsx scripts/flow-worker.ts
 * Refuses to run where FLOW 01 is disabled (production until real adapters
 * pass acceptance). Stops cleanly on SIGINT/SIGTERM after the current run.
 */
import { createPostgresSql } from "../src/server/db/postgres-core";
import { Flow01Engine } from "../src/flow/flow01/engine";
import { createFakeAdapters } from "../src/flow/flow01/fakes";
import { flow01Availability } from "../src/flow/flow01/runtime-policy";

const url = process.env.DATABASE_URL;
const availability = flow01Availability({ NODE_ENV: process.env.NODE_ENV, databaseConfigured: Boolean(url) });
if (!availability.enabled) {
  console.error(`flow-worker: not starting — ${availability.reason}`);
  process.exit(1);
}

const { sql, end } = createPostgresSql(url!, 3);
const engine = new Flow01Engine({ sql, adapters: createFakeAdapters(sql), workerId: `worker-${process.pid}` });
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
