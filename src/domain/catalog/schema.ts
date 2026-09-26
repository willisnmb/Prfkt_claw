import { z } from "zod";
import { FamilyId, RuntimeId } from "../families";
import { FoundationId } from "../foundations";
import { ComputeClassId, ModelPolicyId } from "../registries";
import { ActionClass, CapabilityProfile, RELEASE_GATES, ReleaseGate } from "@/security/taxonomy";

export const MATURITY = ["READY", "CONFIGURABLE", "CUSTOM"] as const;
export const Maturity = z.enum(MATURITY);
export type Maturity = z.infer<typeof Maturity>;

export const MATURITY_DEFINITIONS: Record<Maturity, string> = {
  READY: "Packaged and accepted. Every release gate has recorded passing evidence.",
  CONFIGURABLE: "Built from a tested template. Configured to your systems, then accepted against your data before go-live.",
  CUSTOM: "Scoped with you and built to order. Acceptance criteria are agreed before build starts.",
};

export const DEPLOYMENT_TARGETS = ["managed-cell", "private-cloud", "on-prem", "edge-device"] as const;
export const DeploymentTarget = z.enum(DEPLOYMENT_TARGETS);
export type DeploymentTarget = z.infer<typeof DeploymentTarget>;

export const DEPLOYMENT_LABELS: Record<DeploymentTarget, string> = {
  "managed-cell": "Managed isolated cell",
  "private-cloud": "Your private cloud",
  "on-prem": "On-premises",
  "edge-device": "Edge device",
};

export const Evidence = z.object({
  gate: ReleaseGate,
  /** A verifiable reference: CI run URL, test file path, or report ID. */
  ref: z.string().min(3),
  result: z.literal("pass"),
  verifiedAt: z.iso.date(),
});
export type Evidence = z.infer<typeof Evidence>;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case slug");

export const CatalogItem = z
  .object({
    slug,
    name: z.string().min(3).max(60),
    family: FamilyId,
    foundation: FoundationId,
    /** One line, outcome-first, no framework names. */
    summary: z.string().min(20).max(160),
    description: z.string().min(60).max(900),
    outcomes: z.array(z.string().min(5).max(140)).min(2).max(6),
    /** Integrations the system can use once connected. */
    integrations: z.array(z.string().min(2).max(40)).max(10),
    /** Action classes this system can perform, with how each is governed. */
    actions: z
      .array(z.object({ action: ActionClass, rule: z.enum(["allow", "approval", "deny", "draft-only"]) }))
      .min(1),
    profile: CapabilityProfile.exclude(["OWNER"]),
    runtime: RuntimeId,
    modelPolicies: z.array(ModelPolicyId).min(1),
    compute: z.array(ComputeClassId).min(1),
    deployments: z.array(DeploymentTarget).min(1),
    maturity: Maturity,
    evidence: z.array(Evidence).default([]),
    tags: z.array(z.string().min(2).max(30)).max(8).default([]),
  })
  .superRefine((item, ctx) => {
    if (item.maturity === "READY") {
      const covered = new Set(item.evidence.map((e) => e.gate));
      const missing = RELEASE_GATES.filter((g) => !covered.has(g));
      if (missing.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["evidence"],
          message: `READY requires passing evidence for every release gate; missing: ${missing.join(", ")}`,
        });
      }
    }
    const seen = new Set<string>();
    for (const a of item.actions) {
      if (seen.has(a.action)) ctx.addIssue({ code: "custom", path: ["actions"], message: `duplicate action ${a.action}` });
      seen.add(a.action);
      // SECURITY.md: consequential actions are never autonomous for customer profiles.
      if (["SEND_EXTERNAL", "PUBLISH", "SPEND", "DELETE", "DEPLOY"].includes(a.action) && a.rule === "allow") {
        ctx.addIssue({ code: "custom", path: ["actions"], message: `${a.action} cannot be 'allow' in a catalog default` });
      }
      if (a.action === "ADMIN" && a.rule !== "deny") {
        ctx.addIssue({ code: "custom", path: ["actions"], message: "ADMIN must be denied for customer systems" });
      }
    }
  });
export type CatalogItem = z.infer<typeof CatalogItem>;
export type CatalogItemInput = z.input<typeof CatalogItem>;
