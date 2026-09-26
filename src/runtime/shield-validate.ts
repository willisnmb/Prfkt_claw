import { MODEL_POLICIES, COMPUTE_CLASSES } from "@/domain/registries";
import { assertNoSecretValues, parseSecretRef } from "@/security/secret-refs";
import { assertCustomerProfile } from "@/security/profiles";
import { CellSpec, type CostEstimate, type ValidationResult } from "./adapter";

/**
 * Runtime-independent validation every adapter runs before its own checks.
 * This is the part of the SECURE acceptance standard that can be checked
 * statically: tenant-bound secrets, customer profile, finite limits,
 * explicit egress, and a model policy compatible with the compute class.
 */
export function shieldValidate(raw: unknown): ValidationResult {
  const parsed = CellSpec.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const spec = parsed.data;
  const problems: string[] = [];
  try {
    assertCustomerProfile(spec.profile);
  } catch (e) {
    problems.push((e as Error).message);
  }
  try {
    assertNoSecretValues(spec, spec.tenantId);
  } catch (e) {
    problems.push((e as Error).message);
  }
  for (const [name, ref] of Object.entries(spec.secretRefs)) {
    try {
      if (parseSecretRef(ref).tenantId !== spec.tenantId) problems.push(`secretRefs.${name}: belongs to another tenant`);
    } catch {
      problems.push(`secretRefs.${name}: not a secret reference`);
    }
  }
  if (spec.egressAllowlist.some((h) => h === "*" || h === "*.*")) problems.push("egressAllowlist: wildcard-all is not allowed");
  if (spec.modelPolicy === "local-only" && spec.compute === "cpu") {
    problems.push("local-only model policy needs local model capacity; CPU class cannot serve it");
  }
  if (spec.profile === "SAFE" && spec.toolAllowlist.some((t) => /^(shell|exec|gateway\.|admin\.)/.test(t))) {
    problems.push("SAFE profile cannot allowlist shell, exec, gateway or admin tools");
  }
  return { ok: problems.length === 0, problems };
}

const HOURS_PER_MONTH = 730;

export function estimateCell(spec: CellSpec, dutyCycle = 1): CostEstimate {
  const compute = COMPUTE_CLASSES[spec.compute];
  const policy = MODEL_POLICIES[spec.modelPolicy];
  const notes: string[] = [];
  if (compute.metering === "none") notes.push(`${compute.label} is not metered by PRFKT.`);
  if (!policy.mayIncurManagedCost) notes.push(`${policy.label}: no PRFKT-billed model usage; paid escalation needs explicit approval.`);
  return {
    computeHoursPerMonth: compute.metering === "compute-hours" ? Math.round(HOURS_PER_MONTH * dutyCycle) : 0,
    computeClass: compute.label,
    modelCostCeilingCentsPerDay: policy.mayIncurManagedCost ? spec.limits.maxModelCostCentsPerDay : 0,
    mayIncurManagedModelCost: policy.mayIncurManagedCost,
    notes,
  };
}
