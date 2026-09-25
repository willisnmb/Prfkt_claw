/**
 * Secret detection and redaction (SECURITY.md → Secrets).
 * Used before anything is written to prompts, memory, logs or audit records,
 * and by scripts/scan-secrets.ts over the repository.
 */

export interface SecretPattern {
  id: string;
  label: string;
  re: RegExp;
}

// Patterns are anchored on vendor prefixes or structural markers to keep false
// positives low. All are global so redaction replaces every occurrence.
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { id: "private-key", label: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: "anthropic-key", label: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: "openai-key", label: "OpenAI API key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: "stripe-key", label: "Stripe secret key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: "stripe-webhook", label: "Stripe webhook secret", re: /\bwhsec_[A-Za-z0-9]{16,}\b/g },
  { id: "github-token", label: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { id: "aws-access-key", label: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "google-api-key", label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "slack-token", label: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "jwt", label: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: "postgres-url-password", label: "Database URL with password", re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@[^\s]+/g },
  { id: "bearer-token", label: "Bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g },
  {
    id: "assignment",
    label: "Secret-looking assignment",
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|client[_-]?secret)\b["']?\s*[:=](?![\\/])\s*["']?(?!secret:\/\/|\[REDACTED|(?:undefined|null|true|false)\b|process\.env\.|[A-Za-z_$][\w$]*(?:\(|\.[A-Za-z_$]))[^\s"'`,;]{8,}/gi,
  },
];

export interface SecretFinding {
  patternId: string;
  label: string;
  index: number;
}

export function findSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      findings.push({ patternId: p.id, label: p.label, index: m.index ?? 0 });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

export function containsSecret(text: string): boolean {
  return findSecrets(text).length > 0;
}

/** Replaces every detected secret with a typed placeholder. Idempotent. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    out = out.replace(p.re, `[REDACTED:${p.id}]`);
  }
  return out;
}

/** Deep-redacts string leaves of a JSON-like value (for logs and audit payloads). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) && typeof v === "string" && v.length > 0 ? "[REDACTED:key]" : redactDeep(v);
    }
    return out as T;
  }
  return value;
}

const SENSITIVE_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|service[_-]?role)/i;
