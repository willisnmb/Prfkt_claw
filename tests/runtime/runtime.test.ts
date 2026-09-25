import { beforeEach, describe, expect, it } from "vitest";
import { OpenClawAdapter, isLoopbackOrTailnet } from "@/runtime/openclaw";
import { ProvisioningDisabledError, RuntimeAdapterError, type CellSpec } from "@/runtime/adapter";
import { shieldValidate, estimateCell } from "@/runtime/shield-validate";
import { routeModelCall } from "@/runtime/model-router";
import { probeOllama } from "@/runtime/ollama";
import { MODEL_POLICY_IDS } from "@/domain/registries";
import { FakeCellController } from "./fake-controller";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const spec: CellSpec = {
  tenantId: T1,
  cellId: "cell-acme-01",
  runtime: "openclaw",
  profile: "SAFE",
  modelPolicy: "local-first",
  compute: "unified-memory-node",
  version: "1.0.0",
  toolAllowlist: ["crm.read", "email.draft"],
  secretRefs: { modelProviderRef: `secret://${T1}/model-provider` },
  limits: { maxToolActionsPerRun: 50, maxModelCostCentsPerDay: 500, maxSendsPerHour: 10 },
  egressAllowlist: ["api.crm.test"],
};

let ctl: FakeCellController;
const adapter = (enabled = true) =>
  new OpenClawAdapter({ controllerUrl: "https://controller.prfkt.test", getControllerToken: async () => ctl.token, provisioningEnabled: enabled, fetchImpl: ctl.fetch, maxAttempts: 3 });

beforeEach(() => {
  ctl = new FakeCellController();
});

describe("OpenClaw adapter — validate & estimate", () => {
  it("accepts a clean SAFE spec", async () => {
    expect(await adapter().validate(spec)).toEqual({ ok: true, problems: [] });
  });

  it("rejects secrets, foreign references, wildcard egress, shell tools on SAFE, and OWNER", () => {
    expect(shieldValidate({ ...spec, secretRefs: { apiKeyRef: "sk-ant-api03-" + "A".repeat(40) } }).ok).toBe(false);
    expect(shieldValidate({ ...spec, secretRefs: { modelProviderRef: `secret://${T2}/model-provider` } }).problems.join()).toMatch(/another tenant/);
    expect(shieldValidate({ ...spec, egressAllowlist: ["*"] }).ok).toBe(false);
    expect(shieldValidate({ ...spec, toolAllowlist: ["shell.exec"] }).ok).toBe(false);
    expect(shieldValidate({ ...spec, profile: "OWNER" }).ok).toBe(false);
    expect(shieldValidate({ ...spec, modelPolicy: "local-only", compute: "cpu" }).ok).toBe(false);
  });

  it("estimates compute by time and zero managed model cost for local policies", async () => {
    expect(await adapter().estimate(spec)).toMatchObject({ computeHoursPerMonth: 0, modelCostCeilingCentsPerDay: 0, mayIncurManagedModelCost: false });
    expect(estimateCell({ ...spec, compute: "gpu-48gb", modelPolicy: "balanced" })).toMatchObject({ computeHoursPerMonth: 730, modelCostCeilingCentsPerDay: 500, mayIncurManagedModelCost: true });
    expect(estimateCell({ ...spec, compute: "gpu-48gb" }, 0.25).computeHoursPerMonth).toBe(183);
  });
});

describe("OpenClaw adapter — lifecycle against the cell-controller contract", () => {
  it("provisioning is disabled by default: provision/suspend/resume/destroy refuse, read paths work", async () => {
    const a = adapter(false);
    await expect(a.provision(spec, { idempotencyKey: "prov-1" })).rejects.toThrow(ProvisioningDisabledError);
    const h = { tenantId: T1, cellId: spec.cellId, runtime: "openclaw", endpointRef: "x" };
    await expect(a.suspend(h, { idempotencyKey: "s" })).rejects.toThrow(ProvisioningDisabledError);
    await expect(a.resume(h, { idempotencyKey: "r" })).rejects.toThrow(ProvisioningDisabledError);
    await expect(a.destroy(h, { idempotencyKey: "d", confirmCellId: spec.cellId, exportTaken: true })).rejects.toThrow(ProvisioningDisabledError);
    expect(ctl.requests).toHaveLength(0);
    expect((await a.health(h)).health).toBe("down"); // no such cell yet; reported, not thrown
  });

  it("duplicate provision with the same idempotency key creates one cell", async () => {
    const a = adapter();
    const [h1, h2] = await Promise.all([a.provision(spec, { idempotencyKey: "prov-1" }), a.provision(spec, { idempotencyKey: "prov-1" })]);
    expect(h1).toEqual(h2);
    expect(ctl.created).toBe(1);
  });

  it("retries transient controller failures within the ceiling, and does not retry client errors", async () => {
    ctl.failNext = 2;
    await expect(adapter().provision(spec, { idempotencyKey: "p" })).resolves.toMatchObject({ cellId: spec.cellId });
    ctl = new FakeCellController();
    ctl.failNext = 5;
    await expect(adapter().provision(spec, { idempotencyKey: "p" })).rejects.toMatchObject({ retryable: true });
    expect(ctl.requests).toHaveLength(3);
    ctl = new FakeCellController();
    ctl.failNext = 1;
    ctl.failStatus = 400;
    await expect(adapter().provision(spec, { idempotencyKey: "p" })).rejects.toMatchObject({ retryable: false });
    expect(ctl.requests).toHaveLength(1);
  });

  it("suspend and resume are idempotent and reflected in health", async () => {
    const a = adapter();
    const h = await a.provision(spec, { idempotencyKey: "prov" });
    await a.suspend(h, { idempotencyKey: "sus-1" });
    await a.suspend(h, { idempotencyKey: "sus-1" });
    expect((await a.health(h)).currentState).toBe("suspended");
    await a.resume(h, { idempotencyKey: "res-1" });
    expect(await a.health(h)).toMatchObject({ health: "healthy", currentState: "running" });
  });

  it("health exposes the full observability contract", async () => {
    const a = adapter();
    const h = await a.provision(spec, { idempotencyKey: "prov" });
    const r = await a.health(h);
    expect(Object.keys(r).sort()).toEqual(
      ["backupState", "checkedAt", "currentState", "estimatedCostCentsToday", "health", "lastError", "lastSuccessAt", "modelRoute", "pendingApprovals", "runtime", "usage", "version"].sort(),
    );
    expect(r).toMatchObject({ runtime: "openclaw", version: "1.0.0", modelRoute: "local", pendingApprovals: 1, backupState: { status: "ok" } });
  });

  it("export carries memory provenance and refuses to hand out secret material", async () => {
    const a = adapter();
    const h = await a.provision(spec, { idempotencyKey: "prov" });
    const ex = await a.export(h);
    expect(ex.memory[0]).toMatchObject({ provenance: { sourceType: "user_message", sourceRef: "chat:42" }, supersedes: null });
    expect(JSON.stringify(ex)).toContain(`secret://${T1}/model-provider`);
    ctl.leakSecretInExport = true;
    await expect(a.export(h)).rejects.toThrow(/secret material/);
  });

  it("destroy requires matching confirmation and a prior export; it is idempotent", async () => {
    const a = adapter();
    const h = await a.provision(spec, { idempotencyKey: "prov" });
    await expect(a.destroy(h, { idempotencyKey: "d1", confirmCellId: "cell-other", exportTaken: true })).rejects.toThrow(/confirmation/);
    await expect(a.destroy(h, { idempotencyKey: "d1", confirmCellId: h.cellId, exportTaken: false })).rejects.toThrow(/export/);
    await a.destroy(h, { idempotencyKey: "d1", confirmCellId: h.cellId, exportTaken: true });
    await a.destroy(h, { idempotencyKey: "d1", confirmCellId: h.cellId, exportTaken: true });
    expect((await a.health(h)).currentState).toBe("destroyed");
  });

  it("a handle for another tenant cannot operate on the cell", async () => {
    const a = adapter();
    const h = await a.provision(spec, { idempotencyKey: "prov" });
    await expect(a.export({ ...h, tenantId: T2 })).rejects.toThrow(RuntimeAdapterError);
    expect((await a.health({ ...h, tenantId: T2 })).health).toBe("down");
  });

  it("allows plain http only on loopback and the Tailscale range", () => {
    for (const h of ["localhost", "127.0.0.1", "100.64.0.1", "100.99.71.65", "100.127.255.254"]) expect(isLoopbackOrTailnet(h), h).toBe(true);
    for (const h of ["100.63.255.255", "100.128.0.1", "10.0.0.1", "192.168.1.5", "controller.prfkt.test", "100.99.71.256"]) expect(isLoopbackOrTailnet(h), h).toBe(false);
    expect(() => new OpenClawAdapter({ controllerUrl: "http://100.99.71.65:18950", getControllerToken: async () => "", provisioningEnabled: false })).not.toThrow();
  });

  it("refuses a plain-http controller outside localhost", () => {
    expect(() => new OpenClawAdapter({ controllerUrl: "http://controller.prfkt.test", getControllerToken: async () => "", provisioningEnabled: false })).toThrow(/https/);
  });
});

describe("model router — no silent paid fallback", () => {
  const none = { local: false, "customer-provider": false, "managed-provider": false };

  it("local-first never takes a paid route without explicit approval", () => {
    const r = routeModelCall("local-first", { ...none, "managed-provider": true });
    expect(r).toEqual({ ok: false, reason: "local route unavailable", escalation: { route: "managed-provider", requiresApproval: true } });
    expect(routeModelCall("local-first", { ...none, "managed-provider": true }, { escalationApproved: true })).toMatchObject({ ok: true, paid: true });
  });

  it("policies that cannot incur managed cost never return a paid route, whatever is available", () => {
    const all = { local: true, "customer-provider": true, "managed-provider": true };
    for (const p of ["local-only", "local-first", "customer-provider"] as const) {
      for (const avail of [all, { ...all, local: false }, { ...all, "customer-provider": false }, { ...all, local: false, "customer-provider": false }]) {
        const r = routeModelCall(p, avail);
        if (r.ok) expect(r.paid, `${p} ${JSON.stringify(avail)}`).toBe(false);
      }
    }
  });

  it("every policy returns a decision for every availability combination", () => {
    const bools = [true, false];
    for (const p of MODEL_POLICY_IDS)
      for (const l of bools) for (const c of bools) for (const m of bools) {
        const r = routeModelCall(p, { local: l, "customer-provider": c, "managed-provider": m });
        expect(typeof r.ok).toBe("boolean");
      }
  });

  it("balanced prefers local, and managed only for steps marked as needing capability", () => {
    const all = { local: true, "customer-provider": false, "managed-provider": true };
    expect(routeModelCall("balanced", all)).toMatchObject({ route: "local" });
    expect(routeModelCall("balanced", all, { stepNeedsCapability: true })).toMatchObject({ route: "managed-provider" });
  });
});

describe("Ollama local route probe", () => {
  it("reports not-configured without a base URL, and parses a reachable server", async () => {
    expect(await probeOllama(undefined)).toMatchObject({ configured: false, reachable: false });
    const fake = (async (u: URL | string) => {
      const p = new URL(String(u)).pathname;
      return new Response(JSON.stringify(p === "/api/version" ? { version: "0.32.5" } : { models: [{ name: "llama3.2:3b", details: { family: "llama", parameter_size: "3.2B" } }] }));
    }) as typeof fetch;
    expect(await probeOllama("http://127.0.0.1:11434", fake)).toMatchObject({ reachable: true, version: "0.32.5", models: [{ name: "llama3.2:3b", family: "llama", parameterSize: "3.2B" }] });
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await probeOllama("http://127.0.0.1:11434", down)).toMatchObject({ configured: true, reachable: false, error: "ECONNREFUSED" });
  });
});
