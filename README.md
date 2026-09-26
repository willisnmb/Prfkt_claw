# PRFKT CLAW

Storefront and control plane for finished AI systems: assistants (CLAW), durable workflows (FLOW), agent teams (CREW), validated apps (STRICT), edge/local systems (EDGE) and governed private deployments (SECURE). AUTO recommends an architecture, model policy and compute class; SHIELD governs what every system may do.

Owner specs, read in this order: [HANDOFF](HANDOFF.md) · [AGENTS](AGENTS.md) · [ARCHITECTURE](ARCHITECTURE.md) · [SECURITY](SECURITY.md) · [RUNTIME_STRATEGY](RUNTIME_STRATEGY.md) · [PRFKT_FLOW_01](PRFKT_FLOW_01.md) · [BUILD_INSTRUCTIONS](BUILD_INSTRUCTIONS.md) · [RELEASE_CHECKLIST](RELEASE_CHECKLIST.md)

Status: [docs/RELEASE_STATUS.md](docs/RELEASE_STATUS.md) · Open findings: [docs/FINDINGS.md](docs/FINDINGS.md). **Not production-ready**; the release gates that need owner accounts have not been run.

## Quick start

```sh
npm ci
cp .env.example .env.local    # everything optional for the public site
npm run dev                   # http://localhost:3000
```

The public site, catalog, configurator and intake validation work with no configuration. Sign-in, the dashboard and `/admin` need a Supabase project plus `DATABASE_URL`. Without them they **fail closed**: saves return a clear "not available", and admin/dashboard redirect to login.

## Scripts

| Command | What it does |
|---|---|
| `npm run typecheck` | `next typegen` + strict `tsc` |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm test` | Vitest: unit, RLS isolation (real Postgres via PGlite), RED CLAW, FLOW 01 including real `SIGKILL` resume |
| `npm run test:redclaw` | RED CLAW critical suite only |
| `npm run test:flow:kill` | FLOW 01 process-termination proof only |
| `npx playwright test` | Browser acceptance: desktop Chromium, desktop WebKit, iPhone 15, Pixel 7 (needs `npm run build` first) |
| `npm run scan:secrets` / `npm run scan:deps` | Secrets scan over the repo / `npm audit` (production deps, high+) |
| `npm run build` | Production build |
| `npm run gate` | typecheck + lint + tests + secrets scan + build |
| `npx tsx scripts/generate-seed.ts [--check]` | Regenerate `supabase/seed.sql` from the catalog and registries (or check it is current) |
| `npm run flow:worker` | FLOW 01 worker (refuses to start in production; see below) |
| `npx tsx scripts/reconcile-stripe.ts` | Records Stripe-paid invoices whose webhook never arrived (read-only against Stripe, idempotent; needs `BILLING_ENABLED=true`) |

## Layout

```
src/domain/        families, 14 foundations, registries, catalog (104 items), AUTO recommender, intake schemas
src/security/      SHIELD: profiles, action firewall, blast radius, untrusted content, secrets, paths,
                   commands, SSRF, attachments, tool broker, secret refs, webhook signatures
src/flow/flow01/   FLOW 01 Lead-to-Customer: definition, LangGraph engine, store, fake adapters, webhooks
src/billing/       Stripe payment adapter (fetch client), Stripe webhook handling, payment reconciliation
src/runtime/       runtime adapter contract, OpenClaw cell adapter, model router, Ollama probe
src/server/        env, db (SQL port: postgres + PGlite), auth (requireOwner/requireUser), audit,
                   rate limits, flags, data access, backup
src/app/(site)/    public storefront, /login, /dashboard
src/app/admin/     owner control plane (catalog, requests, provisioning, flows, runtimes, models,
                   compute, security, audit, system)
supabase/          migrations (identity/tenancy, control plane, FLOW 01), generated seed, test stub
tests/             data (RLS), redclaw, flow, billing, runtime, storefront
e2e/               Playwright (public, auth-admin)
docs/              findings, release status, cell-controller contract
```

## Key design decisions

- **One trust domain per runtime cell.** Tenancy is enforced in Postgres RLS (`app.is_tenant_member`), and server code runs customer queries as the `authenticated` role with JWT claims (`withUser`). Owner-only tables have no policies and no grants.
- **Owner access** requires a Supabase session verified by the Auth server, a confirmed email, and a match in `ADMIN_EMAILS`, checked on every layout, page and action. There is no query key, cookie flag, header or client-side switch. Every owner mutation writes `admin_audit_log` in the same transaction.
- **FLOW 01 durability.** The Postgres run row is the checkpoint. LangGraph.js orchestrates the 25-state graph on each invocation. Side effects are ledgered and re-issued with the same idempotency key after a crash. Database triggers enforce legal transitions, approval-gated states, and "ACTIVE requires the latest acceptance test passed plus an approved activation".
- **Feature gates.** `BILLING_ENABLED` and `PROVISIONING_ENABLED` default to false. FLOW 01 runs with fake adapters and is disabled in production until real adapters pass acceptance. Outside production, `BILLING_ENABLED=true` plus a Stripe test key swaps in the Stripe payment adapter (F-008); the stored `billing_enabled` flag must also be on for invoices to be created.
- **Honest maturity.** Nothing is READY. READY requires recorded passing evidence for all 8 release gates, enforced by the Zod schema and by a database trigger.

## Deploying

1. Create a Supabase project and apply `supabase/migrations/*` then `supabase/seed.sql` (e.g. `supabase db push`, then run the seed).
2. Set env vars from `.env.example`. Server-only values (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) must never get a `NEXT_PUBLIC_` prefix.
3. Build: `docker build` with the public vars as build args (see `Dockerfile`), or any Node 22 host with `npm run build && npm start`.
