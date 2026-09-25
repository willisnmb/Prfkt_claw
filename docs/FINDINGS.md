# Findings register

Open items discovered while building. **Blocker** = must be resolved before any READY claim or production launch.

| ID | Severity | Finding | Owner action / next step |
|---|---|---|---|
| F-001 | Blocker | No Supabase project in this environment. Sign-in, the customer dashboard and the owner console have never run against real Supabase Auth or Postgres. RLS was verified on PGlite with a stub of the Supabase platform (`supabase/test/supabase-platform-stub.sql`: roles, `auth.uid()` from `request.jwt.claims`, default grants). | Provide a Supabase project and env vars. Re-run the `tests/data` RLS suite against it (a CI job with the Supabase CLI) and add signed-in owner/customer Playwright flows. |
| F-002 | Blocker | Owner MFA (AAL2) is not enforced. The admin Security page states this. | Enable Supabase MFA and require `aal2` in `requireOwner`. |
| F-003 | Medium | Static CSP allows `'unsafe-inline'` scripts, because a nonce CSP forces every page to render dynamically. | Decide on the trade-off. If accepted, move to a nonce CSP in `src/proxy.ts`. |
| F-004 | Medium | The SSRF guard checks DNS answers, but a rebinding race between check and connect is possible. | Enforce the cell's egress allowlist at the network layer (cell-controller requirement 2). |
| F-005 | Medium | Rate limits key on `x-forwarded-for`, which is only trustworthy behind a proxy that overwrites it. | Deploy behind a trusted proxy/CDN and document the header, or use the platform's client-IP API. |
| F-006 | Blocker (provisioning) | The OpenClaw adapter is validated only against the fake cell controller. No real controller or OpenClaw deployment exists. | Build or deploy a cell controller per `docs/runtime/CELL_CONTROLLER.md`, then run the adapter contract tests against it. |
| F-007 | Medium | CrewAI, PydanticAI, ZeroClaw and NemoClaw have registry entries only; no adapters. LangGraph runs embedded (LangGraph.js) for FLOW 01, not as a per-customer Python runtime. | Implement adapters behind `RuntimeAdapter` as each family is productised. |
| F-008 | Blocker (billing) | No real payment provider. Subscription reconciliation is not implemented. `BILLING_ENABLED=false`. | Choose a provider, implement the adapter with idempotency keys and verified webhooks, and add reconciliation tests. |
| F-009 | Blocker | Backups: tenant logical backup/restore round-trips in PGlite, but no Supabase PITR or restore drill has been performed. | Enable PITR and run and record a restore drill (release gate `backup_restore`). |
| F-010 | Medium | Secret broker: the `SecretStore` interface exists with no vault behind it (Supabase Vault or a cloud KMS). | Wire a store; keep values out of prompts, memory and logs (already enforced by tests). |
| F-011 | Medium | FLOW 01 provisions the cell for the run's own tenant. Creating the new customer's tenant during provisioning is not modelled. | Model house tenant → customer tenant creation when real provisioning lands. |
| F-012 | Low | A step timeout (`Promise.race`) doesn't cancel the underlying adapter call. | Pass `AbortSignal` through the adapter ports. |
| F-013 | Low | The secrets detector is heuristic. Code-expression exclusions could miss a literal shaped like `password = a.bcdefgh`. | Add gitleaks (or similar) to CI alongside `scan:secrets`. |
| F-014 | Launch | Privacy and terms pages are drafts; support and security contacts are placeholders. | Legal review; set `NEXT_PUBLIC_SUPPORT_EMAIL` and `NEXT_PUBLIC_SECURITY_CONTACT`. |
| F-015 | Launch | No monitoring or error alerting. No domain or TLS configured. | Choose the error tracker and uptime checks; configure the domain. HSTS and `upgrade-insecure-requests` switch on automatically when `NEXT_PUBLIC_APP_URL` is https. |
| F-016 | Low | The Docker image was not built here (no Docker available). The standalone server it runs was built and smoke-tested with Node. | `docker build` in CI or on the host. |
| F-017 | Low | The keyboard-reachability e2e test is skipped on WebKit (Tab skips links without Option+Tab) and on touch profiles. It is covered on Chromium. | None, or add a WebKit-specific Option+Tab variant. |
| F-018 | Info | FLOW 01 is disabled in production by design until real email, payment and provisioning adapters pass acceptance. | Implement real adapters (F-006, F-008, email). |
