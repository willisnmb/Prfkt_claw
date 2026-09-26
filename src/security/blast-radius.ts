import { z } from "zod";

/** Blast-radius controls (SECURITY.md). Every limit is finite; there is no "unlimited". */
export const BlastRadiusLimits = z.object({
  maxSendsPerHour: z.number().int().min(0).max(10_000),
  maxRecipientsPerRun: z.number().int().min(0).max(1_000),
  maxSpendCentsPerDay: z.number().int().min(0),
  maxModelCostCentsPerDay: z.number().int().min(0),
  maxToolActionsPerRun: z.number().int().min(1).max(10_000),
  maxDeletesPerRun: z.number().int().min(0).max(1_000),
  stepTimeoutMs: z.number().int().min(100).max(15 * 60_000),
  maxRetries: z.number().int().min(0).max(10),
  allowedDomains: z.array(z.string()).default([]),
  /** Exact addresses or "@domain" entries. */
  allowedRecipients: z.array(z.string()).default([]),
  allowedHosts: z.array(z.string()).default([]),
  allowedPaths: z.array(z.string()).default([]),
  allowedCommands: z.array(z.string()).default([]),
});
export type BlastRadiusLimits = z.infer<typeof BlastRadiusLimits>;

export const SAFE_DEFAULT_LIMITS: BlastRadiusLimits = {
  maxSendsPerHour: 20,
  maxRecipientsPerRun: 5,
  maxSpendCentsPerDay: 0,
  maxModelCostCentsPerDay: 500,
  maxToolActionsPerRun: 50,
  maxDeletesPerRun: 0,
  stepTimeoutMs: 60_000,
  maxRetries: 3,
  allowedDomains: [],
  allowedRecipients: [],
  allowedHosts: [],
  allowedPaths: [],
  allowedCommands: [],
};

export interface UsageSnapshot {
  sendsLastHour: number;
  recipientsThisRun: number;
  spendCentsToday: number;
  modelCostCentsToday: number;
  toolActionsThisRun: number;
  deletesThisRun: number;
}

export const ZERO_USAGE: UsageSnapshot = {
  sendsLastHour: 0,
  recipientsThisRun: 0,
  spendCentsToday: 0,
  modelCostCentsToday: 0,
  toolActionsThisRun: 0,
  deletesThisRun: 0,
};

export interface ProposedUsage {
  sends?: number;
  recipients?: string[];
  spendCents?: number;
  modelCostCents?: number;
  toolActions?: number;
  deletes?: number;
  host?: string;
  domain?: string;
}

export type BlastRadiusResult = { ok: true } | { ok: false; limit: keyof BlastRadiusLimits; detail: string };

export function recipientAllowed(recipient: string, allowed: readonly string[]): boolean {
  const r = recipient.trim().toLowerCase();
  const at = r.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = r.slice(at);
  return allowed.some((a) => {
    const x = a.trim().toLowerCase();
    return x.startsWith("@") ? x === domain : x === r;
  });
}

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((a) => {
    const x = a.toLowerCase();
    return x.startsWith("*.") ? h.endsWith(x.slice(1)) && h !== x.slice(2) : h === x;
  });
}

/** Checks a proposed step against limits given current usage. Pure. */
export function checkBlastRadius(limits: BlastRadiusLimits, usage: UsageSnapshot, p: ProposedUsage): BlastRadiusResult {
  const fail = (limit: keyof BlastRadiusLimits, detail: string): BlastRadiusResult => ({ ok: false, limit, detail });

  if ((p.toolActions ?? 1) + usage.toolActionsThisRun > limits.maxToolActionsPerRun)
    return fail("maxToolActionsPerRun", `tool actions would exceed ${limits.maxToolActionsPerRun} per run`);
  if (p.sends && usage.sendsLastHour + p.sends > limits.maxSendsPerHour)
    return fail("maxSendsPerHour", `sends would exceed ${limits.maxSendsPerHour}/hour`);
  if (p.recipients) {
    if (usage.recipientsThisRun + p.recipients.length > limits.maxRecipientsPerRun)
      return fail("maxRecipientsPerRun", `recipients would exceed ${limits.maxRecipientsPerRun} per run`);
    const bad = p.recipients.find((r) => !recipientAllowed(r, limits.allowedRecipients));
    if (bad !== undefined) return fail("allowedRecipients", `recipient not allowlisted`);
  }
  if (p.spendCents && usage.spendCentsToday + p.spendCents > limits.maxSpendCentsPerDay)
    return fail("maxSpendCentsPerDay", `spend would exceed ${limits.maxSpendCentsPerDay} cents/day`);
  if (p.modelCostCents && usage.modelCostCentsToday + p.modelCostCents > limits.maxModelCostCentsPerDay)
    return fail("maxModelCostCentsPerDay", `model cost would exceed ${limits.maxModelCostCentsPerDay} cents/day`);
  if (p.deletes && usage.deletesThisRun + p.deletes > limits.maxDeletesPerRun)
    return fail("maxDeletesPerRun", `deletes would exceed ${limits.maxDeletesPerRun} per run`);
  if (p.host !== undefined && !hostAllowed(p.host, limits.allowedHosts)) return fail("allowedHosts", "host not allowlisted");
  if (p.domain !== undefined && !hostAllowed(p.domain, limits.allowedDomains)) return fail("allowedDomains", "domain not allowlisted");
  return { ok: true };
}

export class BudgetExceeded extends Error {
  constructor(
    readonly limit: keyof BlastRadiusLimits,
    detail: string,
  ) {
    super(detail);
    this.name = "BudgetExceeded";
  }
}

/**
 * Per-run counter that stops runaway loops: every tool action and model call
 * is charged before it runs; exceeding a ceiling throws BudgetExceeded.
 */
export class RunBudget {
  private usage: UsageSnapshot;

  constructor(
    private readonly limits: BlastRadiusLimits,
    initial: Partial<UsageSnapshot> = {},
  ) {
    this.usage = { ...ZERO_USAGE, ...initial };
  }

  charge(p: ProposedUsage): void {
    const r = checkBlastRadius(this.limits, this.usage, p);
    if (!r.ok) throw new BudgetExceeded(r.limit, r.detail);
    this.usage = {
      sendsLastHour: this.usage.sendsLastHour + (p.sends ?? 0),
      recipientsThisRun: this.usage.recipientsThisRun + (p.recipients?.length ?? 0),
      spendCentsToday: this.usage.spendCentsToday + (p.spendCents ?? 0),
      modelCostCentsToday: this.usage.modelCostCentsToday + (p.modelCostCents ?? 0),
      toolActionsThisRun: this.usage.toolActionsThisRun + (p.toolActions ?? 1),
      deletesThisRun: this.usage.deletesThisRun + (p.deletes ?? 0),
    };
  }

  snapshot(): UsageSnapshot {
    return { ...this.usage };
  }
}
