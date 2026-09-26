# PRFKT CLAW — Build Instructions

## 1. Open the live repository

```sh
git clone https://github.com/willisnmb/Prfkt_claw.git
cd Prfkt_claw
git status
git branch --show-current
git log -5 --oneline
```

Inspect existing files before edits. If the repo already contains implementation work, merge this architecture into it rather than replacing it.

## 2. Baseline stack

If empty/prototype: Next.js App Router, React, strict TypeScript, Tailwind, shadcn/ui, Supabase Auth/Postgres/RLS, Zod, Vitest, Playwright.

## 3. Environment contract

Create .env.example, never commit real .env files:

```
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAILS=
BILLING_ENABLED=false
PROVISIONING_ENABLED=false
```

## 4. Control-plane tables

At minimum: profiles, foundations, claws, configurations, custom_build_requests, deployment_requests, provisioning_jobs, admin_audit_log, feature_flags, system_events, runtime_registry, model_registry, compute_registry.

## 5. Secure admin

Recommended routes: /admin, /admin/catalog, /admin/requests, /admin/provisioning, /admin/runtimes, /admin/models, /admin/compute, /admin/security, /admin/audit, /admin/system.

## 6. Public site

Minimum: /, /catalog, /catalog/[slug], /assistants, /crews, /workflows, /apps, /private-ai, /edge, /enterprise, /foundations, /configure, /custom, /pricing, /security, /compute, /login, /dashboard.

## 7. Runtime adapter

Define a reusable server-side adapter with validate, estimate, provision, health, suspend, resume, export, and destroy. Implement OpenClaw first. Keep LangGraph/CrewAI/PydanticAI distinction clear: they may be workflow/application components rather than tenant runtime cells.

## 8. Security first

Implement PRFKT SHIELD before public automation. Add tenant isolation, secret references, tool allowlists, path/network restrictions, approvals, rate/cost limits, audit, backup state, and RED CLAW tests.

## 9. First durable workflow

Implement PRFKT_FLOW_01.md with fake adapters before any real email, billing, or provisioning.

## 10. Validation

Adapt to the live package manager. Expected gates:

```sh
npm install
npm run typecheck
npm test
npm run build
npx playwright test
```

If lint is configured: npm run lint.

## 11. Feature gates

Keep BILLING_ENABLED=false and PROVISIONING_ENABLED=false until adapters pass acceptance.

## 12. First release goal

Responsive website; 100+ catalog items; customer configuration save; owner review; runtime/model/compute registries; SHIELD policy; FLOW 01 crash/resume proof; provisioning review-gated; tenant isolation; export/backup; green CI.
