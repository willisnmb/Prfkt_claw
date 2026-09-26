import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalSummary, FlowStateRail, MetricsGrid, ResumeStatus } from "@/components/flows/flow-views";
import { getRunDetail } from "@/flow/flow01/queries";
import { harness, newRun, type Harness } from "./support";

let h: Harness;
beforeEach(async () => {
  h = await harness();
  // admin_audit_log exists via the control-plane migration; queries read it.
});
afterEach(() => h.db.close());

describe("FLOW 01 owner console views render real run data", () => {
  it("renders state rail, pending approval, resume status and metrics for a run waiting on approval", async () => {
    const e = h.engine();
    const wf = await newRun(h, e);
    await e.advance(wf);
    const d = (await getRunDetail(h.sql, wf))!;
    const visited = new Set(d.events.filter((x) => x.type === "transition").flatMap((x) => [x.from_state ?? "", x.to_state ?? ""]));
    const pending = d.approvals.find((a) => a.status === "pending")!;

    const rail = renderToStaticMarkup(<FlowStateRail run={d.run} visited={visited} />);
    expect(rail).toContain('aria-current="step"');
    expect(rail).toMatch(/waiting for approval<span class="sr-only"> \(current\)/);
    expect(rail).toMatch(/research complete<span class="sr-only"> \(done\)/);

    const approval = renderToStaticMarkup(<ApprovalSummary approval={pending} />);
    expect(approval).toContain("Send proposal to the lead");
    expect(approval).toContain("dana@northwind.test");
    expect(approval).toContain(pending.payloadHash);

    const resume = renderToStaticMarkup(<ResumeStatus run={d.run} now={h.clock.now} maxRetries={3} />);
    expect(resume).toContain("none (idle)");
    expect(resume).toContain("0 / 3");

    const metrics = renderToStaticMarkup(<MetricsGrid run={d.run} now={h.clock.now} />);
    for (const label of ["Duration", "Active compute", "Model calls", "Tokens in / out", "Estimated cost", "Retries", "Approvals", "Failures", "Recoveries", "Duplicates suppressed"]) {
      expect(metrics).toContain(label);
    }
    expect(metrics).toContain("1,200 / 300");
    expect(metrics).toContain("$0.0042");
  });
});
