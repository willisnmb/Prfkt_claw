import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTO_DEFAULT_INPUT, recommend } from "@/domain/auto";
import { CATALOG } from "@/domain/catalog";
import type { ServerEnv } from "@/server/env";
import { one, withUser } from "@/server/db/sql";
import { generateSeedSql } from "@/server/data/seed";
import { INTAKE_MESSAGES, processCustomBuildRequest, processSaveConfiguration } from "@/server/data/intake";
import { exportCustomerData } from "@/server/data/export";
import {
  cancelAccountDeletion,
  cancelDeploymentRequest,
  createDeploymentRequest,
  loadCustomerDashboard,
  requestAccountDeletion,
} from "@/server/data/customer";
import {
  addClawEvidence,
  completeAccountDeletion,
  createProvisioningJob,
  listAudit,
  listFlagViews,
  reviewDeploymentRequest,
  setClawMaturity,
  setClawPublished,
  setFeatureFlag,
  setRuntimeStatus,
  updateCustomRequest,
  type OwnerContext,
} from "@/server/data/admin";
import { backupTenant, BackupIntegrityError, restoreTenant } from "@/server/backup/logical";
import { loadPublishedCatalog } from "@/server/data/catalog";
import { applySeed, createTestDb, createUser, createUserWithId, insertTestClaw, splitSql, type TestDb } from "../support/db";

const env = (over: Partial<ServerEnv> = {}): ServerEnv => ({
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: undefined,
  NEXT_PUBLIC_SUPABASE_URL: undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  DATABASE_URL: undefined,
  ADMIN_EMAILS: ["owner@prfkt.test"],
  BILLING_ENABLED: false,
  PROVISIONING_ENABLED: false,
  PAYMENT_WEBHOOK_SECRET: undefined,
  OLLAMA_BASE_URL: undefined,
  PRFKT_CELL_CONTROLLER_URL: undefined,
  PRFKT_CELL_CONTROLLER_TOKEN: undefined,
  ...over,
});

// Assembled at runtime so no complete secret literal exists in source (secrets scan).
const FAKE_ANTHROPIC_KEY = ["sk", "ant", "api03", "C".repeat(32)].join("-");

const owner: OwnerContext = { actor: { userId: null, email: "owner@prfkt.test" }, requestId: "req-test" };

const validRequest = {
  contactName: "Ada Customer",
  contactEmail: "ada@customer.test",
  company: "Customer Co",
  problem: "Our inbound support email is overwhelming; we need triage with drafted replies.",
  dataSensitivity: "internal",
  timeline: "this-quarter",
  budgetRange: "5k-25k",
  consent: true,
};

describe("seed", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it("is idempotent and preserves owner edits", async () => {
    await applySeed(t.sql);
    const count = async () =>
      one<{ f: number; r: number; m: number; c: number; flags: number; claws: number }>(
        t.sql,
        `select (select count(*)::int from public.foundations) f, (select count(*)::int from public.runtime_registry) r,
                (select count(*)::int from public.model_registry) m, (select count(*)::int from public.compute_registry) c,
                (select count(*)::int from public.feature_flags) flags, (select count(*)::int from public.claws) claws`,
      );
    const first = await count();
    expect(first).toMatchObject({ f: 14, m: 7, c: 8, flags: 4, claws: CATALOG.length });
    await t.sql.query("update public.runtime_registry set status = 'disabled' where id = 'openclaw'");
    await t.sql.query("update public.feature_flags set enabled = false where key = 'custom_intake_enabled'");
    if (CATALOG[0]) await t.sql.query("update public.claws set published = false where slug = $1", [CATALOG[0].slug]);
    await applySeed(t.sql);
    expect(await count()).toEqual(first);
    const rt = await one<{ status: string }>(t.sql, "select status from public.runtime_registry where id = 'openclaw'");
    expect(rt.status).toBe("disabled");
    const flag = await one<{ enabled: boolean }>(t.sql, "select enabled from public.feature_flags where key = 'custom_intake_enabled'");
    expect(flag.enabled).toBe(false);
    if (CATALOG[0]) {
      const c = await one<{ published: boolean }>(t.sql, "select published from public.claws where slug = $1", [CATALOG[0].slug]);
      expect(c.published).toBe(false);
    }
  });

  it("starts billing and provisioning disabled", async () => {
    const rows = await t.sql.query<{ key: string; enabled: boolean }>(
      "select key, enabled from public.feature_flags where key in ('billing_enabled','provisioning_enabled')",
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.enabled === false)).toBe(true);
  });

  it("generated SQL is one statement per line", () => {
    expect(splitSql(generateSeedSql()).every((s) => s.endsWith(";"))).toBe(true);
  });

  it("every seeded catalog item round-trips through the public loader", async () => {
    const { items, invalid } = await loadPublishedCatalog(t.sql);
    expect(invalid).toEqual([]);
    const published = CATALOG.length ? CATALOG.length - 1 : 0; // one unpublished above
    expect(items).toHaveLength(published);
  });
});

describe("custom intake pipeline", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await applySeed(t.sql);
  });
  afterEach(() => t.close());

  it("stores a valid request and returns a reference", async () => {
    const res = await processCustomBuildRequest(t.sql, validRequest, { ip: "203.0.113.1", env: env() });
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    expect(res.data.reference).toMatch(/^CR-[A-Z0-9]{8}$/);
    const row = await one<{ status: string; tenant_id: string | null }>(
      t.sql,
      "select status, tenant_id from public.custom_build_requests where reference = $1",
      [res.data.reference],
    );
    expect(row).toEqual({ status: "RECEIVED", tenant_id: null });
  });

  it("returns field errors for invalid input and stores nothing", async () => {
    const res = await processCustomBuildRequest(t.sql, { ...validRequest, contactEmail: "nope", problem: "short" }, { ip: "203.0.113.2", env: env() });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.contactEmail).toBeTruthy();
    expect(res.fieldErrors?.problem).toBeTruthy();
    expect((await t.sql.query("select 1 from public.custom_build_requests")).length).toBe(0);
  });

  it("requires consent", async () => {
    const res = await processCustomBuildRequest(t.sql, { ...validRequest, consent: false }, { ip: "203.0.113.3", env: env() });
    expect(res).toMatchObject({ ok: false });
  });

  it("honeypot: generic rejection, nothing stored, event recorded", async () => {
    const res = await processCustomBuildRequest(t.sql, { ...validRequest, website: "http://spam.test" }, { ip: "203.0.113.4", env: env() });
    expect(res).toEqual({ ok: false, error: INTAKE_MESSAGES.rejected });
    expect((await t.sql.query("select 1 from public.custom_build_requests")).length).toBe(0);
    expect((await t.sql.query("select 1 from public.system_events where kind = 'intake.honeypot'")).length).toBe(1);
  });

  it("rate-limits per IP and per email", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(
        await processCustomBuildRequest(t.sql, { ...validRequest, contactEmail: `p${i}@customer.test` }, { ip: "198.51.100.9", env: env() }),
      );
    }
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5]).toEqual({ ok: false, error: INTAKE_MESSAGES.rateLimited });
    const byEmail = [];
    for (let i = 0; i < 4; i++) {
      byEmail.push(await processCustomBuildRequest(t.sql, { ...validRequest, contactEmail: "same@customer.test" }, { ip: `192.0.2.${i}`, env: env() }));
    }
    expect(byEmail.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(byEmail[3]).toEqual({ ok: false, error: INTAKE_MESSAGES.rateLimited });
    // Raw IPs and emails are not stored in bucket keys.
    const keys = await t.sql.query<{ key: string }>("select key from public.rate_limit_buckets");
    expect(keys.some((k) => k.key.includes("198.51.100.9") || k.key.includes("same@customer.test"))).toBe(false);
  });

  it("respects the intake flag", async () => {
    await t.sql.query("update public.feature_flags set enabled = false where key = 'custom_intake_enabled'");
    const res = await processCustomBuildRequest(t.sql, validRequest, { ip: "203.0.113.5", env: env() });
    expect(res).toEqual({ ok: false, error: INTAKE_MESSAGES.disabled });
  });

  it("links signed-in submissions to the submitter's tenant", async () => {
    const u = await createUser(t.sql, "signed@customer.test");
    const res = await processCustomBuildRequest(t.sql, validRequest, { ip: "203.0.113.6", env: env(), userId: u.userId });
    expect(res.ok).toBe(true);
    const dash = await loadCustomerDashboard(t.sql, u.userId);
    expect(dash.customRequests).toHaveLength(1);
  });
});

describe("configurations and deployment requests", () => {
  let t: TestDb;
  let a: { userId: string; tenantId: string };
  let b: { userId: string; tenantId: string };
  beforeAll(async () => {
    t = await createTestDb();
    await applySeed(t.sql);
    a = await createUser(t.sql, "a@cfg.test");
    b = await createUser(t.sql, "b@cfg.test");
  });
  afterAll(() => t.close());

  it("requires a signed-in user", async () => {
    const res = await processSaveConfiguration(t.sql, { name: "x", auto: AUTO_DEFAULT_INPUT }, { userId: null, env: env() });
    expect(res).toEqual({ ok: false, error: INTAKE_MESSAGES.signInToSave });
  });

  it("recomputes the recommendation server-side and ignores client-supplied recommendations", async () => {
    const input = { name: "Front desk", auto: { ...AUTO_DEFAULT_INPUT, privacy: "air-gapped" }, recommendation: { modelPolicy: "maximum-intelligence" } };
    const res = await processSaveConfiguration(t.sql, input, { userId: a.userId, env: env() });
    expect(res.ok).toBe(true);
    const dash = await loadCustomerDashboard(t.sql, a.userId);
    expect(dash.configurations).toHaveLength(1);
    const expected = recommend({ ...AUTO_DEFAULT_INPUT, privacy: "air-gapped" });
    expect(dash.configurations[0]!.recommendation.modelPolicy).toBe(expected.modelPolicy);
    expect(dash.configurations[0]!.recommendation.modelPolicy).toBe("local-only");
    expect((await loadCustomerDashboard(t.sql, b.userId)).configurations).toHaveLength(0);
  });

  it("rejects invalid configurator input", async () => {
    const res = await processSaveConfiguration(t.sql, { name: "x", auto: { privacy: "whatever" } }, { userId: a.userId, env: env() });
    expect(res.ok).toBe(false);
  });

  it("creates one pending deployment request per configuration; customers can cancel but not approve", async () => {
    const cfg = (await loadCustomerDashboard(t.sql, a.userId)).configurations[0]!;
    const r1 = await createDeploymentRequest(t.sql, a.userId, { configurationId: cfg.id, note: "Please deploy" });
    const r2 = await createDeploymentRequest(t.sql, a.userId, { configurationId: cfg.id });
    expect(r1.ok && r2.ok && r1.data.id === r2.data.id).toBe(true);
    const other = await createDeploymentRequest(t.sql, b.userId, { configurationId: cfg.id });
    expect(other).toEqual({ ok: false, error: "Configuration not found." });
    if (!r1.ok) return;
    expect(await cancelDeploymentRequest(t.sql, b.userId, { id: r1.data.id })).toMatchObject({ ok: false });
    expect(await cancelDeploymentRequest(t.sql, a.userId, { id: r1.data.id })).toMatchObject({ ok: true });
    expect(await cancelDeploymentRequest(t.sql, a.userId, { id: r1.data.id })).toMatchObject({ ok: false });
  });
});

describe("owner operations are audited in the same transaction", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await applySeed(t.sql);
    await insertTestClaw(t.sql, "owner-claw");
  });
  afterAll(() => t.close());

  it("publish toggle writes an audit entry", async () => {
    await t.sql.transaction((tx) => setClawPublished(tx, owner, { slug: "owner-claw", published: false }));
    const audit = await listAudit(t.sql, { action: "catalog.set_published" });
    expect(audit[0]).toMatchObject({ actor_email: "owner@prfkt.test", target_id: "owner-claw", request_id: "req-test" });
    expect(audit[0]!.after).toEqual({ published: false });
  });

  it("READY is refused without evidence and allowed with all gates", async () => {
    const res = await t.sql.transaction((tx) => setClawMaturity(tx, owner, { slug: "owner-claw", maturity: "READY" }));
    expect(res.ok).toBe(false);
    const gates = ["dependency_scan", "secrets_scan", "rls_isolation", "redclaw_critical", "backup_restore", "admin_authorization", "public_abuse_controls", "runtime_isolation"];
    await t.sql.transaction(async (tx) => {
      for (const gate of gates) await addClawEvidence(tx, owner, { slug: "owner-claw", gate, ref: "ci/run/42", verifiedAt: "2026-09-25" });
    });
    const ok = await t.sql.transaction((tx) => setClawMaturity(tx, owner, { slug: "owner-claw", maturity: "READY" }));
    expect(ok.ok).toBe(true);
    expect((await listAudit(t.sql, { action: "catalog.add_evidence" })).length).toBe(8);
  });

  it("a failed transaction leaves no audit entry", async () => {
    const before = (await listAudit(t.sql)).length;
    await expect(
      t.sql.transaction(async (tx) => {
        await setRuntimeStatus(tx, owner, { id: "openclaw", status: "connected" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await listAudit(t.sql)).length).toBe(before);
    const rt = await one<{ status: string }>(t.sql, "select status from public.runtime_registry where id = 'openclaw'");
    expect(rt.status).toBe("not-configured");
  });

  it("audit payloads are secret-redacted", async () => {
    await t.sql.transaction((tx) =>
      setRuntimeStatus(tx, owner, { id: "ollama", status: "not-configured", notes: `token ${FAKE_ANTHROPIC_KEY} leaked` }),
    );
    const [row] = await listAudit(t.sql, { action: "registry.runtime_status" });
    expect(JSON.stringify(row!.after)).not.toContain(FAKE_ANTHROPIC_KEY);
    expect(JSON.stringify(row!.after)).toContain("[REDACTED:anthropic-key]");
  });

  it("flags cannot exceed the environment ceiling", async () => {
    const denied = await t.sql.transaction((tx) => setFeatureFlag(tx, owner, { key: "billing_enabled", enabled: true }, env()));
    expect(denied).toMatchObject({ ok: false });
    const allowed = await t.sql.transaction((tx) =>
      setFeatureFlag(tx, owner, { key: "provisioning_enabled", enabled: true }, env({ PROVISIONING_ENABLED: true })),
    );
    expect(allowed.ok).toBe(true);
    const views = await listFlagViews(t.sql, env());
    expect(views.find((v) => v.key === "provisioning_enabled")).toMatchObject({ stored: true, effective: false, envCeiling: false });
    await t.sql.transaction((tx) => setFeatureFlag(tx, owner, { key: "provisioning_enabled", enabled: false }, env()));
  });

  it("deployment review and provisioning stay review-gated and blocked by default", async () => {
    const u = await createUser(t.sql, "deploy@customer.test");
    const cfg = await processSaveConfiguration(t.sql, { name: "Ops", auto: AUTO_DEFAULT_INPUT }, { userId: u.userId, env: env() });
    if (!cfg.ok) throw new Error("setup");
    const req = await createDeploymentRequest(t.sql, u.userId, { configurationId: cfg.data.id });
    if (!req.ok) throw new Error("setup");

    const early = await t.sql.transaction((tx) => createProvisioningJob(tx, owner, { deploymentRequestId: req.data.id }, env()));
    expect(early).toMatchObject({ ok: false });

    const noNote = await t.sql.transaction((tx) => reviewDeploymentRequest(tx, owner, { id: req.data.id, decision: "REJECTED" }));
    expect(noNote).toMatchObject({ ok: false });
    expect((await t.sql.transaction((tx) => reviewDeploymentRequest(tx, owner, { id: req.data.id, decision: "APPROVED" }))).ok).toBe(true);
    expect((await t.sql.transaction((tx) => reviewDeploymentRequest(tx, owner, { id: req.data.id, decision: "REJECTED", note: "x" }))).ok).toBe(false);

    const job1 = await t.sql.transaction((tx) => createProvisioningJob(tx, owner, { deploymentRequestId: req.data.id }, env()));
    const job2 = await t.sql.transaction((tx) => createProvisioningJob(tx, owner, { deploymentRequestId: req.data.id }, env()));
    expect(job1).toMatchObject({ ok: true, data: { status: "BLOCKED" } });
    expect(job1.ok && job2.ok && job1.data?.id === job2.data?.id).toBe(true);
    const blocked = await one<{ blocked_reason: string }>(t.sql, "select blocked_reason from public.provisioning_jobs where deployment_request_id = $1", [
      req.data.id,
    ]);
    expect(blocked.blocked_reason).toMatch(/PROVISIONING_ENABLED=false/);
    const dash = await loadCustomerDashboard(t.sql, u.userId);
    expect(dash.deploymentRequests[0]!.status).toBe("APPROVED");
  });

  it("custom request triage follows the workflow and keeps notes private", async () => {
    const res = await processCustomBuildRequest(t.sql, validRequest, { ip: "203.0.113.50", env: env() });
    if (!res.ok) throw new Error("setup");
    const { id } = await one<{ id: string }>(t.sql, "select id from public.custom_build_requests where reference = $1", [res.data.reference]);
    await expect(t.sql.transaction((tx) => updateCustomRequest(tx, owner, { id, status: "CONVERTED" }))).rejects.toThrow(/invalid custom request transition/);
    expect((await t.sql.transaction((tx) => updateCustomRequest(tx, owner, { id, status: "TRIAGED", ownerNotes: "good fit" }))).ok).toBe(true);
  });
});

describe("customer export and deletion", () => {
  let t: TestDb;
  let a: { userId: string; tenantId: string };
  let b: { userId: string; tenantId: string };
  beforeAll(async () => {
    t = await createTestDb();
    await applySeed(t.sql);
    a = await createUser(t.sql, "a@export.test");
    b = await createUser(t.sql, "b@export.test");
    for (const u of [a, b]) {
      await processSaveConfiguration(t.sql, { name: `cfg-${u.userId.slice(0, 4)}`, auto: AUTO_DEFAULT_INPUT }, { userId: u.userId, env: env() });
      await withUser(t.sql, u.userId, (tx) =>
        tx.query("insert into public.memory_items (tenant_id, content, source_type, created_by) values ($1, $2, 'user', $3)", [
          u.tenantId,
          `note for ${u.userId}`,
          u.userId,
        ]),
      );
    }
    await processCustomBuildRequest(t.sql, validRequest, { ip: "203.0.113.70", env: env(), userId: a.userId });
    await t.sql.query("update public.custom_build_requests set owner_notes = 'internal only'");
  });
  afterAll(() => t.close());

  it("exports only the requester's tenant data and excludes owner notes", async () => {
    const out = await exportCustomerData(t.sql, a.userId);
    const text = JSON.stringify(out);
    expect(out.tenantId).toBe(a.tenantId);
    expect(text).not.toContain(b.userId);
    expect(text).not.toContain(b.tenantId);
    expect(text).not.toContain("internal only");
    expect(out.data.configurations).toHaveLength(1);
    expect(out.data.memory_items).toHaveLength(1);
    expect(out.data.custom_build_requests).toHaveLength(1);
    const recorded = await withUser(t.sql, a.userId, (tx) => tx.query("select 1 from public.data_export_requests"));
    expect(recorded).toHaveLength(1);
  });

  it("deletion: request, cancel, re-request, owner completes; other tenants untouched", async () => {
    expect(await requestAccountDeletion(t.sql, a.userId, { confirm: "nope" })).toMatchObject({ ok: false });
    const r1 = await requestAccountDeletion(t.sql, a.userId, { confirm: "DELETE", reason: "done" });
    expect(r1.ok).toBe(true);
    expect((await loadCustomerDashboard(t.sql, a.userId)).openDeletionRequest).not.toBeNull();
    expect((await cancelAccountDeletion(t.sql, a.userId)).ok).toBe(true);
    const r2 = await requestAccountDeletion(t.sql, a.userId, { confirm: "DELETE" });
    if (!r2.ok) throw new Error("setup");

    const res = await t.sql.transaction((tx) => completeAccountDeletion(tx, owner, { id: r2.data.id }));
    expect(res).toMatchObject({ ok: true, data: { tenantsDeleted: 1 } });
    for (const table of ["configurations", "memory_items", "custom_build_requests", "tenant_members"]) {
      const rows = await t.sql.query(`select 1 from public.${table} where tenant_id = $1`, [a.tenantId]);
      expect(rows, table).toHaveLength(0);
    }
    expect(await t.sql.query("select 1 from auth.users where id = $1", [a.userId])).toHaveLength(0);
    expect(await t.sql.query("select 1 from public.tenants where id = $1", [a.tenantId])).toHaveLength(0);
    expect((await loadCustomerDashboard(t.sql, b.userId)).configurations).toHaveLength(1);
    const audit = await listAudit(t.sql, { action: "account.delete" });
    expect(audit[0]).toMatchObject({ target_id: a.userId });
    expect(JSON.stringify(audit[0])).not.toContain("a@export.test");
  });
});

describe("tenant backup and restore", () => {
  let source: TestDb;
  let target: TestDb;
  let a: { userId: string; tenantId: string };
  beforeAll(async () => {
    source = await createTestDb();
    target = await createTestDb();
    await applySeed(source.sql);
    await applySeed(target.sql);
    a = await createUser(source.sql, "a@backup.test");
    const cfg = await processSaveConfiguration(source.sql, { name: "Backed up", auto: AUTO_DEFAULT_INPUT }, { userId: a.userId, env: env() });
    if (!cfg.ok) throw new Error("setup");
    await createDeploymentRequest(source.sql, a.userId, { configurationId: cfg.data.id, note: "n" });
    const m = await withUser(source.sql, a.userId, (tx) =>
      one<{ id: string }>(tx, "insert into public.memory_items (tenant_id, content, source_type, created_by) values ($1, 'first', 'user', $2) returning id", [
        a.tenantId,
        a.userId,
      ]),
    );
    await withUser(source.sql, a.userId, (tx) =>
      tx.query(
        "insert into public.memory_items (tenant_id, content, source_type, created_by, supersedes_id, correction_reason) values ($1, 'second', 'user', $2, $3, 'fix')",
        [a.tenantId, a.userId, m.id],
      ),
    );
    await source.sql.query(
      `insert into public.runtime_cells (tenant_id, name, runtime, model_policy, compute_class, deployment_target, secret_refs)
       values ($1, 'main', 'openclaw', 'balanced', 'cpu', 'managed-cell', $2::jsonb)`,
      [a.tenantId, JSON.stringify({ gw: `secret://${a.tenantId}/gateway` })],
    );
  });
  afterAll(async () => {
    await source.close();
    await target.close();
  });

  it("restores into a fresh database with identical content", async () => {
    const backup = await backupTenant(source.sql, a.tenantId);
    expect(backup.rowCount).toBeGreaterThanOrEqual(7);
    await expect(restoreTenant(target.sql, backup)).rejects.toThrow(/missing auth users/);
    await createUserWithId(target.sql, a.userId, "a@backup.test");
    const first = await restoreTenant(target.sql, backup);
    expect(first.inserted).toBeGreaterThan(0);
    const again = await restoreTenant(target.sql, backup);
    expect(again.inserted).toBe(0);
    const roundTrip = await backupTenant(target.sql, a.tenantId);
    expect(roundTrip.tables).toEqual(backup.tables);
    expect(roundTrip.checksum).toBe(backup.checksum);
    const dash = await loadCustomerDashboard(target.sql, a.userId);
    expect(dash.configurations.map((c) => c.name)).toContain("Backed up");
  });

  it("refuses a tampered backup", async () => {
    const backup = await backupTenant(source.sql, a.tenantId);
    const tampered = { ...backup, tables: { ...backup.tables, configurations: [] } };
    await expect(restoreTenant(target.sql, tampered)).rejects.toBeInstanceOf(BackupIntegrityError);
  });
});
