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

/** Applies the generated seed (registries, foundations, flags, catalog). */
export async function applySeed(sql: Sql): Promise<void> {
  const { generateSeedSql } = await import("@/server/data/seed");
  for (const stmt of splitSql(generateSeedSql())) await sql.query(stmt);
}

/** Splits generated seed SQL (one statement per line, no multi-line bodies). */
export function splitSql(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--"));
}

/** Creates an auth user with a fixed id (for restore tests). */
export async function createUserWithId(sql: Sql, id: string, email: string): Promise<void> {
  await sql.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [id, email]);
}

/** Inserts a minimal valid catalog row for tests that need one. */
export async function insertTestClaw(sql: Sql, slug: string, opts: { published?: boolean; maturity?: string } = {}): Promise<void> {
  const definition = {
    slug,
    name: `Test ${slug}`,
    family: "CLAW",
    foundation: "chief",
    summary: "A test catalog item used only by automated tests here.",
    description:
      "A test catalog item used only by automated tests. It exists so that database behaviour can be exercised without the seed catalog.",
    outcomes: ["First outcome", "Second outcome"],
    integrations: [],
    actions: [{ action: "READ", rule: "allow" }],
    profile: "SAFE",
    runtime: "openclaw",
    modelPolicies: ["balanced"],
    compute: ["cpu"],
    deployments: ["managed-cell"],
    maturity: "CONFIGURABLE",
    tags: [],
  };
  await sql.query(
    `insert into public.claws (slug, name, family, foundation_id, summary, maturity, published, definition)
     values ($1, $2, 'CLAW', 'chief', $3, $4, $5, $6::jsonb)`,
    [slug, definition.name, definition.summary, opts.maturity ?? "CONFIGURABLE", opts.published ?? true, JSON.stringify(definition)],
  );
}
