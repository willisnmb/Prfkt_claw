import "server-only";
import { redactDeep } from "@/security/secrets";
import { getSql } from "../db/postgres";
import { isDatabaseConfigured } from "../env";
import type { Sql } from "../db/sql";

export interface SystemEventInput {
  kind: string;
  severity?: "info" | "warning" | "error" | "critical";
  source?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export async function insertSystemEvent(sql: Sql, e: SystemEventInput): Promise<void> {
  await sql.query(
    "insert into public.system_events (kind, severity, source, message, detail) values ($1, $2, $3, $4, $5::jsonb)",
    [e.kind, e.severity ?? "info", e.source ?? "control-plane", e.message.slice(0, 1000), JSON.stringify(redactDeep(e.detail ?? {}))],
  );
}

/** Best-effort operational event. Never throws into the caller's request path. */
export async function recordSystemEvent(e: SystemEventInput): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await insertSystemEvent(getSql(), e);
  } catch (err) {
    console.error("system event write failed", err instanceof Error ? err.name : "unknown");
  }
}
