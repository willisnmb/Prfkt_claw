# PRFKT CLAW — Engineering Handoff

Target repository: https://github.com/willisnmb/Prfkt_claw

## Mission

Build PRFKT CLAW into a production-grade, responsive AI systems storefront and control plane. Customers buy finished AI systems, not framework choices.

## Product families

- PRFKT CLAW — OpenClaw-first persistent assistant/workspace.
- PRFKT FLOW — LangGraph-first durable workflows.
- PRFKT CREW — CrewAI-first multi-agent teams.
- PRFKT STRICT — PydanticAI-first typed/validated systems.
- PRFKT EDGE — ZeroClaw-first lightweight/local deployments.
- PRFKT SECURE — governed/private deployment class.
- PRFKT AUTO — architecture/model/compute optimizer.
- PRFKT SHIELD — shared security, approvals, audit, and limits.

## Default web stack

Next.js App Router, React, strict TypeScript, Tailwind, shadcn/ui, Supabase Auth/Postgres/RLS, Zod, Vitest, Playwright, Docker-compatible deployment.

## Non-negotiables

1. One hostile trust boundary per customer runtime cell.
2. No shared OpenClaw gateway for unrelated customers.
3. Secrets never live in prompts, memory, markdown, browser storage, or logs.
4. Consequential actions are deny, draft-only, allow-once, approval-gated, or explicitly scoped autonomous.
5. Billing and provisioning start disabled.
6. Local Ollama is first-class.
7. Customer export/deletion is required.
8. Memory preserves provenance and corrections.
9. READY requires acceptance evidence.

## 14 foundations

Chief, Research, CRM/Sales, Support, Operations, Finance/Admin, Marketing/Creative, Developer/Builder, Commerce/Inventory, Voice/Reception, Knowledge/Memory, Security/Compliance, Family/Play, Learning/Maker.

## Priority order

1. Repository baseline + CI.
2. Responsive storefront and catalog.
3. Supabase auth/schema/RLS/admin.
4. Catalog/foundation/runtime registries.
5. Configurator + custom intake.
6. PRFKT SHIELD.
7. PRFKT FLOW 01 Lead-to-Customer.
8. Runtime adapters.
9. Observability/backups/audit.
10. Enable billing/provisioning only after acceptance.

## Definition of complete

Typecheck, tests, build, Playwright, migrations, RLS isolation, admin authorization, abuse controls, secret/dependency scans, backup restore, tenant isolation, and launch checklist must pass.
