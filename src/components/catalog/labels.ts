import type { ActionClass } from "@/security/taxonomy";

/** Plain-language labels for SHIELD action classes and rules shown publicly. */
export const ACTION_LABELS: Record<ActionClass, { label: string; hint: string }> = {
  READ: { label: "Read", hint: "Look at data it has been granted" },
  DRAFT: { label: "Draft", hint: "Prepare content without sending it" },
  WRITE_INTERNAL: { label: "Write internally", hint: "Update records inside your systems" },
  SEND_EXTERNAL: { label: "Send externally", hint: "Email, message or call someone outside" },
  PUBLISH: { label: "Publish", hint: "Make content public or merge it" },
  SPEND: { label: "Spend", hint: "Anything that costs money" },
  DELETE: { label: "Delete", hint: "Remove data or resources" },
  DEPLOY: { label: "Deploy", hint: "Change production systems" },
  ADMIN: { label: "Administer", hint: "Change permissions or platform settings" },
};

export type PublicRule = "allow" | "approval" | "deny" | "draft-only";

export const RULE_LABELS: Record<PublicRule, { label: string; tone: "ok" | "gate" | "deny" | "draft" }> = {
  allow: { label: "Allowed", tone: "ok" },
  approval: { label: "Needs approval", tone: "gate" },
  "draft-only": { label: "Draft only", tone: "draft" },
  deny: { label: "Denied", tone: "deny" },
};
