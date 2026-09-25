import type { CatalogItemInput } from "../schema";

type ActionRule = CatalogItemInput["actions"][number];

/**
 * Shorthand for governed-action rules used by catalog items. Consequential
 * actions are never "allow" and ADMIN is always denied (enforced by the schema).
 */
export const A = {
  read: { action: "READ", rule: "allow" },
  draft: { action: "DRAFT", rule: "allow" },
  write: { action: "WRITE_INTERNAL", rule: "allow" },
  writeApproval: { action: "WRITE_INTERNAL", rule: "approval" },
  sendApproval: { action: "SEND_EXTERNAL", rule: "approval" },
  sendDraftOnly: { action: "SEND_EXTERNAL", rule: "draft-only" },
  sendDeny: { action: "SEND_EXTERNAL", rule: "deny" },
  publishApproval: { action: "PUBLISH", rule: "approval" },
  publishDraftOnly: { action: "PUBLISH", rule: "draft-only" },
  spendApproval: { action: "SPEND", rule: "approval" },
  spendDeny: { action: "SPEND", rule: "deny" },
  deleteApproval: { action: "DELETE", rule: "approval" },
  deleteDeny: { action: "DELETE", rule: "deny" },
  deployApproval: { action: "DEPLOY", rule: "approval" },
  deployDeny: { action: "DEPLOY", rule: "deny" },
  adminDeny: { action: "ADMIN", rule: "deny" },
} as const satisfies Record<string, ActionRule>;
