# Release status against RELEASE_CHECKLIST.md

Legend: ✅ passed with evidence · ⚠️ partial / verified only locally or against fakes · ❌ not done (owner action needed). Evidence was recorded on branch `feat/claw-control-plane`, 2026-09-25.

**Verdict: not releasable.** Nothing is READY; 0 of 104 catalog items claim READY.

## Repository
- ✅ Correct repo `willisnmb/Prfkt_claw`. Base `main` @ `cb7f932`, which contained only the GitHub starter `blank.yml`.
- ✅ Existing work preserved. The starter `blank.yml` was replaced by `ci.yml`, which keeps the name "CI" and the same triggers.
- ⚠️ CI configured (`.github/workflows/ci.yml`) but not yet run on GitHub (branch not pushed).
- ✅ README and AGENTS are current.

## Build
- ✅ Reproducible install: `npm ci` from the lockfile (Node 22).
- ✅ Strict TypeScript: `npm run typecheck` is clean.
- ✅ Lint: `npm run lint`, zero warnings.
- ✅ Unit tests: `npm test`, 19 files, all passing (see the latest handoff for exact counts).
- ✅ Production build: 125 pages; admin and dashboard routes are dynamic.
- ✅ Playwright smoke: 257 passed, 0 failed, 0 flaky, 3 skipped (documented capability skips, F-017).

## Responsive UI
- ✅ iPhone (WebKit, iPhone 15 profile) · ✅ Android (Pixel 7) · ✅ Mac (desktop WebKit + Chromium) · ⚠️ Windows: Chromium engine covered; no Edge-on-Windows run.
- ✅ Keyboard navigation (skip links, focus rings, mobile nav by keyboard; F-017).
- ✅ Loading, error and empty states on data pages.

## Auth/Data
- ✅ Supabase connected: project `prfkt-claw` with migrations and seed applied.
- ✅ Migrations and seed are idempotent (seed applied twice in tests; `--check` in CI).
- ⚠️ Customer auth and ⚠️ admin auth: implemented and fail-closed. Signed-out denial is e2e-tested; there has been no live sign-in (F-001, F-002).
- ✅ RLS isolation: every customer table plus FLOW tables on PGlite, and 21/21 live checks on real Supabase (`scripts/verify-live-supabase.ts`).
- ✅ Service role never in the browser: server-only env module; no `NEXT_PUBLIC_` secrets; secrets scan clean.

## Product
- ✅ 104 catalog items · ✅ families and foundations metadata · ✅ maturity labels (READY evidence enforced) · ✅ search and filter · ✅ configurator · ✅ custom intake (storage needs the DB).

## Security
- ✅ SHIELD baseline (profiles, action firewall, blast radius, injection handling, guards).
- ✅ Public abuse controls: honeypot, per-IP and per-email rate limits (⚠️ F-005).
- ✅ Rate limiting · ✅ secrets scan (0 findings) · ✅ dependency scan (0 vulnerabilities) · ✅ security headers (⚠️ F-003).
- ✅ RED CLAW critical suite: all 16 SECURITY.md categories, at least 2 cases each, mutation-checked.
- ✅ Cross-tenant isolation (DB, secret broker, tool broker, runtime handles).
- ✅ Audited owner actions (same-transaction audit; append-only log).

## Provisioning
- ✅ Disabled by default · ✅ adapter interface · ✅ OpenClaw adapter validated against real OpenClaw cells, 14/14 (`scripts/verify-live-openclaw.ts`).
- ✅ Duplicate, failure, resume, export, destroy, health and cost tests pass against both the fake and the real controller. ⚠️ Cells have no model egress yet (F-006a).

## Billing
- ✅ Disabled by default · ✅ webhook idempotency (FLOW dedupe plus signature and replay window) · ❌ subscription reconciliation (F-008).
- ✅ No activation before payment policy: FLOW 01 requires a webhook-confirmed, owner-approved payment before provisioning; DB triggers enforce it.

## Recovery
- ❌ Backup (platform PITR) · ❌ restore test on the real platform (F-009).
- ⚠️ Tenant logical backup/restore round-trip test passes.
- ✅ Export (customer JSON, RLS-scoped; cell export via adapter) · ✅ deletion (request → owner completion).

## FLOW 01
- ✅ Checkpoint persistence · ✅ kill/restart (real `SIGKILL`, three scenarios) · ✅ duplicate event · ✅ approval/rejection · ✅ validation failure · ✅ provisioning failure (resume and compensation) · ✅ acceptance failure blocks ACTIVE (engine and DB trigger).

## Launch
- ❌ Support, privacy, terms and security contact (drafts and placeholders, F-014) · ❌ monitoring and error alerting (F-015) · ❌ domain and TLS (F-015) · ❌ independent verification.

## Release gates for READY (SECURITY.md)
dependency_scan ✅ · secrets_scan ✅ · rls_isolation ✅ (live) · redclaw_critical ✅ · backup_restore ❌ (platform PITR drill) · admin_authorization ⚠️ (server-side checks live; owner MFA and a signed-in e2e still open) · public_abuse_controls ✅ · runtime_isolation ⚠️ (per-cell containers verified; shared host, no egress policy). **READY is blocked.**
