import { z } from "zod";

/**
 * PRFKT SHIELD taxonomy — mirrors SECURITY.md. Everything that can act on the
 * world is classified here; the action firewall and release gate build on it.
 */

export const ACTION_CLASSES = [
  "READ",
  "DRAFT",
  "WRITE_INTERNAL",
  "SEND_EXTERNAL",
  "PUBLISH",
  "SPEND",
  "DELETE",
  "DEPLOY",
  "ADMIN",
] as const;
export const ActionClass = z.enum(ACTION_CLASSES);
export type ActionClass = z.infer<typeof ActionClass>;

/** Actions with external or irreversible effect. Never autonomous by default. */
export const HIGH_IMPACT_ACTIONS: readonly ActionClass[] = [
  "SEND_EXTERNAL",
  "PUBLISH",
  "SPEND",
  "DELETE",
  "DEPLOY",
  "ADMIN",
];

export const CAPABILITY_PROFILES = ["SAFE", "OPERATOR", "OWNER"] as const;
export const CapabilityProfile = z.enum(CAPABILITY_PROFILES);
export type CapabilityProfile = z.infer<typeof CapabilityProfile>;

/** Profiles a customer workload may be assigned. OWNER is never a customer default. */
export const CUSTOMER_PROFILES: readonly CapabilityProfile[] = ["SAFE", "OPERATOR"];

export const RULE_DECISIONS = ["allow", "approval", "deny"] as const;
export const RuleDecision = z.enum(RULE_DECISIONS);
export type RuleDecision = z.infer<typeof RuleDecision>;

/** Sources whose content is data, never instructions. */
export const UNTRUSTED_SOURCES = [
  "website",
  "email",
  "attachment",
  "third_party_message",
  "retrieved_document",
  "tool_output",
  "mcp_output",
  "web_search",
] as const;
export const UntrustedSource = z.enum(UNTRUSTED_SOURCES);
export type UntrustedSource = z.infer<typeof UntrustedSource>;

export const RELEASE_GATES = [
  "dependency_scan",
  "secrets_scan",
  "rls_isolation",
  "redclaw_critical",
  "backup_restore",
  "admin_authorization",
  "public_abuse_controls",
  "runtime_isolation",
] as const;
export const ReleaseGate = z.enum(RELEASE_GATES);
export type ReleaseGate = z.infer<typeof ReleaseGate>;

export const RELEASE_GATE_LABELS: Record<ReleaseGate, string> = {
  dependency_scan: "Dependency scan",
  secrets_scan: "Secrets scan",
  rls_isolation: "RLS isolation",
  redclaw_critical: "RED CLAW critical suite",
  backup_restore: "Backup restore",
  admin_authorization: "Admin authorization",
  public_abuse_controls: "Public abuse controls",
  runtime_isolation: "Runtime isolation",
};

export const REDCLAW_CATEGORIES = [
  "prompt_injection",
  "indirect_injection",
  "secret_extraction",
  "path_traversal",
  "symlink_escape",
  "command_injection",
  "ssrf",
  "tool_escalation",
  "cross_tenant_access",
  "malicious_attachment",
  "duplicate_webhook",
  "unauthorized_send",
  "unauthorized_spend",
  "unauthorized_delete",
  "unauthorized_deploy",
  "runaway_loop_cost",
] as const;
export const RedClawCategory = z.enum(REDCLAW_CATEGORIES);
export type RedClawCategory = z.infer<typeof RedClawCategory>;
