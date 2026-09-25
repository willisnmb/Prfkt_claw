import { openMigratedPglite } from "@/server/db/pglite";
import type { Sql } from "@/server/db/sql";
import { one } from "@/server/db/sql";

export interface TestDb {
  sql: Sql;
  close(): Promise<void>;
}

export async function createTestDb(dataDir?: string): Promise<TestDb> {
  const { db, sql } = await openMigratedPglite(dataDir);
  return { sql, close: () => db.close() };
}

/** Creates an auth user (firing the signup trigger) and returns ids. */
export async function createUser(sql: Sql, email: string): Promise<{ userId: string; tenantId: string }> {
  const u = await one<{ id: string }>(sql, "insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]);
  const m = await one<{ tenant_id: string }>(sql, "select tenant_id from public.tenant_members where user_id = $1", [u.id]);
  return { userId: u.id, tenantId: m.tenant_id };
}
