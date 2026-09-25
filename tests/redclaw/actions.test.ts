import { describe, expect } from "vitest";
import { redclaw } from "./redclaw";
import { evaluateAction, payloadHash, WorkflowPolicy, type ApprovalRecord } from "@/security/firewall";
import { RunBudget, BudgetExceeded, SAFE_DEFAULT_LIMITS, checkBlastRadius, ZERO_USAGE } from "@/security/blast-radius";
import { signWebhook, verifyWebhook } from "@/security/webhooks";

const policy: WorkflowPolicy = {
  id: "flow01",
  profile: "SAFE",
  rules: {
    READ: { mode: "allow" },
    DRAFT: { mode: "allow" },
    WRITE_INTERNAL: { mode: "allow" },
    SEND_EXTERNAL: { mode: "approval" },
    SPEND: { mode: "approval" },
    DEPLOY: { mode: "approval" },
    DELETE: { mode: "deny" },
    PUBLISH: { mode: "draft-only" },
    ADMIN: { mode: "deny" },
  },
  limits: { ...SAFE_DEFAULT_LIMITS, allowedRecipients: ["@customer.test"] },
};

const send = { action: "SEND_EXTERNAL" as const, payloadHash: payloadHash({ to: "cfo@customer.test", body: "v1" }), tainted: false };
const approve = (over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({ id: "ap-1", action: "SEND_EXTERNAL", payloadHash: send.payloadHash, decision: "approved", ...over });

describe("unauthorized consequential actions", () => {
  redclaw("unauthorized_send", "send without approval is held, with approval executes", () => {
    expect(evaluateAction(policy, send).outcome).toBe("needs_approval");
    expect(evaluateAction(policy, send, { approval: approve() })).toMatchObject({ outcome: "execute", approvalId: "ap-1" });
  });

  redclaw("unauthorized_send", "approval for a different payload, action, or an expired/rejected approval does not authorise", () => {
    expect(evaluateAction(policy, send, { approval: approve({ payloadHash: payloadHash({ to: "cfo@customer.test", body: "v2" }) }) }).outcome).toBe("needs_approval");
    expect(evaluateAction(policy, send, { approval: approve({ action: "SPEND" }) }).outcome).toBe("needs_approval");
    expect(evaluateAction(policy, send, { approval: approve({ expiresAt: new Date(Date.now() - 1000) }) }).outcome).toBe("needs_approval");
    expect(evaluateAction(policy, send, { approval: approve({ decision: "rejected" }) }).outcome).toBe("deny");
  });

  redclaw("unauthorized_spend", "spend needs approval and is capped by the daily ceiling", () => {
    const spend = { action: "SPEND" as const, payloadHash: payloadHash({ amount: 5000 }), tainted: false, target: { amountCents: 5000 } };
    expect(evaluateAction(policy, spend).outcome).toBe("needs_approval");
    expect(checkBlastRadius(policy.limits, ZERO_USAGE, { spendCents: 5000 })).toMatchObject({ ok: false, limit: "maxSpendCentsPerDay" });
  });

  redclaw("unauthorized_spend", "SAFE policies cannot declare autonomous spending", () => {
    const bad = { ...policy, rules: { ...policy.rules, SPEND: { mode: "scoped-autonomous", scope: { recipients: [], domains: [], maxAmountCents: 100 } } } };
    expect(WorkflowPolicy.safeParse(bad).success).toBe(false);
    const allow = { ...policy, rules: { ...policy.rules, SPEND: { mode: "allow" } } };
    expect(WorkflowPolicy.safeParse(allow).success).toBe(false);
  });

  redclaw("unauthorized_delete", "delete is denied by rule and by a zero delete ceiling", () => {
    expect(evaluateAction(policy, { action: "DELETE", payloadHash: "x", tainted: false }).outcome).toBe("deny");
    expect(checkBlastRadius(policy.limits, ZERO_USAGE, { deletes: 1 })).toMatchObject({ ok: false, limit: "maxDeletesPerRun" });
  });

  redclaw("unauthorized_delete", "an action class without an explicit rule is denied", () => {
    const { DELETE: _d, ...rules } = policy.rules;
    expect(evaluateAction({ ...policy, rules }, { action: "DELETE", payloadHash: "x", tainted: false })).toMatchObject({ outcome: "deny", reason: /no explicit rule/ });
  });

  redclaw("unauthorized_deploy", "deploy requires approval bound to the exact deployment", () => {
    const dep = { action: "DEPLOY" as const, payloadHash: payloadHash({ cell: "c1", version: "1.0.0" }), tainted: false };
    expect(evaluateAction(policy, dep).outcome).toBe("needs_approval");
    expect(evaluateAction(policy, { ...dep, payloadHash: payloadHash({ cell: "c1", version: "1.0.1" }) }, { approval: { id: "a", action: "DEPLOY", payloadHash: dep.payloadHash, decision: "approved" } }).outcome).toBe("needs_approval");
  });

  redclaw("unauthorized_deploy", "ADMIN is never executable and cannot be configured otherwise", () => {
    expect(evaluateAction(policy, { action: "ADMIN", payloadHash: "x", tainted: false }).outcome).toBe("deny");
    expect(WorkflowPolicy.safeParse({ ...policy, rules: { ...policy.rules, ADMIN: { mode: "approval" } } }).success).toBe(false);
    expect(WorkflowPolicy.safeParse({ ...policy, profile: "OWNER" }).success).toBe(false);
  });

  redclaw("unauthorized_send", "publishing is draft-only in this workflow", () => {
    expect(evaluateAction(policy, { action: "PUBLISH", payloadHash: "x", tainted: false }).outcome).toBe("draft");
  });

  redclaw("unauthorized_send", "recipients outside the allowlist exceed blast radius even when approved", () => {
    expect(checkBlastRadius(policy.limits, ZERO_USAGE, { sends: 1, recipients: ["attacker@evil.test"] })).toMatchObject({ ok: false, limit: "allowedRecipients" });
    expect(checkBlastRadius(policy.limits, ZERO_USAGE, { sends: 1, recipients: ["cfo@customer.test"] })).toEqual({ ok: true });
  });
});

describe("runaway loops and cost", () => {
  redclaw("runaway_loop_cost", "a looping agent is stopped at the tool-action ceiling", () => {
    const budget = new RunBudget({ ...SAFE_DEFAULT_LIMITS, maxToolActionsPerRun: 25 });
    let ran = 0;
    expect(() => {
      for (;;) {
        budget.charge({ toolActions: 1 });
        ran++;
      }
    }).toThrow(BudgetExceeded);
    expect(ran).toBe(25);
  });

  redclaw("runaway_loop_cost", "model cost stops at the daily ceiling, including prior usage", () => {
    const budget = new RunBudget({ ...SAFE_DEFAULT_LIMITS, maxModelCostCentsPerDay: 100 }, { modelCostCentsToday: 90 });
    budget.charge({ modelCostCents: 10 });
    expect(() => budget.charge({ modelCostCents: 1 })).toThrow(/model cost/);
  });

  redclaw("runaway_loop_cost", "send rate is capped per hour", () => {
    const budget = new RunBudget({ ...SAFE_DEFAULT_LIMITS, maxSendsPerHour: 2, allowedRecipients: ["@c.test"], maxRecipientsPerRun: 10 });
    budget.charge({ sends: 1, recipients: ["a@c.test"] });
    budget.charge({ sends: 1, recipients: ["b@c.test"] });
    expect(() => budget.charge({ sends: 1, recipients: ["c@c.test"] })).toThrow(/sends/);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test_only_value_for_signing";
  const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded" });
  const now = 1_800_000_000;

  redclaw("duplicate_webhook", "replayed deliveries outside the tolerance window are rejected", () => {
    const sig = signWebhook(secret, body, now - 3600);
    expect(verifyWebhook(secret, body, sig, now)).toMatchObject({ ok: false, reason: /tolerance/ });
  });

  redclaw("duplicate_webhook", "forged, tampered, or unsigned deliveries are rejected", () => {
    const sig = signWebhook(secret, body, now);
    expect(verifyWebhook(secret, body, sig, now).ok).toBe(true);
    expect(verifyWebhook(secret, body.replace("succeeded", "refunded"), sig, now).ok).toBe(false);
    expect(verifyWebhook("other-secret", body, sig, now).ok).toBe(false);
    expect(verifyWebhook(secret, body, null, now).ok).toBe(false);
    expect(verifyWebhook(undefined, body, sig, now)).toMatchObject({ ok: false, reason: /not configured/ });
  });
});
