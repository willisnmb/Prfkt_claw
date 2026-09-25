import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * FLOW 01 "Done" criterion (PRFKT_FLOW_01.md): an intentional process
 * termination resumes from persisted state without duplicating completed side
 * effects. These tests run the engine in real child processes on an on-disk
 * database and terminate them with SIGKILL — no in-process simulation.
 */

interface Msg {
  event: string;
  [k: string]: unknown;
}

interface ChildResult {
  messages: Msg[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

const HARNESS = join(process.cwd(), "scripts", "flow01-harness.ts");

function run(dataDir: string, actions: unknown[], env: Record<string, string> = {}, opts: { killOn?: string } = {}): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", HARNESS], {
      env: { ...process.env, FLOW_DATA_DIR: dataDir, FLOW_ACTIONS: JSON.stringify(actions), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const messages: Msg[] = [];
    let buf = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.startsWith("@@")) continue;
        const msg = JSON.parse(line.slice(2)) as Msg;
        messages.push(msg);
        // Intentional external termination.
        if (opts.killOn && msg.event === opts.killOn) child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ messages, code, signal, stderr }));
  });
}

const last = (r: ChildResult, event: string) => {
  const m = r.messages.filter((x) => x.event === event).at(-1);
  if (!m) throw new Error(`no ${event} message; got ${JSON.stringify(r.messages)}\n${r.stderr}`);
  return m;
};

let base: string;
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "flow01-kill-"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("FLOW 01 process termination (SIGKILL) and resume", () => {
  it("kill at WAITING_FOR_APPROVAL → restart → resume without re-running completed steps", async () => {
    const dir = join(base, "waiting");

    const p1 = await run(dir, [{ op: "create" }, { op: "advance" }, { op: "hold" }], { FLOW_WORKER: "proc-1" }, { killOn: "holding" });
    expect(p1.signal).toBe("SIGKILL");
    expect(last(p1, "advanced")).toMatchObject({ state: "WAITING_FOR_APPROVAL", status: "waiting_approval" });

    const before = last(await run(dir, [{ op: "inspect" }]), "inspect");
    expect(before).toMatchObject({ state: "WAITING_FOR_APPROVAL", outbox: 0, calls: { research: 1 } });

    const p2 = await run(dir, [{ op: "approve", kind: "PROPOSAL_SEND" }, { op: "advance" }, { op: "inspect" }], { FLOW_WORKER: "proc-2" });
    expect(p2.code).toBe(0);
    const after = last(p2, "inspect");
    expect(after.state).toBe("WAITING_FOR_REPLY");
    expect(after.calls).toMatchObject({ research: 1, emailSend: 1 }); // research not re-run
    expect(after.outbox).toBe(1);
    for (const s of ["SOURCE_VERIFICATION", "RESEARCH", "RESEARCH_COMPLETE", "QUALIFICATION_REVIEW", "QUALIFIED", "PROPOSAL_DRAFT", "WAITING_FOR_APPROVAL", "APPROVED_FOR_SEND", "SEND_REQUESTED", "SENT"]) {
      expect((after.transitions as Record<string, number>)[s], s).toBe(1);
    }
  }, 90_000);

  it("SIGKILL mid side-effect (after the provider sent, before the ledger committed) resumes with exactly one send", async () => {
    const dir = join(base, "mid-send");
    await run(dir, [{ op: "create" }, { op: "advance" }, { op: "approve", kind: "PROPOSAL_SEND" }]);

    const p = await run(dir, [{ op: "advance" }], { FLOW_WORKER: "proc-crash", FLOW_CRASH_AFTER: "email:send", FLOW_LEASE_MS: "1500" });
    expect(p.signal).toBe("SIGKILL");
    expect(last(p, "self_kill").reason).toBe("after email:send");

    const mid = last(await run(dir, [{ op: "inspect" }]), "inspect");
    expect(mid).toMatchObject({ state: "SEND_REQUESTED", leaseOwner: "proc-crash", outbox: 1 });
    expect(mid.sideEffects).toContainEqual({ op: "email:send", status: "started", attempts: 1 });

    const r = await run(dir, [{ op: "advance" }, { op: "inspect" }], { FLOW_WORKER: "proc-resume" });
    expect(r.code).toBe(0);
    const after = last(r, "inspect");
    expect(after.state).toBe("WAITING_FOR_REPLY");
    expect(after.outbox).toBe(1); // no duplicate email
    expect(after.calls).toMatchObject({ emailSend: 2 }); // retried with the same key; provider deduped
    expect(after.sideEffects).toContainEqual({ op: "email:send", status: "succeeded", attempts: 2 });
    expect((after.transitions as Record<string, number>).SENT).toBe(1);
    expect(after.recovered).toBe(1);
    expect((after.metrics as { recoveryCount: number }).recoveryCount).toBe(1);
  }, 90_000);

  it("full Lead-to-Customer run survives kills during invoicing and provisioning and reaches ACTIVE exactly once", async () => {
    const dir = join(base, "full");
    const faults = JSON.stringify({ provisioner: { transientFailures: 0 } });
    await run(dir, [{ op: "create" }, { op: "advance" }, { op: "approve", kind: "PROPOSAL_SEND" }, { op: "advance" }, { op: "webhook", type: "reply" }], { FLOW_FAULTS: faults });

    const k1 = await run(dir, [{ op: "advance" }], { FLOW_WORKER: "k1", FLOW_CRASH_AFTER: "payment:createInvoice", FLOW_FAULTS: faults });
    expect(k1.signal).toBe("SIGKILL");

    await run(dir, [{ op: "advance" }, { op: "webhook", type: "payment" }, { op: "advance" }, { op: "approve", kind: "PAYMENT" }, { op: "advance" }, { op: "approve", kind: "PROVISIONING" }], { FLOW_WORKER: "k2", FLOW_FAULTS: faults });

    const k3 = await run(dir, [{ op: "advance" }], { FLOW_WORKER: "k3", FLOW_CRASH_AFTER: "provisioner:provision", FLOW_FAULTS: faults });
    expect(k3.signal).toBe("SIGKILL");

    const fin = await run(dir, [{ op: "advance" }, { op: "approve", kind: "PRODUCTION_ACTIVATION" }, { op: "advance" }, { op: "webhook", type: "payment" }, { op: "inspect" }], { FLOW_WORKER: "k4", FLOW_FAULTS: faults });
    expect(fin.code).toBe(0);
    const s = last(fin, "inspect");
    expect(s).toMatchObject({ state: "ACTIVE", status: "completed", outbox: 1, invoices: 1, resources: 5 });
    expect((s.transitions as Record<string, number>).ACTIVE).toBe(1);
    expect(s.calls).toMatchObject({ research: 1, emailSend: 1, createInvoice: 2, provision: 2 });
    expect(s.recovered).toBe(2);
    expect((s.metrics as { duplicatesSuppressed: number }).duplicatesSuppressed).toBe(1);
  }, 120_000);
});
