import "server-only";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured, serverEnv } from "@/server/env";
import { Flow01Engine } from "./engine";
import { createFakeAdapters } from "./fakes";
import { flow01Availability, type Flow01Availability } from "./runtime-policy";

export function getFlow01Availability(): Flow01Availability {
  const env = serverEnv();
  return flow01Availability({ NODE_ENV: env.NODE_ENV, databaseConfigured: isDatabaseConfigured(env) });
}

let engine: Flow01Engine | undefined;

/** The web process's engine, or null when FLOW 01 is not available in this environment. */
export function getFlow01Engine(): Flow01Engine | null {
  if (!getFlow01Availability().enabled) return null;
  if (engine) return engine;
  const sql = getSql();
  engine = new Flow01Engine({ sql, adapters: createFakeAdapters(sql), workerId: `web-${process.pid}` });
  return engine;
}
