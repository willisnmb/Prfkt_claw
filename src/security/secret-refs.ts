import { findSecrets } from "./secrets";

/**
 * Secret references and broker (SECURITY.md → Secrets). Configuration, memory,
 * prompts and logs hold only references like `secret://<tenant-id>/<name>`.
 * The broker resolves a reference for its own tenant, for a declared purpose,
 * and hands the value to an adapter call — never back to a model or a page.
 */
const REF = /^secret:\/\/([0-9a-f-]{36})\/([a-z0-9][a-z0-9_.-]{0,63})$/;

export interface SecretRef {
  tenantId: string;
  name: string;
}

export class SecretPolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretPolicyViolation";
  }
}

export function parseSecretRef(ref: string): SecretRef {
  const m = REF.exec(ref);
  if (!m) throw new SecretPolicyViolation("not a valid secret reference");
  return { tenantId: m[1]!, name: m[2]! };
}

export function isSecretRef(v: unknown): v is string {
  return typeof v === "string" && REF.test(v);
}

export interface SecretStore {
  get(tenantId: string, name: string): Promise<string | undefined>;
}

export type SecretPurpose = "model-provider" | "integration-oauth" | "payment-provider" | "email-provider" | "runtime-gateway";

export class SecretBroker {
  constructor(
    private readonly store: SecretStore,
    private readonly audit: (e: { tenantId: string; name: string; purpose: SecretPurpose; granted: boolean }) => void = () => {},
  ) {}

  /** Resolves only within the caller's tenant; the value is passed to `use` and never returned. */
  async withSecret<T>(callerTenantId: string, ref: string, purpose: SecretPurpose, use: (value: string) => Promise<T>): Promise<T> {
    const parsed = parseSecretRef(ref);
    if (parsed.tenantId !== callerTenantId) {
      this.audit({ tenantId: callerTenantId, name: parsed.name, purpose, granted: false });
      throw new SecretPolicyViolation("secret reference belongs to another tenant");
    }
    const value = await this.store.get(parsed.tenantId, parsed.name);
    this.audit({ tenantId: callerTenantId, name: parsed.name, purpose, granted: value !== undefined });
    if (value === undefined) throw new SecretPolicyViolation("secret not found");
    return use(value);
  }
}

/**
 * Walks a configuration object and rejects secret-looking values. Fields
 * ending in `Ref`/`_ref` must hold a secret reference for the same tenant.
 */
export function assertNoSecretValues(config: unknown, tenantId: string, path = "$"): void {
  if (typeof config === "string") {
    if (isSecretRef(config)) {
      if (parseSecretRef(config).tenantId !== tenantId) throw new SecretPolicyViolation(`${path}: reference to another tenant's secret`);
      return;
    }
    if (findSecrets(config).length) throw new SecretPolicyViolation(`${path}: secret value in configuration; use a secret reference`);
    return;
  }
  if (Array.isArray(config)) return config.forEach((v, i) => assertNoSecretValues(v, tenantId, `${path}[${i}]`));
  if (config && typeof config === "object") {
    for (const [k, v] of Object.entries(config)) {
      const p = `${path}.${k}`;
      if (/(ref|_ref)$/i.test(k) && v !== null && v !== undefined && !isSecretRef(v))
        throw new SecretPolicyViolation(`${p}: must be a secret:// reference`);
      if (/^(password|secret|api_?key|token|refresh_?token|private_?key|service_?role_?key|client_?secret)$/i.test(k) && v)
        throw new SecretPolicyViolation(`${p}: secret-bearing field; use a *Ref field with a secret reference`);
      assertNoSecretValues(v, tenantId, p);
    }
  }
}

/** Memory guard: memory must never store secrets (SECURITY.md). */
export function assertMemorySafe(text: string): void {
  if (findSecrets(text).length) throw new SecretPolicyViolation("memory write rejected: contains a secret");
}
