# PRFKT cell-controller contract (v1)

The control plane never talks to a runtime directly. Each customer trust domain gets **one isolated runtime cell**, and each cell is managed through a *cell controller* that implements this HTTP contract. `src/runtime/openclaw.ts` is the client. `tests/runtime/fake-controller.ts` is the reference fake the adapter is validated against.

**Status:** reference implementation in `services/cell-controller/` (dependency-free, Node >= 23.6). It is deployed on the `joevps` host (Tailscale-only, bearer token, systemd). `scripts/verify-live-openclaw.ts` passed 14/14 against real OpenClaw 2026.9.4 cells on 2026-09-25.

Each cell is a container with `--network none`, a read-only root, all capabilities dropped, `no-new-privileges`, memory, CPU and PID limits, a non-root user, separate state and backup volumes, and a per-cell gateway token in a `0600` env file that is never returned by the API.

## Transport and authentication

- HTTPS, except plain HTTP on loopback or the Tailscale range 100.64.0.0/10, where WireGuard encrypts traffic end to end. The reference controller binds only to its Tailscale IP.
- `Authorization: Bearer <controller token>`. The token is resolved per call from a `secret://` reference through the secret broker, and is never stored in configuration, prompts or logs.
- `x-prfkt-tenant: <tenant uuid>` on every per-cell call. The controller must refuse (403) when it doesn't match the cell's tenant.
- `idempotency-key` on every mutating call. The controller must return the original response for a repeated key.

## Endpoints

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/cells` | Provision a cell from a `CellSpec` (`src/runtime/adapter.ts`) | Idempotent on key and on `cellId`. 409 if `cellId` exists for another tenant |
| GET | `/v1/cells/{cellId}/health` | Observability snapshot | Fields: healthy, state, lastSuccessAt, lastError, pendingApprovals, toolActionsToday, modelCallsToday, estimatedCostCentsToday, lastBackupAt, version, modelRoute |
| POST | `/v1/cells/{cellId}/suspend` | Stop work, keep state | Idempotent |
| POST | `/v1/cells/{cellId}/resume` | Resume a suspended cell | Idempotent |
| GET | `/v1/cells/{cellId}/export` | Customer export: config (secret references only), memory with provenance and corrections, audit tail | Must never contain secret values; the adapter refuses exports that do |
| DELETE | `/v1/cells/{cellId}` | Destroy the cell and its data | Idempotent. The adapter requires a prior export and a repeated cell id |

5xx and 429 are retried by the adapter (at most 3 attempts). Other 4xx responses are not retried.

## Isolation requirements (SECURITY.md, ARCHITECTURE.md)

1. One cell per customer trust domain. Never a shared OpenClaw gateway for unrelated customers.
2. Cell egress is limited to `CellSpec.egressAllowlist`, enforced at the network layer, not only in application code.
3. Secrets are injected by the broker at call time. The cell's configuration holds only `secret://<tenant>/<name>` references.
4. The SAFE profile gets no shell, no gateway admin, no secret reads, and draft-only or approval-gated external actions.
5. Provision, suspend, resume and destroy are disabled while `PROVISIONING_ENABLED=false`.
