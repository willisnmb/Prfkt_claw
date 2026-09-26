import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTO_DEFAULT_INPUT, recommend } from "@/domain/auto";
import { resolveRuntimeAdapter } from "@/runtime/factory";
import type { ServerEnv } from "@/server/env";
import { one, withUser } from "@/server/db/sql";
import { processSaveConfiguration } from "@/server/data/intake";
import { createDeploymentRequest } from "@/server/data/customer";
import { createProvisioningJob, listAudit, reviewDeploymentRequest, setFeatureFlag, type OwnerContext } from "@/server/data/admin";
import { buildCellSpec, cancelProvisioningJob, MAX_ATTEMPTS, requeueProvisioningJob, runProvisioningJob } from "@/server/data/provisioning";
import { applySeed, createTestDb, createUser, type TestDb } from "../support/db";
import { FakeCellController } from "../runtime/fake-controller";

const env = (over: Partial<ServerEnv> = {}): ServerEnv => ({
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: undefined,
  NEXT_PUBLIC_SUPABASE_URL: undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  DATABASE_URL: undefined,
  ADMIN_EMAILS: ["owner@prfkt.test"],
  BILLING_ENABLED: false,
  PROVISIONING_ENABLED: true,
  PAYMENT_WEBHOOK_SECRET: undefined,
  OLLAMA_BASE_URL: undefined,
  PRFKT_CELL_CONTROLLER_URL: "https://controller.prfkt.test",
  PRFKT_CELL_CONTROLLER_TOKEN: "t".repeat(40),
  ...over,
});

const owner: OwnerContext = { actor: { userId: null, email: "owner@prfkt.test" }, requestId: "req-prov" };

let t: TestDb;
let ctl: FakeCellController;
const deps = (e: ServerEnv = env()) => ({ resolveAdapter: (rt: string) => resolveRuntimeAdapter(rt, e, { fetchImpl: ctl.fetch }) });

async function queuedJob(email: string): Promise<{ jobId: string; tenantId: string; userId: string }> {
  const u = await createUser(t.sql, email);
  const cfg = await processSaveConfiguration(t.sql, { name: "Ops", auto: AUTO_DEFAULT_INPUT }, { userId: u.userId, env: env() });
  if (!cfg.ok) throw new Error("setup: configuration");
  const req = await createDeploymentRequest(t.sql, u.userId, { configurationId: cfg.data.id });
  if (!req.ok) throw new Error("setup: request");
  await t.sql.transaction((tx) => reviewDeploymentRequest(tx, owner, { id: req.data.id, decision: "APPROVED" }));
  const job = await t.sql.transaction((tx) => createProvisioningJob(tx, owner, { deploymentRequestId: req.data.id }, env()));
  if (!job.ok || !job.data) throw new Error("setup: job");
  return { jobId: job.data.id, tenantId: u.tenantId, userId: u.userId };
}

const jobRow = (id: string) =>
  one<{ status: string; attempts: number; last_error: string | null; cell_id: string | null }>(
    t.sql,
    "select status, attempts, last_error, cell_id from public.provisioning_jobs where id = $1",
    [id],
  );

beforeAll(async () => {
  t = await createTestDb();
  await applySeed(t.sql);
  // Open the gate: env ceiling on (above) and the DB flag on.
  const r = await t.sql.transaction((tx) => setFeatureFlag(tx, owner, { key: "provisioning_enabled", enabled: true }, env()));
  if (!r.ok) throw new Error("setup: flag");
});
afterAll(async () => t.close());
beforeEach(() => {
  ctl = new FakeCellController();
  ctl.token = "t".repeat(40);
});

describe("provisioning job runner (F-006d)", () => {
  it("builds a least-privilege, deterministic cell spec from the saved recommendation", () => {
    const rec = recommend(AUTO_DEFAULT_INPUT);
    const id = "3f1c2a9e-0000-4000-8000-00000000abcd";
    const spec = buildCellSpec({ id, tenantId: "11111111-1111-4111-8111-111111111111", runtime: "openclaw" }, rec);
    expect(spec).toMatchObject({ cellId: `cell-${id}`, runtime: "openclaw", profile: "SAFE", toolAllowlist: [], secretRefs: {}, egressAllowlist: [] });
    expect(buildCellSpec({ id, tenantId: spec.tenantId, runtime: "openclaw" }, rec)).toEqual(spec);
    expect(() => buildCellSpec({ id, tenantId: spec.tenantId, runtime: "openclaw" }, { ...rec, profile: "OWNER" })).toThrow();
  });

  it("runs a queued job: one cell, ACTIVE row, SUCCEEDED job, audit for start and finish; re-running is a no-op", async () => {
    const { jobId, tenantId, userId } = await queuedJob("prov-ok@customer.test");
    const res = await runProvisioningJob(t.sql, owner, { jobId }, env(), deps());
    expect(res).toMatchObject({ ok: true, data: { status: "SUCCEEDED", cellId: `cell-${jobId}` } });
    expect(ctl.created).toBe(1);

    const job = await jobRow(jobId);
    expect(job).toMatchObject({ status: "SUCCEEDED", attempts: 1, last_error: null });
    const cell = await one<{ tenant_id: string; name: string; status: string; health: string; endpoint_ref: string }>(
      t.sql,
      "select tenant_id, name, status, health, endpoint_ref from public.runtime_cells where id = $1",
      [job.cell_id],
    );
    expect(cell).toMatchObject({ tenant_id: tenantId, name: `cell-${jobId}`, status: "ACTIVE", health: "healthy" });
    expect(cell.endpoint_ref).not.toMatch(/token|secret/i);

    expect((await listAudit(t.sql, { action: "provisioning.run_started" })).some((a) => a.target_id === jobId)).toBe(true);
    expect((await listAudit(t.sql, { action: "provisioning.succeeded" })).some((a) => a.target_id === jobId)).toBe(true);

    // The customer sees their own cell through RLS.
    const own = await withUser(t.sql, userId, (tx) => tx.query<{ name: string }>("select name from public.runtime_cells"));
    expect(own.map((c) => c.name)).toContain(`cell-${jobId}`);

    const again = await runProvisioningJob(t.sql, owner, { jobId }, env(), deps());
    expect(again).toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(ctl.created).toBe(1);
  });

  it("records a controller failure, lets the owner retry, and the retry reuses the idempotency key", async () => {
    const { jobId } = await queuedJob("prov-fail@customer.test");
    ctl.failNext = 10;
    const failed = await runProvisioningJob(t.sql, owner, { jobId }, env(), deps());
    expect(failed.ok).toBe(false);
    expect(await jobRow(jobId)).toMatchObject({ status: "FAILED", attempts: 1 });
    expect((await jobRow(jobId)).last_error).toMatch(/503|unreachable/);
    expect((await listAudit(t.sql, { action: "provisioning.failed" })).some((a) => a.target_id === jobId)).toBe(true);

    // FAILED cannot run directly; the owner re-queues it first.
    expect(await runProvisioningJob(t.sql, owner, { jobId }, env(), deps())).toMatchObject({ ok: false });
    expect(await t.sql.transaction((tx) => requeueProvisioningJob(tx, owner, { jobId }, env()))).toMatchObject({ ok: true });

    ctl.failNext = 0;
    expect(await runProvisioningJob(t.sql, owner, { jobId }, env(), deps())).toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });
    expect(await jobRow(jobId)).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    const keys = new Set(ctl.requests.filter((r) => r.method === "POST" && r.path === "/v1/cells").map((r) => r.key));
    expect(keys).toEqual(new Set([`deployment:${(await one<{ deployment_request_id: string }>(t.sql, "select deployment_request_id from public.provisioning_jobs where id = $1", [jobId])).deployment_request_id}`]));
  });

  it("refuses to run when the environment ceiling is off, the controller is missing, or the job is not queued", async () => {
    const { jobId } = await queuedJob("prov-gate@customer.test");
    const off = await runProvisioningJob(t.sql, owner, { jobId }, env({ PROVISIONING_ENABLED: false }), deps(env({ PROVISIONING_ENABLED: false })));
    expect(off).toMatchObject({ ok: false, error: expect.stringMatching(/disabled/) });
    const noCtl = env({ PRFKT_CELL_CONTROLLER_URL: undefined });
    expect(await runProvisioningJob(t.sql, owner, { jobId }, noCtl, deps(noCtl))).toMatchObject({ ok: false, error: expect.stringMatching(/not configured/) });
    const shortToken = env({ PRFKT_CELL_CONTROLLER_TOKEN: "short" });
    expect(await runProvisioningJob(t.sql, owner, { jobId }, shortToken, deps(shortToken))).toMatchObject({ ok: false, error: expect.stringMatching(/too short/) });
    // Nothing was claimed or sent.
    expect(await jobRow(jobId)).toMatchObject({ status: "QUEUED", attempts: 0, cell_id: null });
    expect(ctl.requests).toHaveLength(0);

    expect(await t.sql.transaction((tx) => cancelProvisioningJob(tx, owner, { jobId }))).toMatchObject({ ok: true });
    expect(await runProvisioningJob(t.sql, owner, { jobId }, env(), deps())).toMatchObject({ ok: false, error: expect.stringMatching(/CANCELLED/) });
    expect(await t.sql.transaction((tx) => requeueProvisioningJob(tx, owner, { jobId }, env()))).toMatchObject({ ok: false });
  });

  it("a fresh RUNNING job cannot be run twice; attempts are capped", async () => {
    const { jobId } = await queuedJob("prov-running@customer.test");
    await t.sql.query("update public.provisioning_jobs set status = 'RUNNING' where id = $1", [jobId]);
    expect(await runProvisioningJob(t.sql, owner, { jobId }, env(), deps())).toMatchObject({ ok: false, error: expect.stringMatching(/already running/) });
    // A stale RUNNING job (crash between the transactions) can be resumed. The touch trigger
    // would reset updated_at, so it is paused while the clock is wound back.
    await t.sql.query("alter table public.provisioning_jobs disable trigger provisioning_jobs_touch");
    try {
      await t.sql.query("update public.provisioning_jobs set updated_at = now() - interval '1 hour' where id = $1", [jobId]);
    } finally {
      await t.sql.query("alter table public.provisioning_jobs enable trigger provisioning_jobs_touch");
    }
    expect(await runProvisioningJob(t.sql, owner, { jobId }, env(), deps())).toMatchObject({ ok: true, data: { status: "SUCCEEDED" } });

    const capped = await queuedJob("prov-capped@customer.test");
    await t.sql.query("update public.provisioning_jobs set attempts = $2 where id = $1", [capped.jobId, MAX_ATTEMPTS]);
    expect(await runProvisioningJob(t.sql, owner, { jobId: capped.jobId }, env(), deps())).toMatchObject({ ok: false, error: expect.stringMatching(/attempts/) });
  });
});
