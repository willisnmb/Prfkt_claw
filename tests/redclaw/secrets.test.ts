import { describe, expect } from "vitest";
import { redclaw } from "./redclaw";
import { assemblePrompt, PromptSecurityError } from "@/security/untrusted";
import { redactSecrets, redactDeep, containsSecret } from "@/security/secrets";
import { SecretBroker, assertMemorySafe, assertNoSecretValues, SecretPolicyViolation } from "@/security/secret-refs";

// Deliberately fake secrets. This directory is allowlisted by scripts/scan-secrets.ts.
const FAKE_ANTHROPIC = "sk-ant-api03-" + "A".repeat(40);
const FAKE_STRIPE = "sk_live_" + "b".repeat(24);
const FAKE_PEM = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

describe("secret extraction", () => {
  redclaw("secret_extraction", "a prompt containing a secret anywhere is refused", () => {
    expect(() => assemblePrompt({ system: `key=${FAKE_ANTHROPIC}`, task: "t", context: [] })).toThrow(PromptSecurityError);
    expect(() => assemblePrompt({ system: "s", task: `use ${FAKE_STRIPE}`, context: [] })).toThrow(PromptSecurityError);
    expect(() => assemblePrompt({ system: "s", task: "t", context: [{ source: "retrieved_document", ref: "d", text: FAKE_PEM }] })).toThrow(PromptSecurityError);
  });

  redclaw("secret_extraction", "memory writes containing secrets are rejected", () => {
    expect(() => assertMemorySafe(`remember my password: hunter2hunter2`)).toThrow(SecretPolicyViolation);
    expect(() => assertMemorySafe(`token ${FAKE_ANTHROPIC}`)).toThrow(SecretPolicyViolation);
    expect(() => assertMemorySafe("Customer prefers morning calls.")).not.toThrow();
  });

  redclaw("secret_extraction", "logs and audit payloads are redacted deeply", () => {
    const out = redactDeep({ note: `leaked ${FAKE_STRIPE}`, headers: { authorization: "Bearer abc" }, nested: [{ api_key: "x".repeat(30) }] });
    const s = JSON.stringify(out);
    expect(containsSecret(s)).toBe(false);
    expect(s).not.toContain(FAKE_STRIPE);
    expect(s).not.toContain("Bearer abc");
    expect(redactSecrets(FAKE_PEM)).toBe("[REDACTED:private-key]");
  });

  redclaw("secret_extraction", "cell configuration cannot carry raw secrets or foreign references", () => {
    expect(() => assertNoSecretValues({ model: { apiKey: FAKE_ANTHROPIC } }, T1)).toThrow(SecretPolicyViolation);
    expect(() => assertNoSecretValues({ model: { apiKeyRef: "plain-value" } }, T1)).toThrow(SecretPolicyViolation);
    expect(() => assertNoSecretValues({ model: { apiKeyRef: `secret://${T2}/anthropic` } }, T1)).toThrow(/another tenant/);
    expect(() => assertNoSecretValues({ model: { apiKeyRef: `secret://${T1}/anthropic` } }, T1)).not.toThrow();
  });

  redclaw("cross_tenant_access", "the secret broker never resolves another tenant's reference", async () => {
    const store = { get: async (t: string, n: string) => (t === T2 && n === "stripe" ? FAKE_STRIPE : undefined) };
    const events: { granted: boolean }[] = [];
    const broker = new SecretBroker(store, (e) => events.push(e));
    await expect(broker.withSecret(T1, `secret://${T2}/stripe`, "payment-provider", async (v) => v)).rejects.toThrow(/another tenant/);
    expect(events).toEqual([expect.objectContaining({ granted: false })]);
  });

  redclaw("secret_extraction", "broker hands the value to the adapter callback only", async () => {
    const broker = new SecretBroker({ get: async () => FAKE_STRIPE });
    const result = await broker.withSecret(T1, `secret://${T1}/stripe`, "payment-provider", async (v) => ({ used: v.length > 0 }));
    expect(result).toEqual({ used: true });
  });
});
