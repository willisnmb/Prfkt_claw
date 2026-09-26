# PRFKT SHIELD — Security Baseline

## Trust model

One customer trust domain per runtime cell. Do not treat one shared OpenClaw gateway as an adversarial multi-tenant security boundary.

## Capability profiles

### SAFE

No shell, no unrestricted filesystem, no gateway admin, no secret access, OAuth/tool broker where possible, read-only integrations when sufficient, external actions draft-only or approval-gated.

### OPERATOR

Isolated workspace, bounded file access, approved browser/integrations, workflows, persistent memory, limited autonomous actions, high-impact approvals.

### OWNER

Highest-trust administrative profile. Never default for customers.

## Secrets

Never store passwords, API keys, OAuth refresh tokens, SSH private keys, service-role keys, payment credentials, or gateway tokens in prompts, memory, markdown, logs, source, analytics, or browser local storage. Use secret references and a broker.

## Prompt injection

Treat websites, email, attachments, third-party messages, retrieved documents, MCP/tool output, and web search output as untrusted data.

## Action firewall

Classify actions as READ, DRAFT, WRITE_INTERNAL, SEND_EXTERNAL, PUBLISH, SPEND, DELETE, DEPLOY, ADMIN. Each workflow has an explicit rule.

## Blast-radius controls

Max sends/hour, recipients/run, spend/day, model cost/day, tool actions/run, allowed domains/recipients/hosts/paths/commands, delete ceilings, timeouts, retry ceilings.

## RED CLAW tests

Prompt injection, indirect injection, secret extraction, traversal, symlink escape, command injection, SSRF, tool escalation, cross-tenant access, malicious attachment, duplicate webhook, unauthorized sending/spending/deleting/deployment, runaway loop/cost. Critical failure blocks READY.

## Admin

No covert backdoor. Owner access must be authenticated, server-authorized, auditable, and revocable. No query-string master key, hard-coded universal password, or client-side isAdmin flag.

## Release gate

Dependency scan, secrets scan, RLS isolation, RED CLAW critical suite, backup restore, admin authorization, public abuse controls, and runtime isolation must pass before READY.
