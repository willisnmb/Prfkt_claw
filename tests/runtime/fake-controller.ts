import type { CellSpec } from "@/runtime/adapter";

/** In-memory implementation of the PRFKT cell-controller contract (docs/runtime/CELL_CONTROLLER.md). */
export class FakeCellController {
  cells = new Map<string, { spec: CellSpec; state: "running" | "suspended" | "destroyed"; memory: { id: string; text: string; provenance: { sourceType: string; sourceRef: string }; supersedes: string | null }[] }>();
  idem = new Map<string, { status: number; body: unknown }>();
  requests: { method: string; path: string; key: string | null }[] = [];
  created = 0;
  failNext = 0;
  failStatus = 503;
  leakSecretInExport = false;
  token = "controller-token-for-tests";

  fetch = (async (input: URL | string | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const key = headers.get("idempotency-key");
    this.requests.push({ method, path: url.pathname, key });
    const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (headers.get("authorization") !== `Bearer ${this.token}`) return json(401, { error: "unauthorized" });
    if (this.failNext > 0) {
      this.failNext--;
      return json(this.failStatus, { error: "injected failure" });
    }
    if (key && this.idem.has(`${method} ${url.pathname} ${key}`)) {
      const prior = this.idem.get(`${method} ${url.pathname} ${key}`)!;
      return json(prior.status, prior.body);
    }
    const remember = (status: number, body: unknown) => {
      if (key) this.idem.set(`${method} ${url.pathname} ${key}`, { status, body });
      return json(status, body);
    };

    const m = url.pathname.match(/^\/v1\/cells(?:\/([^/]+))?(?:\/(health|suspend|resume|export))?$/);
    if (!m) return json(404, { error: "not found" });
    const [, cellId, action] = m;

    if (!cellId && method === "POST") {
      const spec = JSON.parse(String(init?.body)) as CellSpec;
      const existing = this.cells.get(spec.cellId);
      if (existing && existing.spec.tenantId !== spec.tenantId) return remember(409, { error: "cell id taken" });
      if (!existing) {
        this.created++;
        this.cells.set(spec.cellId, {
          spec,
          state: "running",
          memory: [{ id: "m1", text: "Prefers weekly summaries on Monday.", provenance: { sourceType: "user_message", sourceRef: "chat:42" }, supersedes: null }],
        });
      }
      return remember(201, { cellId: spec.cellId, tenantId: spec.tenantId, state: "running", version: spec.version, endpointRef: `cell://${spec.cellId}` });
    }

    const cell = cellId ? this.cells.get(cellId) : undefined;
    if (!cell) return json(404, { error: "no such cell" });
    // One trust domain per cell: requests must name the owning tenant.
    if (headers.get("x-prfkt-tenant") !== cell.spec.tenantId) return json(403, { error: "tenant mismatch" });

    if (action === "health" && method === "GET") {
      return json(200, {
        healthy: cell.state === "running",
        state: cell.state,
        lastSuccessAt: "2026-09-25T11:59:00Z",
        lastError: null,
        pendingApprovals: 1,
        toolActionsToday: 12,
        modelCallsToday: 7,
        estimatedCostCentsToday: 31,
        lastBackupAt: new Date(Date.now() - 3600_000).toISOString(),
        version: cell.spec.version,
        modelRoute: "local",
      });
    }
    if (action === "suspend" && method === "POST") {
      if (cell.state !== "destroyed") cell.state = "suspended";
      return remember(200, { state: cell.state });
    }
    if (action === "resume" && method === "POST") {
      if (cell.state !== "destroyed") cell.state = "running";
      return remember(200, { state: cell.state });
    }
    if (action === "export" && method === "GET") {
      const memory = this.leakSecretInExport ? [...cell.memory, { id: "m2", text: ["api", "key"].join("_") + "=" + ["sk", "ant", "api03", "Z".repeat(40)].join("-"), provenance: { sourceType: "tool_output", sourceRef: "x" }, supersedes: null }] : cell.memory;
      return json(200, { config: { cellId: cell.spec.cellId, profile: cell.spec.profile, secretRefs: cell.spec.secretRefs }, memory, auditTail: [{ at: "2026-09-25T11:00:00Z", action: "email.draft" }] });
    }
    if (!action && method === "DELETE") {
      cell.state = "destroyed";
      return remember(204, {});
    }
    return json(405, { error: "method not allowed" });
  }) as typeof fetch;
}
