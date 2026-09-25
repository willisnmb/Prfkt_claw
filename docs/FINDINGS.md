# Findings register

Open items discovered while building. **Blocker** = must be resolved before any READY claim or production launch.

| ID | Severity | Finding | Owner action / next step |
|---|---|---|---|
| F-001 | High | **Partly resolved.** Supabase project `prfkt-claw` is connected; migrations and seed are applied. `scripts/verify-live-supabase.ts` passed 21/21 isolation checks live. Still open: signed-in owner and customer browser flows have not been run end to end by an automated test, and Supabase's default mailer only delivers to org members at a low rate. | Configure custom SMTP. Add signed-in Playwright flows against a staging project. |
| F-002 | Blocker | Owner MFA (AAL2) is not enforced. The admin Security page states this. | Enable Supabase MFA and require `aal2` in `requireOwner`. |
| F-003 | Medium | Static CSP allows `'unsafe-inline'` scripts, because a nonce CSP forces every page to render dynamically. | Decide on the trade-off. If accepted, move to a nonce CSP in `src/proxy.ts`. |
| F-004 | Medium | The SSRF guard checks DNS answers, but a rebinding race between check and connect is possible. | Enforce the cell's egress allowlist at the network layer (cell-controller requirement 2). |
| F-005 | Medium | Rate limits key on `x-forwarded-for`, which is only trustworthy behind a proxy that overwrites it. | Deploy behind a trusted proxy/CDN and document the header, or use the platform's client-IP API. |
| F-006 | High | **Partly resolved.** The OpenClaw adapter is validated 14/14 against real OpenClaw cells via `services/cell-controller` on `joevps`. Still open: (a) cells have no network, so they cannot reach any model until a per-cell egress allowlist exists (e.g. only the host Ollama or a provider proxy); (b) the controller runs as a user in the `docker` group, which is root-equivalent on that host; (c) the host is shared with many live services and capped at 3 cells; (d) the app's `PROVISIONING_ENABLED` is still false and the dashboard does not yet call the adapter. | Add egress policy (a network namespace with an nftables allowlist, or a model-proxy sidecar); move cells to a dedicated host; wire provisioning jobs to the adapter behind the flag. |
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
| F-019 | Medium | OpenClaw loads its default plugin set in cells, including browser and computer-use. The network is off, but the SAFE profile should disable them in cell config. | Write a SAFE `openclaw.json` into each cell at provision time and add a check against `openclaw security audit`. |
| F-020 | Low | Cell boot takes about 55–65 s at 0.5 vCPU, and the event loop reports "degraded" during startup. | Size cells at 1 vCPU for production, or pre-warm. |
| F-021 | Low | The `joevps` disk is 84% used (the cell image added about 1 GB). | Prune old images, or use a dedicated cell host. |
| F-022 | Info | Credentials for Supabase (personal access token), `joe-openclaw` and `joevps` were shared in chat. | Rotate all three; switch both servers to SSH keys. |

