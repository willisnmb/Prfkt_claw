import type { ActionClass, CapabilityProfile } from "./taxonomy";

/**
 * Capability profiles (SECURITY.md). A profile is assigned to a runtime cell by
 * the control plane — never by a request, a prompt, or tool arguments.
 */
export interface ProfileCapabilities {
  shell: boolean;
  filesystem: "none" | "bounded-workspace" | "unrestricted";
  gatewayAdmin: boolean;
  secretAccess: "none" | "broker-injection";
  persistentMemory: boolean;
  browser: "none" | "approved-domains";
  /** Action classes that may ever run without a per-action approval. */
  autonomousActions: readonly ActionClass[];
  customerAssignable: boolean;
}

export const PROFILE_CAPABILITIES: Record<CapabilityProfile, ProfileCapabilities> = {
  SAFE: {
    shell: false,
    filesystem: "none",
    gatewayAdmin: false,
    secretAccess: "none",
    persistentMemory: false,
    browser: "none",
    autonomousActions: ["READ", "DRAFT"],
    customerAssignable: true,
  },
  OPERATOR: {
    shell: false,
    filesystem: "bounded-workspace",
    gatewayAdmin: false,
    secretAccess: "broker-injection",
    persistentMemory: true,
    browser: "approved-domains",
    autonomousActions: ["READ", "DRAFT", "WRITE_INTERNAL"],
    customerAssignable: true,
  },
  OWNER: {
    shell: true,
    filesystem: "unrestricted",
    gatewayAdmin: true,
    secretAccess: "broker-injection",
    persistentMemory: true,
    browser: "approved-domains",
    autonomousActions: ["READ", "DRAFT", "WRITE_INTERNAL"],
    customerAssignable: false,
  },
};

export class ProfileViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileViolation";
  }
}

/** OWNER is never a customer default (SECURITY.md). */
export function assertCustomerProfile(profile: CapabilityProfile): asserts profile is "SAFE" | "OPERATOR" {
  if (!PROFILE_CAPABILITIES[profile].customerAssignable) {
    throw new ProfileViolation(`profile ${profile} cannot be assigned to a customer cell`);
  }
}

/**
 * OPERATOR allows a bounded command allowlist through the command guard, but
 * never an interactive shell; only OWNER has shell. Kept explicit here so the
 * command guard can consult one source.
 */
export function mayRunCommands(profile: CapabilityProfile): boolean {
  return profile === "OPERATOR" || profile === "OWNER";
}
