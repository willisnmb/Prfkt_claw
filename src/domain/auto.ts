import { z } from "zod";
import type { FamilyId, RuntimeId } from "./families";
import { FAMILIES } from "./families";
import type { ComputeClassId, ModelPolicyId } from "./registries";
import { MODEL_POLICIES } from "./registries";
import type { DeploymentTarget } from "./catalog/schema";
import type { ActionClass, CapabilityProfile } from "@/security/taxonomy";

/**
 * PRFKT AUTO — deterministic architecture / model / compute recommender.
 * Inputs are the AUTO selector questions from RUNTIME_STRATEGY.md.
 * Pure function: same input, same recommendation, with a reason for each choice.
 */

export const AutoInput = z.object({
  persistentConversation: z.boolean(),
  explicitStates: z.boolean(),
  multiAgentBenefit: z.boolean(),
  strictSchema: z.boolean(),
  edgeHardware: z.boolean(),
  privacy: z.enum(["standard", "sensitive", "regulated", "air-gapped"]),
  governance: z.enum(["light", "standard", "strict"]),
  latency: z.enum(["interactive", "near-real-time", "batch"]),
  budget: z.enum(["minimal", "moderate", "flexible"]),
  concurrency: z.enum(["single", "team", "department", "high-volume"]),
  humanApproval: z.enum(["high-impact", "every-external-action", "every-write"]),
});
export type AutoInput = z.infer<typeof AutoInput>;

export const AUTO_DEFAULT_INPUT: AutoInput = {
  persistentConversation: true,
  explicitStates: false,
  multiAgentBenefit: false,
  strictSchema: false,
  edgeHardware: false,
  privacy: "standard",
  governance: "standard",
  latency: "interactive",
  budget: "moderate",
  concurrency: "team",
  humanApproval: "high-impact",
};

export interface Reason {
  /** Which input drove this decision. */
  input: keyof AutoInput | "shield";
  text: string;
}

export interface AutoRecommendation {
  family: FamilyId;
  composition: FamilyId[];
  runtime: RuntimeId;
  modelPolicy: ModelPolicyId;
  compute: ComputeClassId;
  deployment: DeploymentTarget;
  profile: Exclude<CapabilityProfile, "OWNER">;
  approvalRequired: ActionClass[];
  scores: Record<"CLAW" | "FLOW" | "CREW" | "STRICT", number>;
  reasons: Reason[];
  warnings: string[];
}

/** Actions SHIELD always gates, regardless of input (SECURITY.md). */
const ALWAYS_GATED: ActionClass[] = ["SEND_EXTERNAL", "PUBLISH", "SPEND", "DELETE", "DEPLOY", "ADMIN"];

export function recommend(raw: AutoInput): AutoRecommendation {
  const input = AutoInput.parse(raw);
  const reasons: Reason[] = [];
  const warnings: string[] = [];

  // ---- Family scoring. Explicit weights keep the result explainable.
  const scores = { CLAW: 0, FLOW: 0, CREW: 0, STRICT: 0 };
  if (input.persistentConversation) {
    scores.CLAW += 3;
    reasons.push({ input: "persistentConversation", text: "Ongoing conversation and memory favour a persistent assistant." });
  }
  if (input.explicitStates) {
    scores.FLOW += 3;
    reasons.push({ input: "explicitStates", text: "Named states and transitions favour a durable workflow that survives restarts." });
  }
  if (input.multiAgentBenefit) {
    scores.CREW += 3;
    reasons.push({ input: "multiAgentBenefit", text: "Distinct specialist roles favour a multi-agent team." });
  }
  if (input.strictSchema) {
    scores.STRICT += 2;
    reasons.push({ input: "strictSchema", text: "Outputs feed other systems, so every result is schema-validated before use." });
  }
  if (input.latency === "interactive") scores.CLAW += 1;
  if (input.latency === "batch") scores.FLOW += 1;
  if (input.concurrency === "department") scores.CREW += 1;
  if (input.humanApproval !== "high-impact") scores.FLOW += 1;

  const ranked = (Object.keys(scores) as (keyof typeof scores)[])
    // Stable tie-break order: FLOW, CLAW, CREW, STRICT — durable state is the safer default.
    .sort((a, b) => scores[b] - scores[a] || TIE_ORDER.indexOf(a) - TIE_ORDER.indexOf(b));

  let family: FamilyId;
  if (input.edgeHardware) {
    family = "EDGE";
    reasons.push({ input: "edgeHardware", text: "Runs on your own small hardware, so the lightweight local runtime is primary." });
  } else if (scores[ranked[0]!] === 0) {
    family = "CLAW";
    reasons.push({ input: "persistentConversation", text: "No stronger signal; a persistent assistant is the most general starting point." });
  } else {
    family = ranked[0]!;
  }

  const composition = new Set<FamilyId>([family]);
  for (const f of ranked) if (scores[f] >= 2 && f !== family) composition.add(f);

  const secure = input.privacy === "regulated" || input.privacy === "air-gapped" || input.governance === "strict";
  if (secure) {
    composition.add("SECURE");
    reasons.push({
      input: input.privacy === "regulated" || input.privacy === "air-gapped" ? "privacy" : "governance",
      text: "Governed deployment: runs inside your boundary and must pass the SECURE acceptance standard.",
    });
  }
  composition.add("SHIELD");

  // ---- Model policy. Never a silent paid fallback.
  let modelPolicy: ModelPolicyId;
  if (input.privacy === "air-gapped") {
    modelPolicy = "local-only";
    reasons.push({ input: "privacy", text: "Air-gapped: every model call stays local; nothing may leave the boundary." });
  } else if (input.edgeHardware) {
    modelPolicy = input.budget === "flexible" && input.privacy === "standard" ? "local-first" : "local-only";
    reasons.push({ input: "edgeHardware", text: "Edge hardware runs local models first; paid escalation needs explicit approval." });
  } else if (input.privacy === "regulated" || input.privacy === "sensitive") {
    modelPolicy = input.budget === "flexible" && input.privacy === "sensitive" ? "customer-provider" : "local-first";
    reasons.push({
      input: "privacy",
      text:
        modelPolicy === "customer-provider"
          ? "Sensitive data goes only to your own provider account, via a brokered secret reference."
          : "Sensitive or regulated data is processed locally first.",
    });
  } else if (input.budget === "minimal") {
    modelPolicy = "lowest-cost";
    reasons.push({ input: "budget", text: "Minimal budget: the cheapest route that passes validation, local whenever it qualifies." });
  } else if (input.budget === "flexible" && input.latency === "interactive") {
    modelPolicy = "maximum-intelligence";
    reasons.push({ input: "budget", text: "Flexible budget and interactive use: the most capable approved model, within a daily cost ceiling." });
  } else {
    modelPolicy = "balanced";
    reasons.push({ input: "budget", text: "Balanced: local for routine steps, managed provider where you mark it necessary." });
  }

  // ---- Deployment.
  let deployment: DeploymentTarget;
  if (input.edgeHardware) deployment = "edge-device";
  else if (input.privacy === "air-gapped") deployment = "on-prem";
  else if (secure) deployment = "private-cloud";
  else deployment = "managed-cell";

  // ---- Compute. Local routes need local capacity sized to concurrency.
  let compute: ComputeClassId;
  const localHeavy = !MODEL_POLICIES[modelPolicy].mayIncurManagedCost && modelPolicy !== "customer-provider";
  if (input.edgeHardware) {
    compute = "customer-hardware";
  } else if (localHeavy) {
    compute =
      input.concurrency === "high-volume"
        ? "gpu-80-96gb"
        : input.concurrency === "department"
          ? "gpu-48gb"
          : "unified-memory-node";
    reasons.push({ input: "concurrency", text: "Local models need local capacity sized to how many people use the system at once." });
  } else if (modelPolicy === "lowest-cost" && input.concurrency === "high-volume") {
    compute = "gpu-24gb";
    reasons.push({ input: "concurrency", text: "High volume on a low budget: a small GPU serves routine steps locally." });
  } else {
    compute = "cpu";
    reasons.push({ input: "concurrency", text: "Models are served by the provider; orchestration only needs CPU." });
  }

  // ---- Capability profile. SAFE unless governance is explicitly light.
  const profile: "SAFE" | "OPERATOR" =
    input.governance === "light" && !secure && (family === "CLAW" || family === "CREW" || family === "FLOW") ? "OPERATOR" : "SAFE";
  reasons.push({
    input: "governance",
    text:
      profile === "OPERATOR"
        ? "Light governance: an isolated workspace with limited autonomous actions; high-impact actions still need approval."
        : "SAFE profile: no shell, no secret access, external actions draft-only or approval-gated.",
  });

  // ---- Approvals. SHIELD invariants cannot be weakened by input.
  const approvalRequired = new Set<ActionClass>(ALWAYS_GATED);
  if (input.humanApproval === "every-write") approvalRequired.add("WRITE_INTERNAL");
  reasons.push({ input: "shield", text: "Sending, publishing, spending, deleting and deploying always require approval." });

  // ---- Consistency warnings.
  if (input.privacy === "air-gapped" && input.budget === "flexible" && input.latency === "interactive") {
    warnings.push("Air-gapped deployments cannot use hosted frontier models; capability is bounded by local hardware.");
  }
  if (input.edgeHardware && input.multiAgentBenefit) {
    warnings.push("Multi-agent teams on small edge hardware are constrained; consider a hybrid with a managed cell.");
  }
  if (input.concurrency === "high-volume" && modelPolicy === "local-only" && !input.edgeHardware) {
    warnings.push("High-volume local-only serving needs capacity planning before a quote.");
  }

  const runtime = input.edgeHardware ? "zeroclaw" : FAMILIES[family].primaryRuntime;

  return {
    family,
    composition: [...composition],
    runtime,
    modelPolicy,
    compute,
    deployment,
    profile,
    approvalRequired: [...approvalRequired],
    scores,
    reasons,
    warnings,
  };
}

const TIE_ORDER = ["FLOW", "CLAW", "CREW", "STRICT"] as const;
