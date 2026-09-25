import { describe, expect, it } from "vitest";
import { AUTO_DEFAULT_INPUT, AutoInput, recommend } from "@/domain/auto";
import { MODEL_POLICIES } from "@/domain/registries";

/** Every combination of the eleven AUTO inputs: 2^5 * 4 * 3 * 3 * 3 * 4 * 3 = 41,472. */
function* allInputs(): Generator<AutoInput> {
  const bools = [false, true];
  const privacy = AutoInput.shape.privacy.options;
  const governance = AutoInput.shape.governance.options;
  const latency = AutoInput.shape.latency.options;
  const budget = AutoInput.shape.budget.options;
  const concurrency = AutoInput.shape.concurrency.options;
  const humanApproval = AutoInput.shape.humanApproval.options;
  for (const persistentConversation of bools)
    for (const explicitStates of bools)
      for (const multiAgentBenefit of bools)
        for (const strictSchema of bools)
          for (const edgeHardware of bools)
            for (const p of privacy)
              for (const g of governance)
                for (const l of latency)
                  for (const b of budget)
                    for (const c of concurrency)
                      for (const h of humanApproval)
                        yield {
                          persistentConversation,
                          explicitStates,
                          multiAgentBenefit,
                          strictSchema,
                          edgeHardware,
                          privacy: p,
                          governance: g,
                          latency: l,
                          budget: b,
                          concurrency: c,
                          humanApproval: h,
                        };
}

const GATED = ["SEND_EXTERNAL", "SPEND", "DELETE", "DEPLOY", "PUBLISH", "ADMIN"] as const;

describe("AUTO recommend()", () => {
  it("is deterministic", () => {
    expect(recommend(AUTO_DEFAULT_INPUT)).toEqual(recommend({ ...AUTO_DEFAULT_INPUT }));
  });

  it("rejects invalid input", () => {
    expect(() => recommend({ ...AUTO_DEFAULT_INPUT, privacy: "public" } as unknown as AutoInput)).toThrow();
  });

  it("air-gapped means local-only models, on-prem deployment and SECURE composition", () => {
    const r = recommend({ ...AUTO_DEFAULT_INPUT, privacy: "air-gapped" });
    expect(r.modelPolicy).toBe("local-only");
    expect(r.deployment).toBe("on-prem");
    expect(r.composition).toContain("SECURE");
  });

  it("edge hardware means EDGE on the lightweight runtime and customer hardware", () => {
    const r = recommend({ ...AUTO_DEFAULT_INPUT, edgeHardware: true });
    expect(r.family).toBe("EDGE");
    expect(r.runtime).toBe("zeroclaw");
    expect(r.compute).toBe("customer-hardware");
    expect(r.deployment).toBe("edge-device");
  });

  it("maps single strong signals to the expected family", () => {
    const none = { ...AUTO_DEFAULT_INPUT, persistentConversation: false, latency: "near-real-time" as const };
    expect(recommend({ ...none, explicitStates: true }).family).toBe("FLOW");
    expect(recommend({ ...none, multiAgentBenefit: true }).family).toBe("CREW");
    expect(recommend({ ...none, strictSchema: true }).family).toBe("STRICT");
    expect(recommend({ ...none, persistentConversation: true }).family).toBe("CLAW");
  });

  it("every-write approval additionally gates WRITE_INTERNAL", () => {
    expect(recommend({ ...AUTO_DEFAULT_INPUT, humanApproval: "every-write" }).approvalRequired).toContain("WRITE_INTERNAL");
    expect(recommend(AUTO_DEFAULT_INPUT).approvalRequired).not.toContain("WRITE_INTERNAL");
  });

  it("holds SHIELD invariants across the entire input space", () => {
    let n = 0;
    for (const input of allInputs()) {
      const r = recommend(input);
      n++;
      for (const a of GATED) {
        if (!r.approvalRequired.includes(a)) throw new Error(`${a} not gated for ${JSON.stringify(input)}`);
      }
      if ((r.profile as string) === "OWNER") throw new Error(`OWNER profile for ${JSON.stringify(input)}`);
      if (!r.composition.includes("SHIELD")) throw new Error(`SHIELD missing for ${JSON.stringify(input)}`);
      if (!r.composition.includes(r.family)) throw new Error(`family missing from composition for ${JSON.stringify(input)}`);
      if (r.reasons.length === 0) throw new Error(`no reasons for ${JSON.stringify(input)}`);
      if (input.privacy === "air-gapped") {
        if (MODEL_POLICIES[r.modelPolicy].mayIncurManagedCost) throw new Error(`managed-cost policy when air-gapped: ${JSON.stringify(input)}`);
        if (r.modelPolicy !== "local-only") throw new Error(`air-gapped not local-only: ${JSON.stringify(input)}`);
        if (r.deployment === "managed-cell") throw new Error(`air-gapped deployed to managed cell: ${JSON.stringify(input)}`);
      }
      if (input.edgeHardware && (r.family !== "EDGE" || r.compute !== "customer-hardware")) {
        throw new Error(`edge not respected: ${JSON.stringify(input)}`);
      }
      if ((input.privacy === "regulated" || input.governance === "strict") && r.profile !== "SAFE") {
        throw new Error(`non-SAFE profile under strict governance/regulated: ${JSON.stringify(input)}`);
      }
    }
    expect(n).toBe(41_472);
  });
});
