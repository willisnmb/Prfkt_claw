/**
 * PRFKT cell controller (docs/runtime/CELL_CONTROLLER.md, v1) for OpenClaw.
 *
 * One Docker container per customer trust domain:
 *   --network none, --read-only, --cap-drop ALL, no-new-privileges,
 *   memory/cpu/pids limits, non-root user, per-cell state volume,
 *   per-cell gateway token (env file, 0600) never returned by the API.
 *
 * Dependency-free; run directly with Node >= 23.6 (type stripping):
 *   node controller.ts
 * Configuration comes from the environment (see controller.env.example).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const BIND = env.CONTROLLER_BIND ?? "127.0.0.1";
const PORT = Number(env.CONTROLLER_PORT ?? 18950);
const TOKEN = (env.CONTROLLER_TOKEN ?? "").trim();
const STATE_DIR = env.CONTROLLER_STATE_DIR ?? join(env.HOME ?? ".", ".prfkt-cell-controller");
const IMAGE = env.CELL_IMAGE ?? "prfkt-openclaw-cell:2026.9.4";
const MEMORY = env.CELL_MEMORY ?? "512m";
const CPUS = env.CELL_CPUS ?? "0.5";
const MAX_CELLS = Number(env.MAX_CELLS ?? 3);
const HOST_LABEL = env.CONTROLLER_HOST_LABEL ?? "cell-host";

if (TOKEN.length < 32) {
  console.error("CONTROLLER_TOKEN must be set (>= 32 chars)");
  process.exit(1);
}

type CellState = "provisioning" | "running" | "suspended" | "destroyed";
interface CellRecord {
  cellId: string;
  tenantId: string;
  spec: Record<string, unknown>;
  state: CellState;
  version: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastBackupAt: string | null;
  lastBackupError?: string | null;
}
interface Stored {
  cells: Record<string, CellRecord>;
  idempotency: Record<string, { requestHash: string; status: number; body: unknown }>;
}

mkdirSync(join(STATE_DIR, "cells"), { recursive: true, mode: 0o700 });
const STATE_FILE = join(STATE_DIR, "state.json");
const db: Stored = existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as Stored) : { cells: {}, idempotency: {} };
function persist() {
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(tmp, STATE_FILE);
}

// One request at a time: docker operations on the same cell must not interleave.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CELL_ID = /^cell-[a-z0-9-]{4,60}$/;
const SECRET_REF = /^secret:\/\/([0-9a-f-]{36})\/[a-z0-9][a-z0-9_.-]{0,63}$/;
const container = (id: string) => `prfkt-${id}`;
const volume = (id: string) => `prfkt-${id}-state`;
const backupVolume = (id: string) => `prfkt-${id}-backups`;
const envFile = (id: string) => join(STATE_DIR, "cells", `${id}.env`);

function validateSpec(spec: Record<string, unknown>): string[] {
  const p: string[] = [];
  if (typeof spec.tenantId !== "string" || !UUID.test(spec.tenantId)) p.push("tenantId");
  if (typeof spec.cellId !== "string" || !CELL_ID.test(spec.cellId)) p.push("cellId");
  if (spec.runtime !== "openclaw") p.push("runtime must be openclaw");
  if (spec.profile !== "SAFE" && spec.profile !== "OPERATOR") p.push("profile must be SAFE or OPERATOR");
  const refs = spec.secretRefs;
  if (refs && typeof refs === "object") {
    for (const [k, v] of Object.entries(refs as Record<string, unknown>)) {
      const m = typeof v === "string" ? SECRET_REF.exec(v) : null;
      if (!m || m[1] !== spec.tenantId) p.push(`secretRefs.${k}`);
    }
  }
  return p;
}

async function waitHealthy(id: string, timeoutMs = 90_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await run("docker", ["exec", container(id), "openclaw", "health", "--json", "--timeout", "5000"], 20_000);
    if (r.code === 0) {
      try {
        if ((JSON.parse(r.stdout) as { ok?: boolean }).ok) return true;
      } catch {
        /* not ready */
      }
    }
    await new Promise((res) => setTimeout(res, 2_000));
  }
  return false;
}

async function provision(spec: Record<string, unknown>): Promise<[number, unknown]> {
  const problems = validateSpec(spec);
  if (problems.length) return [400, { error: "invalid spec", problems }];
  const cellId = spec.cellId as string;
  const tenantId = spec.tenantId as string;
  const existing = db.cells[cellId];
  if (existing && existing.tenantId !== tenantId) return [409, { error: "cell id taken" }];
  if (existing && existing.state !== "destroyed") return [201, view(existing)];
  const active = Object.values(db.cells).filter((c) => c.state !== "destroyed").length;
  if (active >= MAX_CELLS) return [409, { error: "cell host at capacity" }];

  const rec: CellRecord = {
    cellId,
    tenantId,
    spec,
    state: "provisioning",
    version: null,
    createdAt: new Date().toISOString(),
    lastSuccessAt: null,
    lastError: null,
    lastBackupAt: null,
  };
  db.cells[cellId] = rec;
  persist();

  writeFileSync(envFile(cellId), `OPENCLAW_GATEWAY_TOKEN=${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  const labels = ["--label", `prfkt.cell=${cellId}`, "--label", `prfkt.tenant=${tenantId}`];
  await run("docker", ["volume", "create", ...labels, volume(cellId)]);
  await run("docker", ["volume", "create", ...labels, backupVolume(cellId)]);
  await run("docker", ["rm", "-f", container(cellId)]);
  const r = await run("docker", [
    "run", "-d", "--name", container(cellId), ...labels,
    "--restart", "unless-stopped",
    "--network", "none",
    "--memory", MEMORY, "--memory-swap", MEMORY, "--cpus", CPUS, "--pids-limit", "256",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    // tmpfs mounts are recreated on every start: give them explicit ownership, or
    // OpenClaw cannot create its temp dir after a restart and crash-loops.
    // /tmp must exceed OpenClaw's 256 MiB backup-verification reserve (tmpfs
    // only consumes memory for data actually written, within --memory).
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=320m,mode=1777",
    "--tmpfs", "/home/node/.npm:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700",
    "--tmpfs", "/home/node/.cache:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700",
    "--env-file", envFile(cellId),
    "-v", `${volume(cellId)}:/home/node/.openclaw`,
    "-v", `${backupVolume(cellId)}:/home/node/backups`,
    IMAGE, "gateway", "run", "--allow-unconfigured", "--auth", "token", "--bind", "loopback",
  ]);
  if (r.code !== 0) {
    rec.state = "destroyed";
    rec.lastError = `docker run failed: ${r.stderr.trim().slice(0, 300)}`;
    persist();
    return [503, { error: "provisioning failed" }];
  }
  const healthy = await waitHealthy(cellId);
  const v = await run("docker", ["exec", container(cellId), "openclaw", "--version"]);
  rec.version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? null;
  rec.state = "running";
  if (healthy) rec.lastSuccessAt = new Date().toISOString();
  else rec.lastError = "gateway did not report healthy within 90s";
  persist();
  return [201, view(rec)];
}

function view(c: CellRecord) {
  return { cellId: c.cellId, tenantId: c.tenantId, state: c.state, version: c.version, endpointRef: `cell://${HOST_LABEL}/${c.cellId}` };
}

function modelRoute(policy: unknown): string | null {
  if (policy === "local-only" || policy === "local-first") return "local";
  if (policy === "customer-provider") return "customer-provider";
  if (typeof policy === "string") return "managed-provider";
  return null;
}

async function health(c: CellRecord): Promise<[number, unknown]> {
  const inspect = await run("docker", ["inspect", "-f", "{{.State.Status}}", container(c.cellId)]);
  const status = inspect.stdout.trim();
  let healthy = false;
  let degraded: string[] = [];
  if (c.state !== "destroyed" && status === "running") {
    const r = await run("docker", ["exec", container(c.cellId), "openclaw", "health", "--json", "--timeout", "8000"], 20_000);
    try {
      const h = JSON.parse(r.stdout) as { ok?: boolean; eventLoop?: { degraded?: boolean; reasons?: string[] } };
      healthy = h.ok === true;
      if (h.eventLoop?.degraded) degraded = h.eventLoop.reasons ?? ["event_loop"];
      if (healthy) c.lastSuccessAt = new Date().toISOString();
      else c.lastError = "gateway health not ok";
    } catch {
      c.lastError = `health unreadable: ${(r.stderr || r.stdout).trim().slice(0, 200)}`;
    }
  }
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  let toolActionsToday = 0;
  let modelCallsToday = 0;
  if (healthy) {
    const a = await run("docker", ["exec", container(c.cellId), "openclaw", "audit", "--json", "--limit", "500", "--after", String(today)]);
    try {
      const events = (JSON.parse(a.stdout) as { events?: { kind?: string }[] }).events ?? [];
      toolActionsToday = events.filter((e) => e.kind === "tool_action").length;
      modelCallsToday = events.filter((e) => e.kind === "agent_run").length;
    } catch {
      /* leave zero */
    }
  }
  persist();
  return [
    200,
    {
      healthy,
      state: c.state === "destroyed" ? "destroyed" : status === "running" ? "running" : c.state === "provisioning" ? "provisioning" : "suspended",
      lastSuccessAt: c.lastSuccessAt,
      lastError: degraded.length ? `degraded: ${degraded.join(", ")}` : c.lastError,
      pendingApprovals: 0,
      toolActionsToday,
      modelCallsToday,
      // No outbound network in this cell: no provider calls can be billed.
      estimatedCostCentsToday: 0,
      lastBackupAt: c.lastBackupAt,
      version: c.version,
      modelRoute: modelRoute(c.spec.modelPolicy),
    },
  ];
}

async function exportCell(c: CellRecord): Promise<[number, unknown]> {
  if (c.state === "destroyed") return [410, { error: "cell destroyed" }];
  const wasStopped = c.state === "suspended";
  if (wasStopped) await run("docker", ["start", container(c.cellId)]);
  // Verified OpenClaw backup archive on the cell's own backup volume (includes its credentials; never returned).
  const b = await run("docker", ["exec", container(c.cellId), "openclaw", "backup", "create", "--output", "/home/node/backups", "--verify", "--json"], 180_000);
  if (b.code === 0) {
    c.lastBackupAt = new Date().toISOString();
    c.lastBackupError = null;
  } else {
    c.lastBackupError = `exit ${b.code}: ${(b.stderr + b.stdout).replace(/\s+/g, " ").trim().slice(-300)}`;
  }
  const mem = await run("docker", ["exec", container(c.cellId), "sh", "-c", "cat /home/node/.openclaw/workspace/MEMORY.md 2>/dev/null || true"]);
  const memory = mem.stdout
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter((x) => x.line && !x.line.startsWith("#"))
    .map((x) => ({ id: `memory-md-${x.n}`, text: x.line, provenance: { sourceType: "openclaw-memory-file", sourceRef: `MEMORY.md#L${x.n}` }, supersedes: null }));
  const a = await run("docker", ["exec", container(c.cellId), "openclaw", "audit", "--json", "--limit", "50"]);
  let auditTail: { at: string; action: string }[] = [];
  try {
    auditTail = ((JSON.parse(a.stdout) as { events?: { ts?: number | string; kind?: string }[] }).events ?? []).map((e) => ({
      at: new Date(e.ts ?? Date.now()).toISOString(),
      action: e.kind ?? "event",
    }));
  } catch {
    /* none */
  }
  if (wasStopped) await run("docker", ["stop", container(c.cellId)]);
  persist();
  const s = c.spec;
  return [
    200,
    {
      config: {
        cellId: c.cellId,
        runtime: "openclaw",
        version: c.version,
        profile: s.profile,
        modelPolicy: s.modelPolicy,
        compute: s.compute,
        toolAllowlist: s.toolAllowlist,
        limits: s.limits,
        egressAllowlist: s.egressAllowlist,
        secretRefs: s.secretRefs,
        backup: { lastVerifiedAt: c.lastBackupAt, lastError: c.lastBackupError ?? null, location: "cell backup volume" },
      },
      memory,
      auditTail,
    },
  ];
}

async function route(method: string, path: string, headers: IncomingMessage["headers"], body: unknown): Promise<[number, unknown]> {
  if (method === "GET" && path === "/v1/health") return [200, { ok: true, cells: Object.values(db.cells).filter((c) => c.state !== "destroyed").length, maxCells: MAX_CELLS }];
  if (method === "POST" && path === "/v1/cells") return provision((body ?? {}) as Record<string, unknown>);

  const m = /^\/v1\/cells\/([^/]+)(?:\/(health|suspend|resume|export))?$/.exec(path);
  if (!m) return [404, { error: "not found" }];
  const [, cellId, action] = m;
  if (!CELL_ID.test(cellId!)) return [404, { error: "not found" }];
  const c = db.cells[cellId!];
  if (!c) return [404, { error: "no such cell" }];
  if (headers["x-prfkt-tenant"] !== c.tenantId) return [403, { error: "tenant mismatch" }];

  if (method === "GET" && action === "health") return health(c);
  if (method === "GET" && action === "export") return exportCell(c);
  if (method === "POST" && action === "suspend") {
    if (c.state === "running") {
      await run("docker", ["stop", container(c.cellId)]);
      c.state = "suspended";
      persist();
    }
    return [200, { state: c.state }];
  }
  if (method === "POST" && action === "resume") {
    if (c.state === "suspended") {
      await run("docker", ["start", container(c.cellId)]);
      c.state = "running";
      if (await waitHealthy(c.cellId)) c.lastSuccessAt = new Date().toISOString();
      persist();
    }
    return [200, { state: c.state }];
  }
  if (method === "DELETE" && !action) {
    await run("docker", ["rm", "-f", container(c.cellId)]);
    await run("docker", ["volume", "rm", "-f", volume(c.cellId)]);
    await run("docker", ["volume", "rm", "-f", backupVolume(c.cellId)]);
    rmSync(envFile(c.cellId), { force: true });
    c.state = "destroyed";
    persist();
    return [204, {}];
  }
  return [405, { error: "method not allowed" }];
}

function authorized(req: IncomingMessage): boolean {
  const h = req.headers.authorization ?? "";
  const given = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
  const want = Buffer.from(TOKEN);
  return given.length === want.length && timingSafeEqual(given, want);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

createServer((req, res) => {
  let size = 0;
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > 64 * 1024) req.destroy();
    else chunks.push(c);
  });
  req.on("end", () => {
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://x").pathname;
    let body: unknown;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    const key = typeof req.headers["idempotency-key"] === "string" ? `${method} ${path} ${req.headers["idempotency-key"]}` : null;
    const requestHash = createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
    serial(async () => {
      if (key && db.idempotency[key]) {
        const prior = db.idempotency[key]!;
        if (prior.requestHash !== requestHash) return [422, { error: "idempotency key reused with a different request" }] as [number, unknown];
        return [prior.status, prior.body] as [number, unknown];
      }
      const [status, out] = await route(method, path, req.headers, body);
      if (key && status < 500) {
        db.idempotency[key] = { requestHash, status, body: out };
        persist();
      }
      return [status, out] as [number, unknown];
    })
      .then(([s, b]) => send(res, s, b))
      .catch((e: unknown) => {
        console.error(e);
        send(res, 500, { error: "internal error" });
      });
  });
}).listen(PORT, BIND, () => console.log(`prfkt-cell-controller listening on ${BIND}:${PORT} (max ${MAX_CELLS} cells, image ${IMAGE})`));

// Keep state consistent if a cell container disappeared while we were down.
void serial(async () => {
  for (const c of Object.values(db.cells)) {
    if (c.state === "destroyed") continue;
    const r = await run("docker", ["inspect", "-f", "{{.State.Status}}", container(c.cellId)]);
    if (r.code !== 0) {
      c.lastError = "container missing on controller start";
      c.state = "suspended";
    }
  }
  persist();
});
