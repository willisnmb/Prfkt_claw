import "server-only";
import type { Sql } from "./db/sql";
import type { ServerEnv } from "./env";

/**
 * Feature flags. For gated capabilities the environment is a hard ceiling:
 * the database flag can narrow but never widen what the deployment allows
 * (BUILD_INSTRUCTIONS.md §11).
 */
export const ENV_CEILINGS = {
  billing_enabled: "BILLING_ENABLED",
  provisioning_enabled: "PROVISIONING_ENABLED",
} as const satisfies Record<string, keyof ServerEnv>;

export type FlagKey = "billing_enabled" | "provisioning_enabled" | "custom_intake_enabled" | "configuration_save_enabled";
export const FLAG_KEYS: readonly FlagKey[] = [
  "billing_enabled",
  "provisioning_enabled",
  "custom_intake_enabled",
  "configuration_save_enabled",
];

/** Defaults used when a flag row is missing: gated capabilities stay off. */
const MISSING_DEFAULT: Record<FlagKey, boolean> = {
  billing_enabled: false,
  provisioning_enabled: false,
  custom_intake_enabled: true,
  configuration_save_enabled: true,
};

export function envCeiling(key: FlagKey, env: Pick<ServerEnv, "BILLING_ENABLED" | "PROVISIONING_ENABLED">): boolean {
  if (key === "billing_enabled") return env.BILLING_ENABLED === true;
  if (key === "provisioning_enabled") return env.PROVISIONING_ENABLED === true;
  return true;
}

export function effectiveFlag(
  key: FlagKey,
  dbValue: boolean | undefined,
  env: Pick<ServerEnv, "BILLING_ENABLED" | "PROVISIONING_ENABLED">,
): boolean {
  const stored = dbValue ?? MISSING_DEFAULT[key];
  return stored && envCeiling(key, env);
}

/** Whether an owner may set `key` to `enabled` under the current environment. */
export function canSetFlag(
  key: FlagKey,
  enabled: boolean,
  env: Pick<ServerEnv, "BILLING_ENABLED" | "PROVISIONING_ENABLED">,
): { ok: true } | { ok: false; reason: string } {
  if (!enabled) return { ok: true };
  if (!envCeiling(key, env)) {
    const envVar = ENV_CEILINGS[key as keyof typeof ENV_CEILINGS];
    return { ok: false, reason: `${envVar}=false in this environment; the database flag cannot exceed it.` };
  }
  return { ok: true };
}

export interface FlagRow {
  key: string;
  enabled: boolean;
  description: string;
  updated_at: string;
}

export async function readFlags(sql: Sql): Promise<Map<string, FlagRow>> {
  const rows = await sql.query<FlagRow>("select key, enabled, description, updated_at from public.feature_flags order by key");
  return new Map(rows.map((r) => [r.key, r]));
}

export async function isFlagEnabled(sql: Sql, key: FlagKey, env: ServerEnv): Promise<boolean> {
  const rows = await sql.query<{ enabled: boolean }>("select enabled from public.feature_flags where key = $1", [key]);
  return effectiveFlag(key, rows[0]?.enabled, env);
}
