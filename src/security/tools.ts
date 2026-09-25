import type { ActionClass, CapabilityProfile } from "./taxonomy";
import { PROFILE_CAPABILITIES } from "./profiles";

/**
 * Tool broker. A cell has an explicit tool allowlist; each tool declares its
 * action class and the capabilities it needs. Requests are resolved against
 * the cell's configuration only — a profile, role or tool name appearing in
 * arguments or model output never widens access.
 */
export interface ToolDefinition {
  name: string;
  action: ActionClass;
  needs: { shell?: boolean; filesystemWrite?: boolean; secrets?: boolean; gatewayAdmin?: boolean; browser?: boolean };
}

export interface CellToolConfig {
  tenantId: string;
  profile: CapabilityProfile;
  allowedTools: readonly string[];
}

export class ToolViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolViolation";
  }
}

export interface ToolCallRequest {
  tool: string;
  args: Record<string, unknown>;
  /** Tenant the caller is acting in. Must equal the cell's tenant. */
  tenantId: string;
}

const ESCALATION_KEYS = /^(profile|role|is_?admin|admin|sudo|as_?owner|tenant_?id|capabilit(y|ies)|scope|permissions?)$/i;

export function authorizeToolCall(cell: CellToolConfig, registry: ReadonlyMap<string, ToolDefinition>, req: ToolCallRequest): ToolDefinition {
  if (req.tenantId !== cell.tenantId) throw new ToolViolation("tool call targets another tenant's cell");
  const def = registry.get(req.tool);
  if (!def || !cell.allowedTools.includes(req.tool)) throw new ToolViolation(`tool ${req.tool} is not allowlisted for this cell`);
  const caps = PROFILE_CAPABILITIES[cell.profile];
  if (def.needs.shell && !caps.shell) throw new ToolViolation(`${cell.profile} cannot use shell tools`);
  if (def.needs.gatewayAdmin && !caps.gatewayAdmin) throw new ToolViolation(`${cell.profile} cannot use gateway admin tools`);
  if (def.needs.secrets && caps.secretAccess === "none") throw new ToolViolation(`${cell.profile} cannot use secret-backed tools`);
  if (def.needs.filesystemWrite && caps.filesystem === "none") throw new ToolViolation(`${cell.profile} has no filesystem access`);
  if (def.needs.browser && caps.browser === "none") throw new ToolViolation(`${cell.profile} has no browser access`);
  if (def.action === "ADMIN") throw new ToolViolation("ADMIN tools are never available in customer cells");
  const escalation = Object.keys(req.args).find((k) => ESCALATION_KEYS.test(k));
  if (escalation) throw new ToolViolation(`argument '${escalation}' attempts to set authority; authority comes from cell configuration only`);
  return def;
}
