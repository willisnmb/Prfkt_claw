import "server-only";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured, serverEnv } from "@/server/env";
import { createFlow01Adapters } from "./adapter-set";
import { Flow01Engine } from "./engine";
import { flow01Availability, type Flow01Availability, type PaymentMode } from "./runtime-policy";

export function getFlow01Availability(): Flow01Availability {
  const env = serverEnv();
  return flow01Availability({
    NODE_ENV: env.NODE_ENV,
    databaseConfigured: isDatabaseConfigured(env),
    BILLING_ENABLED: env.BILLING_ENABLED,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_ALLOW_LIVE: env.STRIPE_ALLOW_LIVE,
  });
}

export interface Flow01Runtime {
  engine: Flow01Engine;
  payment: PaymentMode;
}

let runtime: Flow01Runtime | undefined;

/** The web process's engine and payment mode, or null when FLOW 01 is not available in this environment. */
export function getFlow01Runtime(): Flow01Runtime | null {
  const availability = getFlow01Availability();
  if (!availability.enabled) return null;
  if (runtime) return runtime;
  const sql = getSql();
  const env = serverEnv();
  const adapters = createFlow01Adapters(sql, availability, { stripeSecretKey: env.STRIPE_SECRET_KEY, stripeAllowLive: env.STRIPE_ALLOW_LIVE });
  runtime = { engine: new Flow01Engine({ sql, adapters, workerId: `web-${process.pid}` }), payment: availability.payment };
  return runtime;
}

/** The web process's engine, or null when FLOW 01 is not available in this environment. */
export function getFlow01Engine(): Flow01Engine | null {
  return getFlow01Runtime()?.engine ?? null;
}
