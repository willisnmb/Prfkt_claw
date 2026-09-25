import { describe, expect, it } from "vitest";
import { CATALOG, catalogFilterToQuery, filterCatalog, getCatalogItem, parseCatalogFilter } from "@/domain/catalog";
import { CatalogItem, type CatalogItemInput } from "@/domain/catalog/schema";
import { FAMILY_IDS } from "@/domain/families";
import { FOUNDATION_IDS } from "@/domain/foundations";
import { RELEASE_GATES } from "@/security/taxonomy";

const FRAMEWORK_NAMES = /\b(openclaw|langgraph|crewai|crew ai|pydantic(?:ai)?|zeroclaw|nemoclaw|ollama|langchain)\b/i;

describe("seed catalog", () => {
  it("has at least 100 items", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(100);
  });

  it("has unique slugs", () => {
    const slugs = CATALOG.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("covers every family and all 14 foundations", () => {
    expect(new Set(CATALOG.map((i) => i.family))).toEqual(new Set(FAMILY_IDS));
    expect(new Set(CATALOG.map((i) => i.foundation))).toEqual(new Set(FOUNDATION_IDS));
    expect(FOUNDATION_IDS).toHaveLength(14);
  });

  it("every item re-validates against the schema", () => {
    for (const item of CATALOG) {
      const res = CatalogItem.safeParse(item);
      expect(res.success, `${item.slug}: ${res.success ? "" : res.error.message}`).toBe(true);
    }
  });

  it("claims READY only with evidence for every release gate (none exist yet)", () => {
    const ready = CATALOG.filter((i) => i.maturity === "READY");
    for (const item of ready) {
      const gates = new Set(item.evidence.map((e) => e.gate));
      expect(RELEASE_GATES.every((g) => gates.has(g))).toBe(true);
    }
    // No release-gate evidence exists in this repository yet, so nothing may be READY.
    expect(ready).toHaveLength(0);
  });

  it("keeps framework names out of public copy", () => {
    for (const item of CATALOG) {
      const text = [item.name, item.summary, item.description, ...item.outcomes, ...item.integrations, ...item.tags].join(" ");
      expect(text, item.slug).not.toMatch(FRAMEWORK_NAMES);
    }
  });

  it("never allows consequential actions and always denies ADMIN", () => {
    for (const item of CATALOG) {
      for (const a of item.actions) {
        if (["SEND_EXTERNAL", "PUBLISH", "SPEND", "DELETE", "DEPLOY"].includes(a.action)) expect(a.rule, `${item.slug} ${a.action}`).not.toBe("allow");
        if (a.action === "ADMIN") expect(a.rule).toBe("deny");
      }
      expect(item.profile).not.toBe("OWNER");
    }
  });

  it("uses the family's runtime for EDGE and local model policies only", () => {
    for (const item of CATALOG.filter((i) => i.family === "EDGE")) {
      expect(item.runtime).toBe("zeroclaw");
      for (const p of item.modelPolicies) expect(["local-only", "local-first"]).toContain(p);
    }
  });

  it("makes no performance or benchmark claims in EDGE copy", () => {
    const claims = /\b(\d+\s*(x|×)\s*faster|faster than|tokens\s*\/\s*s(ec)?|benchmark(ed)? at|ms latency|lightning[- ]fast)\b/i;
    for (const item of CATALOG.filter((i) => i.family === "EDGE")) {
      expect([item.summary, item.description, ...item.outcomes].join(" "), item.slug).not.toMatch(claims);
    }
  });

  it("looks items up by slug", () => {
    expect(getCatalogItem("lead-to-customer")?.family).toBe("FLOW");
    expect(getCatalogItem("does-not-exist")).toBeUndefined();
  });
});

describe("CatalogItem schema guards", () => {
  const valid: CatalogItemInput = {
    slug: "test-item",
    name: "Test Item",
    family: "CLAW",
    foundation: "chief",
    summary: "A test item summary that is long enough to pass validation.",
    description:
      "A test item description that is long enough to pass the minimum length requirement for catalog descriptions in the schema.",
    outcomes: ["First outcome here", "Second outcome here"],
    integrations: [],
    actions: [{ action: "READ", rule: "allow" }],
    profile: "SAFE",
    runtime: "openclaw",
    modelPolicies: ["balanced"],
    compute: ["cpu"],
    deployments: ["managed-cell"],
    maturity: "CONFIGURABLE",
  };

  it("accepts a valid item", () => {
    expect(CatalogItem.safeParse(valid).success).toBe(true);
  });

  it("rejects READY without evidence", () => {
    const res = CatalogItem.safeParse({ ...valid, maturity: "READY" });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toMatch(/READY requires passing evidence/);
  });

  it("rejects READY with evidence for only some gates", () => {
    const res = CatalogItem.safeParse({
      ...valid,
      maturity: "READY",
      evidence: [{ gate: "dependency_scan", ref: "ci/run/1", result: "pass", verifiedAt: "2026-09-25" }],
    });
    expect(res.success).toBe(false);
  });

  it("accepts READY with passing evidence for every gate", () => {
    const res = CatalogItem.safeParse({
      ...valid,
      maturity: "READY",
      evidence: RELEASE_GATES.map((gate) => ({ gate, ref: `ci/run/${gate}`, result: "pass" as const, verifiedAt: "2026-09-25" })),
    });
    expect(res.success).toBe(true);
  });

  it("rejects autonomous consequential actions, non-denied ADMIN and OWNER profile", () => {
    expect(CatalogItem.safeParse({ ...valid, actions: [{ action: "SEND_EXTERNAL", rule: "allow" }] }).success).toBe(false);
    expect(CatalogItem.safeParse({ ...valid, actions: [{ action: "ADMIN", rule: "approval" }] }).success).toBe(false);
    expect(CatalogItem.safeParse({ ...valid, profile: "OWNER" }).success).toBe(false);
  });
});

describe("catalog search and filters", () => {
  it("returns everything for an empty filter", () => {
    expect(filterCatalog(CATALOG, {})).toHaveLength(CATALOG.length);
  });

  it("filters by family, foundation, maturity and deployment together", () => {
    const res = filterCatalog(CATALOG, { family: "EDGE", foundation: "voice-reception", deployment: "edge-device" });
    expect(res.length).toBeGreaterThan(0);
    for (const i of res) {
      expect(i.family).toBe("EDGE");
      expect(i.foundation).toBe("voice-reception");
      expect(i.deployments).toContain("edge-device");
    }
    expect(filterCatalog(CATALOG, { maturity: "READY" })).toHaveLength(0);
  });

  it("matches every search term (AND) case-insensitively and ranks name matches first", () => {
    const res = filterCatalog(CATALOG, { q: "INVOICE approval" });
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]!.name.toLowerCase()).toContain("invoice");
    for (const i of res) {
      const text = JSON.stringify(i).toLowerCase();
      expect(text).toContain("invoice");
      expect(text).toContain("approval");
    }
  });

  it("returns an empty list for nonsense", () => {
    expect(filterCatalog(CATALOG, { q: "zzzqqqxxx" })).toEqual([]);
  });

  it("parses URL params, dropping invalid values instead of throwing", () => {
    expect(parseCatalogFilter({ family: "FLOW", foundation: "nope", maturity: ["CUSTOM", "READY"], q: "  sales " })).toEqual({
      family: "FLOW",
      foundation: undefined,
      maturity: "CUSTOM",
      deployment: undefined,
      q: "sales",
    });
    expect(parseCatalogFilter({})).toEqual({ q: undefined, family: undefined, foundation: undefined, maturity: undefined, deployment: undefined });
  });

  it("round-trips a filter through the query string", () => {
    const f = { q: "offline notes", family: "EDGE" as const };
    const qs = catalogFilterToQuery(f);
    expect(qs).toBe("?q=offline+notes&family=EDGE");
    expect(parseCatalogFilter(Object.fromEntries(new URLSearchParams(qs)))).toMatchObject(f);
    expect(catalogFilterToQuery({})).toBe("");
  });
});
