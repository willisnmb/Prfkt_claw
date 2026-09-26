import "server-only";
import { redactDeep } from "@/security/secrets";
import type { Sql } from "./db/sql";

export interface AuditActor {
  userId: string | null;
  email: string;
}

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/**
 * Appends to admin_audit_log. Call inside the same transaction as the
 * mutation it records so the change and its evidence commit together.
 * Payloads are secret-redacted before they are stored.
 */
export async function writeAudit(tx: Sql, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await tx.query(
    `insert into public.admin_audit_log (actor_user_id, actor_email, action, target_type, target_id, before, after, request_id)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      actor.userId,
      actor.email,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.before === undefined ? null : JSON.stringify(redactDeep(entry.before)),
      entry.after === undefined ? null : JSON.stringify(redactDeep(entry.after)),
      entry.requestId ?? null,
    ],
  );
}
