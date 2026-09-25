import type { Sql } from "../db/sql";
import { maybeOne } from "../db/sql";

/**
 * The tenant a user acts in: their admin membership first, then the oldest.
 * Must run inside withUser (RLS) or with an explicit userId on the service path.
 */
export async function primaryTenantIdForUser(sql: Sql, userId: string): Promise<string | undefined> {
  const row = await maybeOne<{ tenant_id: string }>(
    sql,
    `select tenant_id from public.tenant_members where user_id = $1
     order by (role = 'admin') desc, created_at asc limit 1`,
    [userId],
  );
  return row?.tenant_id;
}
