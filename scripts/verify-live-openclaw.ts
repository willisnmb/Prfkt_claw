/**
 * Live validation of the OpenClaw adapter against a REAL cell controller
 * running real OpenClaw containers (release checklist: "OpenClaw adapter
 * validated"; duplicate/failure/resume/export/destroy/health/cost).
 *
 *   npx tsx scripts/verify-live-openclaw.ts        (reads .env.local)
 *
 * The adapter is constructed with provisioningEnabled=true for this probe only;
 * the application flag PROVISIONING_ENABLED stays false. The probe cell is
 * always destroyed at the end, including on failure.
 */
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { OpenClawAdapter } from "../src/runtime/openclaw";
import type { CellHandle, CellSpec } from "../src/runtime/adapter";
import { findSecrets } from "../src/security/secrets";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
) as Record<string, string>;
const url = env.PRFKT_CELL_CONTROLLER_URL;
const token = env.PRFKT_CELL_CONTROLLER_TOKEN;
if (!url || !token) throw new Error("PRFKT_CELL_CONTROLLER_URL / PRFKT_CELL_CONTROLLER_TOKEN missing in .env.local");

const adapter = new OpenClawAdapter({ controllerUrl: url, getControllerToken: async () => token, provisioningEnabled: true, timeoutMs: 180_000, maxAttempts: 2 });
const tenantId = randomUUID();
const spec: CellSpec = {
  tenantId,
  cellId: `cell-probe-${randomBytes(3).toString("hex")}`,
  runtime: "openclaw",
  profile: "SAFE",
  modelPolicy: "local-first",
  compute: "customer-hardware",
  version: "2026.9.4",
  toolAllowlist: ["email.draft"],
  secretRefs: { modelProviderRef: `secret://${tenantId}/model-provider` },
  limits: { maxToolActionsPerRun: 50, maxModelCostCentsPerDay: 0, maxSendsPerHour: 0 },
  egressAllowlist: [],
};

const results: { check: string; ok: boolean; detail?: string; ms: number }[] = [];
async function check(name: string, fn: () => Promise<true | string>) {
  const t = Date.now();
  try {
    const r = await fn();
    results.push({ check: name, ok: r === true, detail: r === true ? undefined : r, ms: Date.now() - t });
  } catch (e) {
    results.push({ check: name, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t });
  }
}

let handle: CellHandle | undefined;


async function main() {
  await check("validate: SAFE spec accepted", async () => ((await adapter.validate(spec)).ok ? true : "rejected"));
  await check("validate: foreign secret reference rejected", async () =>
    (await adapter.validate({ ...spec, secretRefs: { x: `secret://${randomUUID()}/k` } })).ok ? "accepted" : true,
  );
  await check("estimate: no metered compute or managed model cost on customer hardware + local-first", async () => {
    const e = await adapter.estimate(spec);
    return e.computeHoursPerMonth === 0 && e.modelCostCeilingCentsPerDay === 0 ? true : JSON.stringify(e);
  });
  await check("provision: real OpenClaw cell comes up", async () => {
    handle = await adapter.provision(spec, { idempotencyKey: `prov-${spec.cellId}` });
    return handle.cellId === spec.cellId && handle.tenantId === tenantId ? true : JSON.stringify(handle);
  });
  if (!handle) return;
  const h = handle;
  await check("provision: same idempotency key returns the same cell", async () => {
    const again = await adapter.provision(spec, { idempotencyKey: `prov-${spec.cellId}` });
    return JSON.stringify(again) === JSON.stringify(h) ? true : JSON.stringify(again);
  });
  await check("provision: another tenant cannot claim the same cell id", async () => {
    try {
      const other = randomUUID();
      await adapter.provision({ ...spec, tenantId: other, secretRefs: { modelProviderRef: `secret://${other}/m` } }, { idempotencyKey: `steal-${spec.cellId}` });
      return "was allowed";
    } catch {
      return true;
    }
  });
  await check("health: real gateway healthy with full observability contract", async () => {
    const r = await adapter.health(h);
    const keys = ["backupState", "checkedAt", "currentState", "estimatedCostCentsToday", "health", "lastError", "lastSuccessAt", "modelRoute", "pendingApprovals", "runtime", "usage", "version"];
    const missing = keys.filter((k) => !(k in r));
    if (missing.length) return `missing ${missing.join(",")}`;
    return r.currentState === "running" && r.version === "2026.9.4" && r.modelRoute === "local" && r.health !== "down" ? true : JSON.stringify(r);
  });
  await check("isolation: handle for another tenant is refused", async () => {
    const r = await adapter.health({ ...h, tenantId: randomUUID() });
    return r.health === "down" && /403/.test(r.lastError ?? "") ? true : JSON.stringify(r);
  });
  await check("suspend: cell stops and reports suspended (idempotent)", async () => {
    await adapter.suspend(h, { idempotencyKey: `sus-${spec.cellId}` });
    await adapter.suspend(h, { idempotencyKey: `sus-${spec.cellId}` });
    const r = await adapter.health(h);
    return r.currentState === "suspended" ? true : JSON.stringify(r);
  });
  await check("resume: cell returns healthy", async () => {
    await adapter.resume(h, { idempotencyKey: `res-${spec.cellId}` });
    const r = await adapter.health(h);
    return r.currentState === "running" && r.health !== "down" ? true : JSON.stringify(r);
  });
  await check("export: config with secret refs only, verified backup recorded, no secret material", async () => {
    const ex = await adapter.export(h);

    if (findSecrets(JSON.stringify(ex)).length) return "secret material in export";
    const cfg = ex.config as { secretRefs?: Record<string, string>; backup?: { lastVerifiedAt?: string | null; lastError?: string | null } };
    if (cfg.secretRefs?.modelProviderRef !== `secret://${tenantId}/model-provider`) return "secret ref missing";
    return cfg.backup?.lastVerifiedAt ? true : `no verified backup: ${cfg.backup?.lastError ?? "no error recorded"}`;
  });
  await check("health after export reports backup state ok", async () => {
    const r = await adapter.health(h);
    return r.backupState.status === "ok" ? true : JSON.stringify(r.backupState);
  });
  await check("destroy: refuses mismatched confirmation", async () => {
    try {
      await adapter.destroy(h, { idempotencyKey: `d-${spec.cellId}`, confirmCellId: "cell-wrong", exportTaken: true });
      return "was allowed";
    } catch {
      return true;
    }
  });
}

main()
  .catch((e) => results.push({ check: "probe", ok: false, detail: String(e), ms: 0 }))
  .finally(async () => {
    if (handle) {
      const t = Date.now();
      try {
        await adapter.destroy(handle, { idempotencyKey: `d-${spec.cellId}`, confirmCellId: handle.cellId, exportTaken: true }); // probe cleanup must always run, even if the export check failed
        await adapter.destroy(handle, { idempotencyKey: `d-${spec.cellId}`, confirmCellId: handle.cellId, exportTaken: true });
        const r = await adapter.health(handle);
        results.push({ check: "destroy: idempotent, cell reports destroyed", ok: r.currentState === "destroyed", detail: r.currentState === "destroyed" ? undefined : JSON.stringify(r), ms: Date.now() - t });
      } catch (e) {
        results.push({ check: "destroy", ok: false, detail: String(e), ms: Date.now() - t });
      }
    }
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}  (${(r.ms / 1000).toFixed(1)}s)${r.detail ? `  — ${r.detail}` : ""}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed against ${url} (cell ${spec.cellId})`);
    process.exit(failed ? 1 : 0);
  });
