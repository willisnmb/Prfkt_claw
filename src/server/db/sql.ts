/**
 * Minimal SQL port used by every control-plane store. Production binds it to
 * `postgres` (DATABASE_URL); tests bind it to PGlite running the same
 * migrations, so RLS and constraints are exercised against real Postgres.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs fn in a transaction. Nested calls reuse the outer transaction. */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export async function one<T>(sql: Sql, text: string, params?: readonly unknown[]): Promise<T> {
  const rows = await sql.query<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
  return rows[0]!;
}

export async function maybeOne<T>(sql: Sql, text: string, params?: readonly unknown[]): Promise<T | undefined> {
  const rows = await sql.query<T>(text, params);
  if (rows.length > 1) throw new Error(`expected at most one row, got ${rows.length}`);
  return rows[0];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run fn as a Supabase end user: role `authenticated` with JWT claims set for
 * this transaction only, so RLS policies using auth.uid() apply exactly as
 * they do through PostgREST. The user id must come from a verified session.
 */
export function withUser<T>(sql: Sql, userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error("withUser: invalid user id");
  return sql.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await tx.query("set local role authenticated");
    return fn(tx);
  });
}

/** Run fn as the anonymous (signed-out) role. */
export function withAnon<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    await tx.query("set local role anon");
    return fn(tx);
  });
}
