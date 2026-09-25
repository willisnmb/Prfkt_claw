import { z } from "zod";
import type { RuntimeId } from "./families";

/* ---------------------------------------------------------------- Models */

/** Model policies from ARCHITECTURE.md. No silent paid fallback. */
export const MODEL_POLICY_IDS = [
  "local-only",
  "local-first",
  "customer-provider",
  "managed-provider",
  "balanced",
  "maximum-intelligence",
  "lowest-cost",
] as const;
export const ModelPolicyId = z.enum(MODEL_POLICY_IDS);
export type ModelPolicyId = z.infer<typeof ModelPolicyId>;

export type ModelRouteKind = "local" | "customer-provider" | "managed-provider";

export interface ModelPolicy {
  id: ModelPolicyId;
  label: string;
  description: string;
  /** Ordered routes the router may try. */
  routes: ModelRouteKind[];
  /** Whether any route in this policy can incur PRFKT-billed usage. */
  mayIncurManagedCost: boolean;
}

export const MODEL_POLICIES: Record<ModelPolicyId, ModelPolicy> = {
  "local-only": {
    id: "local-only",
    label: "Local only",
    description: "Every call runs on local models. If the local route is down the call fails; nothing leaves your boundary.",
    routes: ["local"],
    mayIncurManagedCost: false,
  },
  "local-first": {
    id: "local-first",
    label: "Local first",
    description: "Local models by default. Escalation to a paid route requires an explicit, recorded approval — never a silent fallback.",
    routes: ["local"],
    mayIncurManagedCost: false,
  },
  "customer-provider": {
    id: "customer-provider",
    label: "Your provider account",
    description: "Calls go to your own model provider account via a brokered secret reference. PRFKT never holds the key in prompts or memory.",
    routes: ["customer-provider"],
    mayIncurManagedCost: false,
  },
  "managed-provider": {
    id: "managed-provider",
    label: "Managed provider",
    description: "PRFKT-managed provider access, metered against your daily model-cost ceiling.",
    routes: ["managed-provider"],
    mayIncurManagedCost: true,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "Local for routine steps, managed provider for steps you have marked as needing more capability.",
    routes: ["local", "managed-provider"],
    mayIncurManagedCost: true,
  },
  "maximum-intelligence": {
    id: "maximum-intelligence",
    label: "Maximum intelligence",
    description: "The most capable approved model for every step, within your cost ceiling.",
    routes: ["managed-provider"],
    mayIncurManagedCost: true,
  },
  "lowest-cost": {
    id: "lowest-cost",
    label: "Lowest cost",
    description: "The cheapest route that passes the step's validation contract; local whenever it qualifies.",
    routes: ["local", "managed-provider"],
    mayIncurManagedCost: true,
  },
};

/* --------------------------------------------------------------- Compute */

export const COMPUTE_CLASS_IDS = [
  "cpu",
  "customer-hardware",
  "unified-memory-node",
  "gpu-24gb",
  "gpu-48gb",
  "gpu-80-96gb",
  "gpu-128gb-plus",
  "gpu-141gb-plus",
] as const;
export const ComputeClassId = z.enum(COMPUTE_CLASS_IDS);
export type ComputeClassId = z.infer<typeof ComputeClassId>;

export interface ComputeClass {
  id: ComputeClassId;
  label: string;
  description: string;
  /** Approximate accelerator memory available to models, in GB. null = varies. */
  memoryGb: number | null;
  /** Cloud burst is metered by compute-time, never by model-file size. */
  metering: "none" | "compute-hours";
}

export const COMPUTE_CLASSES: Record<ComputeClassId, ComputeClass> = {
  cpu: { id: "cpu", label: "CPU", description: "Orchestration, small models and deterministic tools.", memoryGb: null, metering: "compute-hours" },
  "customer-hardware": { id: "customer-hardware", label: "Customer hardware", description: "Your own machines; PRFKT does not meter them.", memoryGb: null, metering: "none" },
  "unified-memory-node": { id: "unified-memory-node", label: "Local Halo / unified-memory node", description: "Desk-side unified-memory node for private local inference.", memoryGb: 128, metering: "none" },
  "gpu-24gb": { id: "gpu-24gb", label: "24 GB class", description: "Small and quantised mid-size models.", memoryGb: 24, metering: "compute-hours" },
  "gpu-48gb": { id: "gpu-48gb", label: "48 GB class", description: "Mid-size models with room for longer context.", memoryGb: 48, metering: "compute-hours" },
  "gpu-80-96gb": { id: "gpu-80-96gb", label: "80–96 GB class", description: "Large models at useful precision.", memoryGb: 80, metering: "compute-hours" },
  "gpu-128gb-plus": { id: "gpu-128gb-plus", label: "128+ GB class", description: "Very large models or several models resident.", memoryGb: 128, metering: "compute-hours" },
  "gpu-141gb-plus": { id: "gpu-141gb-plus", label: "141+ GB class", description: "Frontier-scale open models and heavy multi-model serving.", memoryGb: 141, metering: "compute-hours" },
};

/* -------------------------------------------------------------- Runtimes */

export const RUNTIME_STATUS = ["connected", "embedded", "not-configured", "candidate", "disabled"] as const;
export type RuntimeStatus = (typeof RUNTIME_STATUS)[number];

export interface RuntimeDefinition {
  id: RuntimeId;
  label: string;
  role: string;
  /** Default status before any adapter is configured. Honest by default. */
  defaultStatus: RuntimeStatus;
  isolation: "per-customer-cell" | "control-plane" | "customer-device";
}

export const RUNTIMES: Record<RuntimeId, RuntimeDefinition> = {
  openclaw: { id: "openclaw", label: "OpenClaw", role: "Primary persistent assistant runtime (CLAW, SECURE).", defaultStatus: "not-configured", isolation: "per-customer-cell" },
  langgraph: { id: "langgraph", label: "LangGraph", role: "Durable workflow runtime (FLOW). FLOW 01 runs embedded (LangGraph.js) in the control-plane worker; per-customer cells are not yet provisioned.", defaultStatus: "embedded", isolation: "per-customer-cell" },
  crewai: { id: "crewai", label: "CrewAI", role: "Multi-agent team runtime (CREW).", defaultStatus: "not-configured", isolation: "per-customer-cell" },
  pydanticai: { id: "pydanticai", label: "PydanticAI", role: "Typed/validated app runtime (STRICT).", defaultStatus: "not-configured", isolation: "per-customer-cell" },
  zeroclaw: { id: "zeroclaw", label: "ZeroClaw", role: "Lightweight/local agent runtime candidate (EDGE). No upstream performance claims until PRFKT reproduces them.", defaultStatus: "candidate", isolation: "customer-device" },
  nemoclaw: { id: "nemoclaw", label: "NemoClaw", role: "Enterprise runtime candidate inside SECURE. SECURE itself is a runtime-independent acceptance standard.", defaultStatus: "candidate", isolation: "per-customer-cell" },
  ollama: { id: "ollama", label: "Ollama", role: "First-class local model route.", defaultStatus: "not-configured", isolation: "customer-device" },
  "control-plane": { id: "control-plane", label: "PRFKT control plane", role: "AUTO recommendations and SHIELD policy services.", defaultStatus: "connected", isolation: "control-plane" },
};

/**
 * Tools that inform the build but are deliberately NOT customer runtimes
 * (RUNTIME_STRATEGY.md). Listed so the admin registry shows the decision.
 */
export const NON_RUNTIME_REFERENCES = [
  { id: "trustclaw", label: "TrustClaw (ComposioHQ)", role: "Architectural reference for OAuth integrations, sandboxed execution, memory, schedules and action logs. No hard dependency." },
  { id: "opencode", label: "OpenCode", role: "Development worker/harness only. Never customer-facing intelligence." },
] as const;
