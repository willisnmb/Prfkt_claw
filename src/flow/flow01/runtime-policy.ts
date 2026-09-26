/**
 * Where FLOW 01 may run, and with which adapters. Fake adapters exist to prove
 * the workflow; they must never touch real leads. Until real email, payment
 * and provisioning adapters pass acceptance (BUILD_INSTRUCTIONS.md §9, §11),
 * FLOW 01 is disabled in production.
 */
export type Flow01Availability =
  | { enabled: true; adapters: "fake"; reason: string }
  | { enabled: false; reason: string };

export function flow01Availability(env: { NODE_ENV?: string; databaseConfigured: boolean }): Flow01Availability {
  if (!env.databaseConfigured) return { enabled: false, reason: "DATABASE_URL is not configured." };
  if (env.NODE_ENV === "production") {
    return { enabled: false, reason: "FLOW 01 is disabled in production until real email, payment and provisioning adapters pass acceptance. Fake adapters are never used on real leads." };
  }
  return { enabled: true, adapters: "fake", reason: "Development/test: fake side-effect adapters only." };
}
