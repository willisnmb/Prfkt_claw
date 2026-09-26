import { describe, expect, it } from "vitest";
import { withTimeout } from "@/flow/flow01/engine";

describe("FLOW 01 step deadline (F-012)", () => {
  it("aborts the adapter signal when the step times out", async () => {
    let seen: AbortSignal | undefined;
    const hung = (signal: AbortSignal) => {
      seen = signal;
      return new Promise<never>(() => undefined);
    };
    await expect(withTimeout(hung, 50, "research step timed out")).rejects.toThrow("research step timed out");
    expect(seen?.aborted).toBe(true);
    expect(String((seen?.reason as Error).message)).toBe("research step timed out");
  });

  it("does not abort a step that finishes in time", async () => {
    let seen: AbortSignal | undefined;
    await expect(
      withTimeout(async (signal) => {
        seen = signal;
        return 42;
      }, 1_000, "late"),
    ).resolves.toBe(42);
    expect(seen?.aborted).toBe(false);
  });
});
