"use server";

import { headers } from "next/headers";
import type { ActionResult } from "@/domain/intake";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured, serverEnv } from "@/server/env";
import { getOptionalUser } from "@/server/auth/user";
import { clientIpFromHeaders } from "@/server/rate-limit";
import { processCustomBuildRequest, processSaveConfiguration } from "@/server/data/intake";

/**
 * Server actions for the configurator and custom intake. Validation, abuse
 * controls and persistence live in src/server/data/intake.ts (tested against
 * Postgres). Without a database these fail clearly — never a fake success.
 */

const NOT_CONFIGURED = "This environment is not connected to a database, so nothing can be saved here yet.";

export async function saveConfiguration(input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const user = await getOptionalUser();
  try {
    return await processSaveConfiguration(getSql(), input, { userId: user?.id, env: serverEnv() });
  } catch (err) {
    console.error("saveConfiguration failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "We couldn't save this configuration. Please try again." };
  }
}

export async function submitCustomBuildRequest(input: unknown): Promise<ActionResult<{ reference: string }>> {
  if (!isDatabaseConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const [user, h] = await Promise.all([getOptionalUser(), headers()]);
  try {
    return await processCustomBuildRequest(getSql(), input, { ip: clientIpFromHeaders(h), userId: user?.id, env: serverEnv() });
  } catch (err) {
    console.error("submitCustomBuildRequest failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "We couldn't submit this request. Please try again." };
  }
}
