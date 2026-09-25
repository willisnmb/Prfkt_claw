import { z } from "zod";
import type { WorkflowPolicy } from "@/security/firewall";
import { SAFE_DEFAULT_LIMITS } from "@/security/blast-radius";
import type { ActionClass } from "@/security/taxonomy";

/** PRFKT FLOW 01 — Lead-to-Customer. Mirrors PRFKT_FLOW_01.md and the flow01 migration. */

export const FLOW01_STATES = [
  "NEW_LEAD",
  "SOURCE_VERIFICATION",
  "RESEARCH",
  "RESEARCH_COMPLETE",
  "QUALIFICATION_REVIEW",
  "QUALIFIED",
  "DISQUALIFIED",
  "PROPOSAL_DRAFT",
  "WAITING_FOR_APPROVAL",
  "APPROVED_FOR_SEND",
  "REJECTED_FOR_REVISION",
  "SEND_REQUESTED",
  "SENT",
  "WAITING_FOR_REPLY",
  "CUSTOMER_ACCEPTED",
  "LOST",
  "FOLLOW_UP_DUE",
  "PAYMENT_CONFIRMATION",
  "PAYMENT_CONFIRMED",
  "PROVISIONING_REVIEW",
  "PROVISIONING",
  "CONFIG_VALIDATION",
  "ACCEPTANCE_TEST",
  "DEPLOYMENT_APPROVAL",
  "ACTIVE",
] as const;
export const Flow01State = z.enum(FLOW01_STATES);
export type Flow01State = z.infer<typeof Flow01State>;

/** Allowed transitions. Must equal public.flow_transitions (asserted in tests). */
export const FLOW01_TRANSITIONS: Readonly<Record<Flow01State, readonly Flow01State[]>> = {
  NEW_LEAD: ["SOURCE_VERIFICATION"],
  SOURCE_VERIFICATION: ["RESEARCH", "DISQUALIFIED"],
  RESEARCH: ["RESEARCH_COMPLETE"],
  RESEARCH_COMPLETE: ["QUALIFICATION_REVIEW"],
  QUALIFICATION_REVIEW: ["QUALIFIED", "DISQUALIFIED"],
  QUALIFIED: ["PROPOSAL_DRAFT"],
  DISQUALIFIED: [],
  PROPOSAL_DRAFT: ["WAITING_FOR_APPROVAL"],
  WAITING_FOR_APPROVAL: ["APPROVED_FOR_SEND", "REJECTED_FOR_REVISION"],
  APPROVED_FOR_SEND: ["SEND_REQUESTED"],
  REJECTED_FOR_REVISION: ["PROPOSAL_DRAFT"],
  SEND_REQUESTED: ["SENT"],
  SENT: ["WAITING_FOR_REPLY"],
  WAITING_FOR_REPLY: ["CUSTOMER_ACCEPTED", "LOST", "FOLLOW_UP_DUE"],
  CUSTOMER_ACCEPTED: ["PAYMENT_CONFIRMATION"],
  LOST: [],
  FOLLOW_UP_DUE: ["PROPOSAL_DRAFT", "LOST"],
  PAYMENT_CONFIRMATION: ["PAYMENT_CONFIRMED"],
  PAYMENT_CONFIRMED: ["PROVISIONING_REVIEW"],
  PROVISIONING_REVIEW: ["PROVISIONING"],
  PROVISIONING: ["CONFIG_VALIDATION"],
  CONFIG_VALIDATION: ["ACCEPTANCE_TEST"],
  ACCEPTANCE_TEST: ["DEPLOYMENT_APPROVAL"],
  DEPLOYMENT_APPROVAL: ["ACTIVE"],
  ACTIVE: [],
};

export const TERMINAL_STATES: readonly Flow01State[] = ["ACTIVE", "DISQUALIFIED", "LOST"];

export function isAllowedTransition(from: Flow01State, to: Flow01State): boolean {
  return FLOW01_TRANSITIONS[from].includes(to);
}

/** Mandatory approvals (PRFKT_FLOW_01.md): proposal send, payment-sensitive state, provisioning, production activation. */
export const APPROVAL_KINDS = ["PROPOSAL_SEND", "PAYMENT", "PROVISIONING", "PRODUCTION_ACTIVATION"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_GATES: Record<ApprovalKind, { state: Flow01State; action: ActionClass; label: string }> = {
  PROPOSAL_SEND: { state: "WAITING_FOR_APPROVAL", action: "SEND_EXTERNAL", label: "Send proposal to the lead" },
  PAYMENT: { state: "PAYMENT_CONFIRMATION", action: "SPEND", label: "Confirm payment reconciliation" },
  PROVISIONING: { state: "PROVISIONING_REVIEW", action: "DEPLOY", label: "Provision the customer's runtime cell" },
  PRODUCTION_ACTIVATION: { state: "DEPLOYMENT_APPROVAL", action: "DEPLOY", label: "Activate in production" },
};

/**
 * The explicit SHIELD rule for FLOW 01 (SECURITY.md: "Each workflow has an
 * explicit rule"). SAFE profile; every consequential action is approval-gated.
 */
export const FLOW01_POLICY: WorkflowPolicy = {
  id: "PRFKT_FLOW_01",
  profile: "SAFE",
  rules: {
    READ: { mode: "allow" },
    DRAFT: { mode: "allow" },
    WRITE_INTERNAL: { mode: "allow" },
    SEND_EXTERNAL: { mode: "approval" },
    SPEND: { mode: "approval" },
    DEPLOY: { mode: "approval" },
    PUBLISH: { mode: "deny" },
    DELETE: { mode: "deny" },
    ADMIN: { mode: "deny" },
  },
  limits: {
    ...SAFE_DEFAULT_LIMITS,
    maxSendsPerHour: 10,
    maxRecipientsPerRun: 1,
    maxToolActionsPerRun: 200,
    maxRetries: 3,
    stepTimeoutMs: 30_000,
  },
};

/** Which action class each state's work performs — every class must have a rule above. */
export const STATE_ACTION: Record<Flow01State, ActionClass> = {
  NEW_LEAD: "WRITE_INTERNAL",
  SOURCE_VERIFICATION: "READ",
  RESEARCH: "READ",
  RESEARCH_COMPLETE: "WRITE_INTERNAL",
  QUALIFICATION_REVIEW: "WRITE_INTERNAL",
  QUALIFIED: "WRITE_INTERNAL",
  DISQUALIFIED: "WRITE_INTERNAL",
  PROPOSAL_DRAFT: "DRAFT",
  WAITING_FOR_APPROVAL: "WRITE_INTERNAL",
  APPROVED_FOR_SEND: "WRITE_INTERNAL",
  REJECTED_FOR_REVISION: "WRITE_INTERNAL",
  SEND_REQUESTED: "SEND_EXTERNAL",
  SENT: "WRITE_INTERNAL",
  WAITING_FOR_REPLY: "READ",
  CUSTOMER_ACCEPTED: "DRAFT", // draft invoice bound to the approved proposal amount
  LOST: "WRITE_INTERNAL",
  FOLLOW_UP_DUE: "WRITE_INTERNAL",
  PAYMENT_CONFIRMATION: "SPEND",
  PAYMENT_CONFIRMED: "WRITE_INTERNAL",
  PROVISIONING_REVIEW: "WRITE_INTERNAL",
  PROVISIONING: "DEPLOY",
  CONFIG_VALIDATION: "READ",
  ACCEPTANCE_TEST: "READ",
  DEPLOYMENT_APPROVAL: "DEPLOY",
  ACTIVE: "WRITE_INTERNAL",
};

export const MAX_FOLLOW_UPS = 2;
export const FOLLOW_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const QUALIFICATION_THRESHOLD = 60;
export const ALLOWED_LEAD_SOURCES = ["inbound_form", "referral", "event", "partner"] as const;

/* ------------------------------------------------------------ contracts */

export const Lead = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().min(1).max(160),
  email: z.email().max(254),
  website: z.url().max(300),
  source: z.string().max(40),
  planSlug: z.string().max(80).default("chief-of-staff"),
  priceCents: z.number().int().min(0).max(100_000_000).default(250_000),
});
export type Lead = z.infer<typeof Lead>;

/** Structured model output for RESEARCH. Anything that fails this is rejected. */
export const ResearchOutput = z
  .object({
    companySummary: z.string().min(10).max(1200),
    industry: z.string().min(2).max(80),
    employeeEstimate: z.number().int().min(1).max(10_000_000),
    fitSignals: z.array(z.string().min(2).max(200)).max(10),
    risks: z.array(z.string().min(2).max(200)).max(10),
    disqualifying: z.boolean(),
    score: z.number().int().min(0).max(100),
  })
  .strict();
export type ResearchOutput = z.infer<typeof ResearchOutput>;

export const Proposal = z.object({
  revision: z.number().int().min(1),
  to: z.email(),
  subject: z.string().min(5).max(200),
  body: z.string().min(20).max(8000),
  planSlug: z.string(),
  priceCents: z.number().int().min(0),
  followUp: z.number().int().min(0),
});
export type Proposal = z.infer<typeof Proposal>;

export const CellPlan = z.object({
  tenantId: z.uuid(),
  cellName: z.string().regex(/^cell-[a-z0-9-]{4,60}$/),
  profile: z.enum(["SAFE", "OPERATOR"]),
  runtime: z.string(),
  modelPolicy: z.string(),
  limits: z.object({ maxToolActionsPerRun: z.number().int().positive(), maxModelCostCentsPerDay: z.number().int().min(0) }),
  secretRefs: z.record(z.string(), z.string()),
});
export type CellPlan = z.infer<typeof CellPlan>;
