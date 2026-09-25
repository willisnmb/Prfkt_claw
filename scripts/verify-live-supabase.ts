/**
 * Release-gate probe against a REAL Supabase project (rls_isolation,
 * admin_authorization data layer). Creates two throwaway users, attacks
 * across the tenant boundary as Supabase's own `authenticated`/`anon` roles,
 * then deletes everything it created — even when a check fails.
 *
 *   npx tsx scripts/verify-live-supabase.ts          (reads .env.local)
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createPostgresSql } from "../src/server/db/postgres-core";
import { withAnon, withUser, type Sql } from "../src/server/db/sql";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
) as Record<string, string>;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]) if (!env[k]) throw new Error(`${k} missing`);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { sql, end } = createPostgresSql(env.DATABASE_URL!, 2);

const results: { check: string; ok: boolean; detail?: string }[] = [];
const check = async (name: string, fn: () => Promise<boolean | string>) => {
  try {
    const r = await fn();
    results.push({ check: name, ok: r === true, detail: r === true ? undefined : String(r) });
  } catch (e) {
    results.push({ check: name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
};
const denied = async (p: Promise<unknown>) => {
  try {
    await p;
    return "was allowed";
  } catch (e) {
    return /permission denied|row-level security|violates/i.test(String((e as Error).message)) ? true : `unexpected error: ${(e as Error).message}`;
  }
};

const tag = randomBytes(4).toString("hex");
const created: { id: string; tenant: string }[] = [];

async function makeUser(label: string) {
  const { data, error } = await admin.auth.admin.createUser({ email: `rls-probe-${label}-${tag}@prfkt.invalid`, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const [m] = await sql.query<{ tenant_id: string }>("select tenant_id from public.tenant_members where user_id = $1", [data.user.id]);
  if (!m) throw new Error("signup trigger did not create a tenant");
  created.push({ id: data.user.id, tenant: m.tenant_id });
  return { id: data.user.id, tenant: m.tenant_id };
}

async function main() {
  const A = await makeUser("a");
  const B = await makeUser("b");
  const auto = { persistentConversation: true };
  const insertCfg = (tx: Sql, tenant: string) =>
    tx.query<{ id: string }>(
      "insert into public.configurations (tenant_id, name, auto_input, recommendation) values ($1, 'probe', $2::jsonb, '{}'::jsonb) returning id",
      [tenant, JSON.stringify(auto)],
    );

  await check("jsonb parameters round-trip as objects through the production driver", async () => {
    const [r] = await sql.query<{ t: string }>("select jsonb_typeof($1::jsonb) t", [JSON.stringify({ a: 1 })]);
    return r!.t === "object" ? true : `stored as ${r!.t}`;
  });
  await check("signup trigger gives each user a separate tenant", async () => A.tenant !== B.tenant);
  await check("user sees only their own tenant", async () => {
    const rows = await withUser(sql, A.id, (tx) => tx.query<{ id: string }>("select id from public.tenants"));
    return rows.length === 1 && rows[0]!.id === A.tenant ? true : JSON.stringify(rows);
  });
  const [cfg] = await withUser(sql, A.id, (tx) => insertCfg(tx, A.tenant));
  await check("user can create a configuration in their tenant", async () => Boolean(cfg?.id));
  await check("other tenant cannot read it", async () => {
    const rows = await withUser(sql, B.id, (tx) => tx.query("select id from public.configurations where id = $1", [cfg!.id]));
    return rows.length === 0 ? true : "visible";
  });
  await check("other tenant cannot update it", async () => {
    const rows = await withUser(sql, B.id, (tx) => tx.query("update public.configurations set name = 'pwned' where id = $1 returning id", [cfg!.id]));
    return rows.length === 0 ? true : "updated";
  });
  await check("other tenant cannot delete it", async () => {
    const rows = await withUser(sql, B.id, (tx) => tx.query("delete from public.configurations where id = $1 returning id", [cfg!.id]));
    return rows.length === 0 ? true : "deleted";
  });
  await check("cannot insert into another tenant", async () => denied(withUser(sql, B.id, (tx) => insertCfg(tx, A.tenant))));
  await check("cannot join another tenant", async () =>
    denied(withUser(sql, B.id, (tx) => tx.query("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')", [A.tenant, B.id]))),
  );
  for (const t of ["admin_audit_log", "feature_flags", "system_events", "rate_limit_buckets", "backup_runs", "flow_side_effects", "flow_webhook_events"]) {
    await check(`authenticated cannot read owner-only ${t}`, async () => denied(withUser(sql, A.id, (tx) => tx.query(`select 1 from public.${t} limit 1`))));
  }
  await check("customer cannot write audit log", async () =>
    denied(withUser(sql, A.id, (tx) => tx.query("insert into public.admin_audit_log (actor_email, action, target_type) values ('x@y.z', 'forged', 'x')"))),
  );
  await check("append-only / transition guard triggers are deployed", async () => {
    const rows = await sql.query<{ tbl: string; n: number }>(
      `select c.relname tbl, count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and c.relname in ('admin_audit_log','flow_events','flow_evidence','flow_runs','flow_approvals') group by 1`,
    );
    const have = Object.fromEntries(rows.map((r) => [r.tbl, r.n]));
    const missing = ["admin_audit_log", "flow_events", "flow_evidence", "flow_runs", "flow_approvals"].filter((t) => !have[t]);
    return missing.length === 0 ? true : `missing triggers on ${missing.join(", ")}`;
  });
  await check("anon cannot read tenants", async () => denied(withAnon(sql, (tx) => tx.query("select 1 from public.tenants"))));
  await check("anon reads the published catalog (104 items, 0 READY)", async () => {
    const [r] = await withAnon(sql, (tx) => tx.query<{ n: number; ready: number }>("select count(*)::int n, count(*) filter (where maturity = 'READY')::int ready from public.claws"));
    return r!.n === 104 && r!.ready === 0 ? true : JSON.stringify(r);
  });
  await check("feature gates are off", async () => {
    const rows = await sql.query<{ key: string; enabled: boolean }>("select key, enabled from public.feature_flags where key in ('billing_enabled','provisioning_enabled')");
    return rows.length === 2 && rows.every((r) => !r.enabled) ? true : JSON.stringify(rows);
  });
}

main()
  .catch((e) => results.push({ check: "probe setup", ok: false, detail: e instanceof Error ? e.message : String(e) }))
  .finally(async () => {
    for (const u of created) {
      await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
      await sql.query("delete from public.tenants where id = $1", [u.tenant]).catch(() => undefined);
    }
    const leftovers = await sql.query<{ n: number }>("select count(*)::int n from auth.users where email like $1", [`rls-probe-%-${tag}@prfkt.invalid`]);
    await end();
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? `  — ${r.detail}` : ""}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed; cleanup left ${leftovers[0]?.n ?? "?"} probe users`);
    process.exit(failed ? 1 : 0);
  });
