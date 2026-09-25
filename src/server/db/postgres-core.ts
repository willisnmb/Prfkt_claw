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
export function createPostgresSql(url: string, max = 5): { sql: Sql; end: () => Promise<void> } {
  const client = postgres(url, { max, prepare: false, idle_timeout: 20 });
  return { sql: wrap(client, false), end: () => client.end() };
}
