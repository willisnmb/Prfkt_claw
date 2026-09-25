import { MODEL_POLICIES, type ModelPolicyId, type ModelRouteKind } from "@/domain/registries";

/**
 * Model router (ARCHITECTURE.md → Model policies). Picks the first available
 * route the policy allows. It never falls back to a paid route the policy did
 * not list, and for local-first a paid escalation is returned as a request for
 * explicit approval — never taken silently.
 */
export interface RouteAvailability {
  local: boolean;
  "customer-provider": boolean;
  "managed-provider": boolean;
}

export type RouteDecision =
  | { ok: true; route: ModelRouteKind; paid: boolean; reason: string }
  | { ok: false; reason: string; escalation?: { route: "managed-provider"; requiresApproval: true } };

export function routeModelCall(
  policyId: ModelPolicyId,
  available: RouteAvailability,
  opts: { escalationApproved?: boolean; stepNeedsCapability?: boolean } = {},
): RouteDecision {
  const policy = MODEL_POLICIES[policyId];
  const order = policyId === "balanced" && opts.stepNeedsCapability ? ["managed-provider" as const, "local" as const] : policy.routes;
  for (const route of order) {
    if (available[route]) return { ok: true, route, paid: route === "managed-provider", reason: `${policy.label}: ${route}` };
  }
  if (policyId === "local-first") {
    if (opts.escalationApproved && available["managed-provider"]) {
      return { ok: true, route: "managed-provider", paid: true, reason: "local unavailable; paid escalation explicitly approved" };
    }
    return { ok: false, reason: "local route unavailable", escalation: { route: "managed-provider", requiresApproval: true } };
  }
  return { ok: false, reason: `no route allowed by ${policy.label} is available` };
}
