import { createHash } from "node:crypto";
import type { Sql } from "../db/sql";
import { one } from "../db/sql";

/**
 * Tenant-scoped logical backup and restore. This is the application-level
 * backup used for restore drills, tenant migration and export; it does not
 * replace platform backups (Supabase PITR), which must be configured and
 * restore-tested by the owner.
 *
 * Tables are listed in dependency order. Rows are captured with to_jsonb and
 * restored with jsonb_populate_recordset, so column types round-trip exactly.
 */
export const BACKUP_FORMAT = "prfkt-tenant-backup/v1";

interface TableSpec {
  table: string;
  /** SQL predicate selecting this tenant's rows; $1 = tenant id. */
  where: string;
  orderBy: string;
  conflict: string;
  /**
   * "replace": rows with the same key are replaced by the backup copy. Used for
   * profiles, which the signup trigger recreates when an identity is restored.
   */
  mode?: "insert" | "replace";
}

export const TENANT_TABLES: readonly TableSpec[] = [
  { table: "tenants", where: "id = $1", orderBy: "id", conflict: "(id)" },
  {
    table: "profiles",
    where: "id in (select user_id from public.tenant_members where tenant_id = $1)",
    orderBy: "id",
    conflict: "(id)",
    mode: "replace",
  },
  { table: "tenant_members", where: "tenant_id = $1", orderBy: "user_id", conflict: "(tenant_id, user_id)" },
  { table: "configurations", where: "tenant_id = $1", orderBy: "id", conflict: "(id)" },
  { table: "custom_build_requests", where: "tenant_id = $1", orderBy: "id", conflict: "(id)" },
  { table: "runtime_cells", where: "tenant_id = $1", orderBy: "id", conflict: "(id)" },
  { table: "deployment_requests", where: "tenant_id = $1", orderBy: "id", conflict: "(id)" },
  { table: "provisioning_jobs", where: "tenant_id = $1", orderBy: "id", conflict: "(id)" },
  { table: "memory_items", where: "tenant_id = $1", orderBy: "created_at, id", conflict: "(id)" },
  { table: "data_export_requests", where: "tenant_id = $1", orderBy: "id", conflict: "(id)" },
  { table: "account_deletion_requests", where: "tenant_id = $1", orderBy: "id", conflict: "(id)" },
];

export interface TenantBackup {
  format: typeof BACKUP_FORMAT;
  tenantId: string;
  createdAt: string;
  tables: Record<string, unknown[]>;
  rowCount: number;
  checksum: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function checksumTables(tables: Record<string, unknown[]>): string {
  return createHash("sha256").update(canonical(tables)).digest("hex");
}

/** Service path only (owner or scheduled job). */
export async function backupTenant(sql: Sql, tenantId: string): Promise<TenantBackup> {
  return sql.transaction(async (tx) => {
    // Consistent snapshot of every table in one transaction.
    await tx.query("set transaction isolation level repeatable read");
    const tables: Record<string, unknown[]> = {};
    let rowCount = 0;
    for (const spec of TENANT_TABLES) {
      const r = await one<{ rows: unknown[] }>(
        tx,
        `select coalesce(jsonb_agg(to_jsonb(t) order by ${spec.orderBy.split(",").map((c) => `t.${c.trim()}`).join(", ")}), '[]'::jsonb) as rows
         from public.${spec.table} t where ${spec.where}`,
        [tenantId],
      );
      tables[spec.table] = r.rows;
      rowCount += r.rows.length;
    }
    return { format: BACKUP_FORMAT, tenantId, createdAt: new Date().toISOString(), tables, rowCount, checksum: checksumTables(tables) };
  });
}

export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupIntegrityError";
  }
}

/**
 * Restores a tenant backup. Verifies the checksum, requires the referenced
 * auth users to exist (identities are restored through Supabase Auth, not
 * SQL), and is idempotent (existing rows are kept; profiles are replaced).
 */
export async function restoreTenant(sql: Sql, backup: TenantBackup): Promise<{ inserted: number; replaced: number }> {
  if (backup.format !== BACKUP_FORMAT) throw new BackupIntegrityError("unknown backup format");
  if (checksumTables(backup.tables) !== backup.checksum) throw new BackupIntegrityError("checksum mismatch");
  const userIds = new Set<string>();
  for (const m of (backup.tables.tenant_members ?? []) as Array<{ user_id: string }>) userIds.add(m.user_id);
  return sql.transaction(async (tx) => {
    if (userIds.size) {
      const found = await tx.query<{ id: string }>("select id from auth.users where id = any($1::uuid[])", [[...userIds]]);
      const missing = [...userIds].filter((id) => !found.some((f) => f.id === id));
      if (missing.length) throw new BackupIntegrityError(`missing auth users: ${missing.join(", ")}`);
    }
    let inserted = 0;
    let replaced = 0;
    for (const spec of TENANT_TABLES) {
      const rows = backup.tables[spec.table] ?? [];
      if (!rows.length) continue;
      if (spec.mode === "replace") {
        await tx.query(`delete from public.${spec.table} where id in (select (r ->> 'id')::uuid from jsonb_array_elements($1::jsonb) r)`, [
          JSON.stringify(rows),
        ]);
      }
      const res = await tx.query<{ n: number }>(
        `with ins as (
           insert into public.${spec.table}
           select * from jsonb_populate_recordset(null::public.${spec.table}, $1::jsonb)
           on conflict ${spec.conflict} do nothing
           returning 1)
         select count(*)::int as n from ins`,
        [JSON.stringify(rows)],
      );
      if (spec.mode === "replace") replaced += res[0]?.n ?? 0;
      else inserted += res[0]?.n ?? 0;
    }
    return { inserted, replaced };
  });
}

/** Records backup state for the admin System page. */
export async function recordBackupRun(
  sql: Sql,
  run: { tenantId: string; status: "succeeded" | "failed" | "restore-verified"; rowCount?: number; checksum?: string; error?: string },
): Promise<void> {
  await sql.query(
    `insert into public.backup_runs (kind, tenant_id, status, row_count, checksum, error, finished_at, restore_verified_at)
     values ('logical-tenant', $1, $2, $3, $4, $5, now(), case when $2 = 'restore-verified' then now() end)`,
    [run.tenantId, run.status, run.rowCount ?? null, run.checksum ?? null, run.error ?? null],
  );
}
