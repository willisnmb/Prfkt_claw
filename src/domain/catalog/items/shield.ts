import type { CatalogItemInput } from "../schema";
import { A } from "./_rules";

/** SHIELD items are the shared security and control services every system runs behind. */
const base = {
  family: "SHIELD",
  runtime: "control-plane",
  modelPolicies: ["local-first", "balanced"],
  compute: ["cpu"],
  deployments: ["managed-cell", "private-cloud", "on-prem"],
  maturity: "CONFIGURABLE",
  profile: "SAFE",
} as const satisfies Partial<CatalogItemInput>;

export const SHIELD_ITEMS: CatalogItemInput[] = [
  {
    ...base,
    slug: "action-firewall",
    name: "Action Firewall",
    foundation: "security-compliance",
    summary: "Classifies every action a system can take and enforces an explicit allow, draft-only, approval or deny rule.",
    description:
      "Every action is classified — read, draft, internal write, external send, publish, spend, delete, deploy or admin — and each workflow carries an explicit rule for each class. Consequential actions default to approval or deny, and rules cannot be relaxed by content the system reads.",
    outcomes: [
      "Every action classified before it runs",
      "Explicit rules per workflow and action class",
      "Rules unaffected by instructions in content",
    ],
    integrations: ["All PRFKT systems"],
    actions: [A.read, A.write, A.adminDeny],
    tags: ["policy", "enforcement"],
  },
  {
    ...base,
    slug: "secret-broker",
    name: "Secret Broker",
    foundation: "security-compliance",
    summary: "Systems use secret references, never secret values — keys stay out of prompts, memory, logs and browsers.",
    description:
      "Integrations are connected through the Secret Broker, which hands systems a reference instead of a key. Values are resolved only at the moment of a brokered call and never appear in prompts, memory, markdown, logs or browser storage. Text that looks like a secret is redacted before storage.",
    outcomes: [
      "References instead of secret values in every system",
      "Automatic redaction of secret-like text",
      "Keys never reach prompts, memory or logs",
    ],
    integrations: ["Cloud secret managers", "OAuth providers"],
    actions: [A.read, A.writeApproval, A.adminDeny],
    tags: ["secrets", "oauth"],
  },
  {
    ...base,
    slug: "injection-sentinel",
    name: "Injection Sentinel",
    foundation: "security-compliance",
    summary: "Treats web pages, email, attachments and tool output as data, and flags content that tries to give orders.",
    description:
      "Injection Sentinel marks every piece of external content with its source and trust level, fences it off from instructions and flags attempts to issue commands, request secrets or change recipients. Flagged content cannot unlock new actions; it can only be reviewed.",
    outcomes: [
      "External content labelled with source and trust",
      "Instruction-like content flagged for review",
      "No action unlocked by untrusted content",
    ],
    integrations: ["All PRFKT systems"],
    actions: [A.read, A.write, A.adminDeny],
    tags: ["prompt-injection", "untrusted-input"],
  },
  {
    ...base,
    slug: "approval-inbox",
    name: "Approval Inbox",
    foundation: "chief",
    summary: "One place to approve or reject what your systems want to do, with the exact content and consequence shown.",
    description:
      "Every approval request shows the exact draft, recipients, amounts or changes involved and what will happen on approval. Approvals are bound to that exact content: if it changes, a new approval is required. Decisions are recorded with who, when and why.",
    outcomes: [
      "One inbox for all pending approvals",
      "Approvals bound to the exact content shown",
      "Every decision recorded with who, when and why",
    ],
    integrations: ["Web", "Email notifications", "Slack notifications"],
    actions: [A.read, A.write, A.adminDeny],
    tags: ["approvals", "human-in-the-loop"],
  },
  {
    ...base,
    slug: "audit-trail",
    name: "Audit Trail",
    foundation: "security-compliance",
    summary: "An append-only record of what every system and owner did, with secrets redacted and export on demand.",
    description:
      "The Audit Trail records runs, actions, approvals and administrative changes in an append-only log with secrets redacted. You can filter it by system, person or action and export it for your own records or auditors.",
    outcomes: [
      "Append-only record of actions and approvals",
      "Secrets redacted before anything is written",
      "Filter and export on demand",
    ],
    integrations: ["SIEM export", "CSV", "JSON"],
    actions: [A.read, A.write, A.deleteDeny, A.adminDeny],
    tags: ["audit", "logging"],
  },
  {
    ...base,
    slug: "blast-radius-limits",
    name: "Blast-Radius Limits",
    foundation: "operations",
    summary: "Caps on sends per hour, recipients per run, spend per day, tool actions per run, retries and timeouts.",
    description:
      "Blast-Radius Limits bound what any system can do even when it behaves unexpectedly: sends per hour, recipients per run, spend and model cost per day, tool actions per run, allowed domains, hosts, paths and commands, delete ceilings, timeouts and retry ceilings. Hitting a limit stops the action and notifies an owner.",
    outcomes: [
      "Hard caps on volume, spend and scope",
      "Allowlists for domains, hosts, paths and commands",
      "Owners notified when a limit is hit",
    ],
    integrations: ["All PRFKT systems"],
    actions: [A.read, A.write, A.adminDeny],
    tags: ["limits", "safety"],
  },
  {
    ...base,
    slug: "red-claw-suite",
    name: "RED CLAW Test Suite",
    foundation: "security-compliance",
    summary: "Adversarial tests run against each system: injection, secret extraction, escalation, cross-tenant access and more.",
    description:
      "RED CLAW exercises each system with adversarial cases: direct and indirect prompt injection, secret extraction, path traversal and symlink escape, command injection, SSRF, tool escalation, cross-tenant access, malicious attachments, duplicate webhooks, unauthorised sending, spending, deleting and deploying, and runaway loops. A critical failure blocks a system from being labelled READY.",
    outcomes: [
      "Adversarial coverage across sixteen attack categories",
      "Critical failures block READY",
      "Results kept as evidence with each release",
    ],
    integrations: ["CI pipelines"],
    actions: [A.read, A.write, A.deployDeny, A.adminDeny],
    tags: ["adversarial", "testing"],
  },
  {
    ...base,
    slug: "tenant-isolation-review",
    name: "Tenant Isolation Review",
    foundation: "security-compliance",
    summary: "Verifies that each customer runs in its own cell and that no data or action crosses between customers.",
    description:
      "The isolation review checks that every customer has its own runtime cell, that database policies prevent reading another customer's records and that no shared gateway is treated as a security boundary. Results are recorded as release-gate evidence.",
    outcomes: [
      "One runtime cell per customer verified",
      "Cross-customer data access tested and blocked",
      "Results recorded as release evidence",
    ],
    integrations: ["Control plane"],
    actions: [A.read, A.write, A.adminDeny],
    tags: ["isolation", "multi-tenant"],
  },
  {
    ...base,
    slug: "data-export-deletion",
    name: "Data Export & Deletion",
    foundation: "knowledge-memory",
    summary: "Customers can export everything a system holds about them, and request deletion with a verifiable record.",
    description:
      "Export produces a complete, machine-readable package of a customer's configurations, requests, memory and audit history. Deletion requests are recorded, executed across stores and confirmed with a deletion record, subject to any legal retention you are required to keep.",
    outcomes: [
      "Complete machine-readable export on request",
      "Deletion executed across stores and confirmed",
      "Legal retention exceptions made explicit",
    ],
    integrations: ["Customer dashboard"],
    actions: [A.read, A.write, A.deleteApproval, A.adminDeny],
    tags: ["privacy", "portability"],
  },
  {
    ...base,
    slug: "memory-provenance",
    name: "Memory Provenance",
    foundation: "knowledge-memory",
    summary: "Every remembered fact keeps its source, author and time; corrections are versioned, never silent overwrites.",
    description:
      "Memory Provenance attaches a source, author and timestamp to everything a system remembers. When a fact is corrected, the old version is kept with the correction and who made it, so answers can be traced and mistakes understood. Secret-like content is rejected before storage.",
    outcomes: [
      "Source, author and time on every memory",
      "Corrections versioned with who made them",
      "Secret-like content rejected before storage",
    ],
    integrations: ["All persistent systems"],
    actions: [A.read, A.write, A.deleteApproval, A.adminDeny],
    tags: ["memory", "provenance"],
  },
  {
    ...base,
    slug: "backup-restore-drill",
    name: "Backup & Restore Drill",
    foundation: "operations",
    summary: "Scheduled backups with regular restore drills, because a backup is only proven by restoring it.",
    description:
      "Backups are taken on a schedule and restore drills are run into an isolated environment to prove they work. Each drill records what was restored, how long it took and whether the result matched. A failed drill is treated as an incident.",
    outcomes: [
      "Scheduled backups per system",
      "Restore drills into isolated environments",
      "Failed drills raised as incidents",
    ],
    integrations: ["Object storage", "Database snapshots"],
    actions: [A.read, A.write, A.deleteDeny, A.adminDeny],
    tags: ["backup", "recovery"],
  },
  {
    ...base,
    slug: "guardian-controls",
    name: "Guardian Controls",
    foundation: "family-play",
    summary: "Parents and teachers set what children's profiles can see and do, with activity summaries they can review.",
    description:
      "Guardian Controls lets parents and teachers set content limits, session lengths and allowed activities for each child profile, and review activity summaries. Purchases, outside messaging and public sharing are denied for child profiles regardless of other settings.",
    outcomes: [
      "Per-child content limits and session lengths",
      "Activity summaries for guardians",
      "Purchases and outside messaging always denied for children",
    ],
    integrations: ["Family and classroom systems"],
    actions: [A.read, A.write, A.spendDeny, A.sendDeny, A.adminDeny],
    tags: ["children", "safety"],
  },
  {
    ...base,
    slug: "spend-guard",
    name: "Spend Guard",
    foundation: "commerce-inventory",
    summary: "Every spending action needs an approval, stays within per-day and per-vendor ceilings and is logged.",
    description:
      "Spend Guard sits in front of every action that costs money — purchases, refunds, paid model calls, ad spend. Each needs an approval bound to the exact amount and payee, must fit within daily and per-vendor ceilings and is logged. Duplicate requests are detected and suppressed.",
    outcomes: [
      "Approval bound to exact amount and payee",
      "Daily and per-vendor spending ceilings",
      "Duplicate spending requests suppressed",
    ],
    integrations: ["Payment providers", "Commerce platforms"],
    actions: [A.read, A.write, A.spendApproval, A.adminDeny],
    tags: ["spend", "limits"],
  },
];
