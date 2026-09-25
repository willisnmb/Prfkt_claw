import { createHash } from "node:crypto";
import { z } from "zod";
import { ActionClass, CapabilityProfile, HIGH_IMPACT_ACTIONS } from "./taxonomy";
import { PROFILE_CAPABILITIES, assertCustomerProfile } from "./profiles";
import { BlastRadiusLimits, recipientAllowed, hostAllowed } from "./blast-radius";

/**
 * Action firewall (SECURITY.md). Every workflow declares an explicit rule per
 * action class it uses; anything without a rule is denied. Consequential
 * actions are deny, draft-only, allow-once, approval-gated or explicitly
 * scoped autonomous (HANDOFF.md non-negotiable 4) — never plain "allow".
 */

export const ActionRule = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("allow") }),
  z.object({ mode: z.literal("deny") }),
  z.object({ mode: z.literal("draft-only") }),
  z.object({ mode: z.literal("approval") }),
  z.object({ mode: z.literal("allow-once") }),
  z.object({
    mode: z.literal("scoped-autonomous"),
    scope: z.object({
      recipients: z.array(z.string()).default([]),
      domains: z.array(z.string()).default([]),
      maxAmountCents: z.number().int().min(0).default(0),
    }),
  }),
]);
export type ActionRule = z.infer<typeof ActionRule>;

export const WorkflowPolicy = z
  .object({
    id: z.string().min(1),
    profile: CapabilityProfile,
    rules: z.partialRecord(ActionClass, ActionRule),
    limits: BlastRadiusLimits,
  })
  .superRefine((p, ctx) => {
    if (p.profile === "OWNER") ctx.addIssue({ code: "custom", message: "workflow policies cannot run as OWNER" });
    for (const [action, rule] of Object.entries(p.rules)) {
      if (!rule) continue;
      if (HIGH_IMPACT_ACTIONS.includes(action as ActionClass) && rule.mode === "allow")
        ctx.addIssue({ code: "custom", path: ["rules", action], message: `${action} cannot be 'allow'` });
      // SAFE: external actions are draft-only or approval-gated (SECURITY.md).
      if (p.profile === "SAFE" && HIGH_IMPACT_ACTIONS.includes(action as ActionClass) && rule.mode === "scoped-autonomous")
        ctx.addIssue({ code: "custom", path: ["rules", action], message: `SAFE profile cannot run ${action} autonomously` });
      if (action === "ADMIN" && rule.mode !== "deny")
        ctx.addIssue({ code: "custom", path: ["rules", action], message: "ADMIN must be 'deny' in customer workflows" });
    }
  });
export type WorkflowPolicy = z.infer<typeof WorkflowPolicy>;

export interface ActionRequest {
  action: ActionClass;
  /** Canonical hash of exactly what will happen. Approvals bind to it. */
  payloadHash: string;
  target?: { recipients?: string[]; domain?: string; amountCents?: number };
  /** True when any parameter was derived from untrusted content. */
  tainted: boolean;
}

export interface ApprovalRecord {
  id: string;
  action: ActionClass;
  payloadHash: string;
  decision: "approved" | "rejected";
  expiresAt?: Date;
  consumed?: boolean;
}

export type FirewallDecision =
  | { outcome: "execute"; reason: string; approvalId?: string }
  | { outcome: "draft"; reason: string }
  | { outcome: "needs_approval"; reason: string }
  | { outcome: "deny"; reason: string };

/** Stable hash of a JSON-serialisable payload (sorted keys). */
export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
}

function approvalMatches(a: ApprovalRecord | undefined, req: ActionRequest, now: Date): a is ApprovalRecord {
  return !!a && a.action === req.action && a.payloadHash === req.payloadHash && (!a.expiresAt || a.expiresAt > now);
}

export function evaluateAction(
  policyInput: WorkflowPolicy,
  req: ActionRequest,
  ctx: { approval?: ApprovalRecord; now?: Date } = {},
): FirewallDecision {
  const policy = WorkflowPolicy.parse(policyInput);
  assertCustomerProfile(policy.profile);
  const now = ctx.now ?? new Date();
  const rule = policy.rules[req.action];

  if (!rule) return { outcome: "deny", reason: `no explicit rule for ${req.action} in workflow ${policy.id}` };
  if (req.action === "ADMIN") return { outcome: "deny", reason: "ADMIN actions are never available to customer workflows" };

  const approved = approvalMatches(ctx.approval, req, now) ? ctx.approval : undefined;
  if (approved?.decision === "rejected") return { outcome: "deny", reason: `rejected by approval ${approved.id}` };

  switch (rule.mode) {
    case "deny":
      return { outcome: "deny", reason: `${req.action} denied by workflow rule` };
    case "draft-only":
      return { outcome: "draft", reason: `${req.action} is draft-only in this workflow` };
    case "allow": {
      // Profile ceiling: an 'allow' rule cannot exceed what the profile permits autonomously.
      if (PROFILE_CAPABILITIES[policy.profile].autonomousActions.includes(req.action))
        return { outcome: "execute", reason: `${req.action} allowed for ${policy.profile}` };
      return approved
        ? { outcome: "execute", reason: "approved", approvalId: approved.id }
        : { outcome: "needs_approval", reason: `${policy.profile} requires approval for ${req.action}` };
    }
    case "approval":
      return approved
        ? { outcome: "execute", reason: "approved", approvalId: approved.id }
        : { outcome: "needs_approval", reason: `${req.action} requires approval bound to this exact payload` };
    case "allow-once":
      if (approved && !approved.consumed) return { outcome: "execute", reason: "single-use grant", approvalId: approved.id };
      return { outcome: "needs_approval", reason: approved?.consumed ? "single-use grant already consumed" : "requires a single-use grant" };
    case "scoped-autonomous": {
      if (req.tainted && !approved)
        return { outcome: "needs_approval", reason: "parameters derived from untrusted content cannot run autonomously" };
      const t = req.target ?? {};
      const inScope =
        (t.recipients ?? []).every((r) => recipientAllowed(r, rule.scope.recipients)) &&
        (t.domain === undefined || hostAllowed(t.domain, rule.scope.domains)) &&
        (t.amountCents ?? 0) <= rule.scope.maxAmountCents;
      if (inScope) return { outcome: "execute", reason: "within explicit autonomous scope" };
      return approved
        ? { outcome: "execute", reason: "approved outside scope", approvalId: approved.id }
        : { outcome: "needs_approval", reason: "outside the explicit autonomous scope" };
    }
  }
}
