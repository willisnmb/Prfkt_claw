import { z } from "zod";
import { RuntimeId } from "@/domain/families";
import { ComputeClassId, ModelPolicyId } from "@/domain/registries";
import { CapabilityProfile } from "@/security/taxonomy";

/**
 * Runtime adapter contract (BUILD_INSTRUCTIONS.md §7). The control plane talks
 * to every runtime through this interface and never through runtime-specific
 * code paths. LangGraph/CrewAI/PydanticAI may be workflow or application
 * components inside a cell rather than cells themselves — `kind` says which.
 */

export const CellSpec = z.object({
  tenantId: z.uuid(),
  cellId: z.string().regex(/^cell-[a-z0-9-]{4,60}$/),
  runtime: RuntimeId,
  profile: CapabilityProfile.exclude(["OWNER"]),
  modelPolicy: ModelPolicyId,
  compute: ComputeClassId,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  toolAllowlist: z.array(z.string().min(1).max(80)).max(100),
  /** secret:// references only (validated by SHIELD). */
  secretRefs: z.record(z.string(), z.string()),
  limits: z.object({
    maxToolActionsPerRun: z.number().int().positive(),
    maxModelCostCentsPerDay: z.number().int().min(0),
    maxSendsPerHour: z.number().int().min(0),
  }),
  egressAllowlist: z.array(z.string()).max(100).default([]),
});
export type CellSpec = z.infer<typeof CellSpec>;

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

export interface CostEstimate {
  /** Compute is metered by time, never by model-file size (ARCHITECTURE.md). */
  computeHoursPerMonth: number;
  computeClass: string;
  /** Daily ceiling from the model policy; 0 when the policy cannot incur managed cost. */
  modelCostCeilingCentsPerDay: number;
  mayIncurManagedModelCost: boolean;
  notes: string[];
}

export interface CellHandle {
  tenantId: string;
  cellId: string;
  runtime: string;
  endpointRef: string;
}

/** Observability contract (ARCHITECTURE.md → Observability). */
export interface HealthReport {
  health: "healthy" | "degraded" | "down" | "unknown";
  currentState: "provisioning" | "running" | "suspended" | "destroyed" | "unknown";
  lastSuccessAt: string | null;
  lastError: string | null;
  pendingApprovals: number;
  usage: { toolActionsToday: number; modelCallsToday: number };
  estimatedCostCentsToday: number;
  backupState: { lastBackupAt: string | null; status: "ok" | "stale" | "never" | "unknown" };
  version: string | null;
  runtime: string;
  modelRoute: string | null;
  checkedAt: string;
}

export interface ExportBundle {
  cellId: string;
  tenantId: string;
  exportedAt: string;
  config: Record<string, unknown>;
  memory: { id: string; text: string; provenance: { sourceType: string; sourceRef: string }; supersedes: string | null }[];
  auditTail: { at: string; action: string }[];
}

export interface DestroyReceipt {
  cellId: string;
  destroyedAt: string;
  exportTaken: boolean;
}

export interface RuntimeAdapter {
  readonly id: RuntimeId;
  readonly kind: "tenant-cell" | "workflow-component" | "local-route";
  validate(spec: CellSpec): Promise<ValidationResult>;
  estimate(spec: CellSpec): Promise<CostEstimate>;
  provision(spec: CellSpec, opts: { idempotencyKey: string }): Promise<CellHandle>;
  health(handle: CellHandle): Promise<HealthReport>;
  suspend(handle: CellHandle, opts: { idempotencyKey: string }): Promise<void>;
  resume(handle: CellHandle, opts: { idempotencyKey: string }): Promise<void>;
  export(handle: CellHandle): Promise<ExportBundle>;
  /** Irreversible. Requires the caller to repeat the cell id and to have taken an export. */
  destroy(handle: CellHandle, opts: { idempotencyKey: string; confirmCellId: string; exportTaken: boolean }): Promise<DestroyReceipt>;
}

export class ProvisioningDisabledError extends Error {
  constructor(op: string) {
    super(`${op} is disabled: PROVISIONING_ENABLED is false`);
    this.name = "ProvisioningDisabledError";
  }
}

export class RuntimeAdapterError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RuntimeAdapterError";
  }
}
