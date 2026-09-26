import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./sql";

/**
 * PGlite binding for tests and the FLOW 01 process-kill harness. Not used in
 * production. `dataDir` makes the database durable on disk across processes.
 */
export function pgliteSql(db: PGlite | Transaction): Sql {
  const isTx = !(db instanceof PGlite);
  return {
    async query<T>(text: string, params: readonly unknown[] = []) {
      const res = await db.query<T>(text, params as unknown[]);
      return res.rows;
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>) {
      if (isTx) return fn(pgliteSql(db));
      return (db as PGlite).transaction((tx) => fn(pgliteSql(tx)));
    },
  };
}

// Scripts and tests run from the repository root.
const ROOT = process.env.PRFKT_ROOT ?? process.cwd();
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
export const AUTH_STUB = join(ROOT, "supabase", "test", "supabase-platform-stub.sql");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

/** Creates (or reopens) a PGlite database with the Supabase platform stub and all migrations applied. */
export async function openMigratedPglite(dataDir?: string): Promise<{ db: PGlite; sql: Sql }> {
  const db = dataDir ? await PGlite.create({ dataDir }) : await PGlite.create();
  const applied = await db
    .query<{ exists: boolean }>("select to_regclass('public.schema_migrations') is not null as exists")
    .then((r) => r.rows[0]?.exists ?? false);
  if (!applied) {
    await db.exec(readFileSync(AUTH_STUB, "utf8"));
    await db.exec("create table public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    await db.exec("revoke all on public.schema_migrations from anon, authenticated");
  }
  for (const file of migrationFiles()) {
    const name = file.split("/").pop()!;
    const done = await db.query("select 1 from public.schema_migrations where name = $1", [name]);
    if (done.rows.length) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(file, "utf8"));
      await tx.query("insert into public.schema_migrations (name) values ($1)", [name]);
    });
  }
  return { db, sql: pgliteSql(db) };
}
