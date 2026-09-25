import { describe, expect, it } from "vitest";
import { canSetFlag, effectiveFlag } from "@/server/flags";

const off = { BILLING_ENABLED: false, PROVISIONING_ENABLED: false };
const on = { BILLING_ENABLED: true, PROVISIONING_ENABLED: true };

describe("feature flags with environment ceiling", () => {
  it("gated flags are off unless both env and DB enable them", () => {
    for (const key of ["billing_enabled", "provisioning_enabled"] as const) {
      expect(effectiveFlag(key, true, off)).toBe(false);
      expect(effectiveFlag(key, false, on)).toBe(false);
      expect(effectiveFlag(key, undefined, on)).toBe(false);
      expect(effectiveFlag(key, true, on)).toBe(true);
    }
  });
  it("ungated flags follow the DB and default on when missing", () => {
    expect(effectiveFlag("custom_intake_enabled", undefined, off)).toBe(true);
    expect(effectiveFlag("custom_intake_enabled", false, on)).toBe(false);
  });
  it("owners cannot enable beyond the env ceiling but can always disable", () => {
    expect(canSetFlag("billing_enabled", true, off)).toMatchObject({ ok: false });
    expect(canSetFlag("provisioning_enabled", true, off)).toMatchObject({ ok: false });
    expect(canSetFlag("billing_enabled", false, off)).toEqual({ ok: true });
    expect(canSetFlag("provisioning_enabled", true, on)).toEqual({ ok: true });
    expect(canSetFlag("custom_intake_enabled", true, off)).toEqual({ ok: true });
  });
});
