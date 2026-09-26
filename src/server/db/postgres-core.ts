import postgres from "postgres";
import type { Sql } from "./sql";

type PgClient = postgres.Sql | postgres.TransactionSql;

function wrap(client: PgClient, inTx: boolean): Sql {
  return {
    async query<T>(text: string, params: readonly unknown[] = []) {
      const rows = await client.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return rows as unknown as T[];
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      if (inTx) return fn(wrap(client, true));
      return (client as postgres.Sql).begin((tx) => fn(wrap(tx, true))) as Promise<T>;
    },
  };
}

/**
 * Postgres binding without the `server-only` guard, for standalone Node
 * processes (the FLOW worker). Next.js code must use getSql() from ./postgres.
 * prepare:false keeps compatibility with Supabase's transaction pooler.
 */
/**
 * json/jsonb parameters are passed through as-is when already a string.
 * Callers bind `JSON.stringify(x)` to `$n::jsonb` (portable across drivers);
 * postgres.js would otherwise JSON-encode that string a second time and store
 * a jsonb *string* instead of an object. PGlite does not double-encode, so
 * this keeps both bindings identical. Verified live by
 * scripts/verify-live-supabase.ts ("jsonb parameters round-trip as objects").
 */
export function serializeJsonParam(x: unknown): string {
  return typeof x === "string" ? x : JSON.stringify(x);
}

const jsonPassthrough = {
  jsonb: { to: 3802, from: [3802], serialize: serializeJsonParam, parse: (x: string) => JSON.parse(x) as unknown },
  json: { to: 114, from: [114], serialize: serializeJsonParam, parse: (x: string) => JSON.parse(x) as unknown },
};

export function createPostgresSql(url: string, max = 5): { sql: Sql; end: () => Promise<void> } {
  const client = postgres(url, { max, prepare: false, idle_timeout: 20, types: jsonPassthrough });
  return { sql: wrap(client, false), end: () => client.end() };
}
