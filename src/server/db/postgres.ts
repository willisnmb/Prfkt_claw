import "server-only";
import postgres from "postgres";
import type { Sql } from "./sql";
import { serverEnv } from "../env";

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

let pool: Sql | undefined;

/** Server-only control-plane connection. Throws when DATABASE_URL is not configured. */
export function getSql(): Sql {
  if (pool) return pool;
  const url = serverEnv().DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  // prepare:false keeps compatibility with Supabase's transaction pooler.
  pool = wrap(postgres(url, { max: 5, prepare: false, idle_timeout: 20 }), false);
  return pool;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured");
    this.name = "DatabaseNotConfiguredError";
  }
}
