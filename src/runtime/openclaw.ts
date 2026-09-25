import { z } from "zod";
import {
  ProvisioningDisabledError,
  RuntimeAdapterError,
  type CellHandle,
  type CellSpec,
  type DestroyReceipt,
  type ExportBundle,
  type HealthReport,
  type RuntimeAdapter,
} from "./adapter";
import { estimateCell, shieldValidate } from "./shield-validate";
import { findSecrets } from "@/security/secrets";

/**
 * OpenClaw tenant-cell adapter. It speaks the PRFKT cell-controller contract
 * (docs/runtime/CELL_CONTROLLER.md): one controller deployment manages one
 * isolated OpenClaw cell per customer trust domain — never a shared gateway
 * for unrelated customers. The controller implementation against a real
 * OpenClaw deployment is an owner-side dependency; this adapter is validated
 * against the contract with a fake controller (tests/runtime).
 */

export interface OpenClawAdapterConfig {
  controllerUrl: string;
  /** Resolved at call time through the secret broker; never stored. */
  getControllerToken: () => Promise<string>;
  provisioningEnabled: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
}

const CellStatus = z.object({
  cellId: z.string(),
  tenantId: z.uuid(),
  state: z.enum(["provisioning", "running", "suspended", "destroyed"]),
  version: z.string().nullable(),
  endpointRef: z.string(),
});

const Health = z.object({
  healthy: z.boolean(),
  state: z.enum(["provisioning", "running", "suspended", "destroyed"]),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  pendingApprovals: z.number().int().min(0),
  toolActionsToday: z.number().int().min(0),
  modelCallsToday: z.number().int().min(0),
  estimatedCostCentsToday: z.number().int().min(0),
  lastBackupAt: z.string().nullable(),
  version: z.string().nullable(),
  modelRoute: z.string().nullable(),
});

const Export = z.object({
  config: z.record(z.string(), z.unknown()),
  memory: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      provenance: z.object({ sourceType: z.string(), sourceRef: z.string() }),
      supersedes: z.string().nullable(),
    }),
  ),
  auditTail: z.array(z.object({ at: z.string(), action: z.string() })),
});

export class OpenClawAdapter implements RuntimeAdapter {
  readonly id = "openclaw" as const;
  readonly kind = "tenant-cell" as const;

  constructor(private readonly cfg: OpenClawAdapterConfig) {
    const u = new URL(cfg.controllerUrl);
    if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) {
      throw new Error("cell controller must use https");
    }
  }

  async validate(spec: CellSpec) {
    const base = shieldValidate(spec);
    if (spec.runtime !== "openclaw") base.problems.push("spec.runtime must be openclaw for this adapter");
    return { ok: base.problems.length === 0, problems: base.problems };
  }

  async estimate(spec: CellSpec) {
    return estimateCell(spec);
  }

  async provision(spec: CellSpec, { idempotencyKey }: { idempotencyKey: string }): Promise<CellHandle> {
    this.requireEnabled("provision");
    const v = await this.validate(spec);
    if (!v.ok) throw new RuntimeAdapterError(`cell spec rejected: ${v.problems.join("; ")}`, false);
    const res = CellStatus.parse(await this.call("POST", "/v1/cells", idempotencyKey, spec));
    if (res.tenantId !== spec.tenantId || res.cellId !== spec.cellId) throw new RuntimeAdapterError("controller returned a different cell", false);
    return { tenantId: res.tenantId, cellId: res.cellId, runtime: this.id, endpointRef: res.endpointRef };
  }

  async health(h: CellHandle): Promise<HealthReport> {
    const checkedAt = new Date().toISOString();
    try {
      const r = Health.parse(await this.call("GET", `/v1/cells/${h.cellId}/health`, undefined, undefined, h.tenantId));
      const backupAgeH = r.lastBackupAt ? (Date.now() - Date.parse(r.lastBackupAt)) / 3.6e6 : null;
      return {
        health: r.healthy ? "healthy" : "degraded",
        currentState: r.state,
        lastSuccessAt: r.lastSuccessAt,
        lastError: r.lastError,
        pendingApprovals: r.pendingApprovals,
        usage: { toolActionsToday: r.toolActionsToday, modelCallsToday: r.modelCallsToday },
        estimatedCostCentsToday: r.estimatedCostCentsToday,
        backupState: { lastBackupAt: r.lastBackupAt, status: backupAgeH === null ? "never" : backupAgeH > 26 ? "stale" : "ok" },
        version: r.version,
        runtime: this.id,
        modelRoute: r.modelRoute,
        checkedAt,
      };
    } catch (e) {
      return {
        health: "down",
        currentState: "unknown",
        lastSuccessAt: null,
        lastError: e instanceof Error ? e.message : String(e),
        pendingApprovals: 0,
        usage: { toolActionsToday: 0, modelCallsToday: 0 },
        estimatedCostCentsToday: 0,
        backupState: { lastBackupAt: null, status: "unknown" },
        version: null,
        runtime: this.id,
        modelRoute: null,
        checkedAt,
      };
    }
  }

  async suspend(h: CellHandle, { idempotencyKey }: { idempotencyKey: string }) {
    this.requireEnabled("suspend");
    await this.call("POST", `/v1/cells/${h.cellId}/suspend`, idempotencyKey, {}, h.tenantId);
  }

  async resume(h: CellHandle, { idempotencyKey }: { idempotencyKey: string }) {
    this.requireEnabled("resume");
    await this.call("POST", `/v1/cells/${h.cellId}/resume`, idempotencyKey, {}, h.tenantId);
  }

  async export(h: CellHandle): Promise<ExportBundle> {
    const r = Export.parse(await this.call("GET", `/v1/cells/${h.cellId}/export`, undefined, undefined, h.tenantId));
    const text = JSON.stringify(r);
    if (findSecrets(text).length) throw new RuntimeAdapterError("export contained secret material; refusing to hand it out", false);
    return { cellId: h.cellId, tenantId: h.tenantId, exportedAt: new Date().toISOString(), ...r };
  }

  async destroy(h: CellHandle, o: { idempotencyKey: string; confirmCellId: string; exportTaken: boolean }): Promise<DestroyReceipt> {
    this.requireEnabled("destroy");
    if (o.confirmCellId !== h.cellId) throw new RuntimeAdapterError("destroy confirmation does not match the cell id", false);
    if (!o.exportTaken) throw new RuntimeAdapterError("take a customer export before destroying a cell", false);
    await this.call("DELETE", `/v1/cells/${h.cellId}`, o.idempotencyKey, undefined, h.tenantId);
    return { cellId: h.cellId, destroyedAt: new Date().toISOString(), exportTaken: true };
  }

  /* ------------------------------------------------------------------ */

  private requireEnabled(op: string) {
    if (!this.cfg.provisioningEnabled) throw new ProvisioningDisabledError(op);
  }

  private async call(method: string, path: string, idempotencyKey?: string, body?: unknown, tenantId?: string): Promise<unknown> {
    const f = this.cfg.fetchImpl ?? fetch;
    const attempts = this.cfg.maxAttempts ?? 3;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await f(new URL(path, this.cfg.controllerUrl), {
          method,
          headers: {
            authorization: `Bearer ${await this.cfg.getControllerToken()}`,
            "content-type": "application/json",
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
            ...(tenantId ? { "x-prfkt-tenant": tenantId } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
        });
        if (res.status >= 500 || res.status === 429) {
          last = new RuntimeAdapterError(`controller ${method} ${path} → ${res.status}`, true);
          continue;
        }
        if (!res.ok) throw new RuntimeAdapterError(`controller ${method} ${path} → ${res.status}`, false);
        return res.status === 204 ? {} : await res.json();
      } catch (e) {
        if (e instanceof RuntimeAdapterError && !e.retryable) throw e;
        last = e;
      }
    }
    throw last instanceof RuntimeAdapterError ? last : new RuntimeAdapterError(`controller unreachable: ${String(last)}`, true);
  }
}
