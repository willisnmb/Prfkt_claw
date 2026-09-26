import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REDCLAW_CATEGORIES } from "@/security/taxonomy";

describe("RED CLAW coverage", () => {
  it("every SECURITY.md attack category has at least two critical cases", () => {
    const dir = join(process.cwd(), "tests", "redclaw");
    const src = readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts") && f !== "coverage.test.ts")
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    const counts = Object.fromEntries(
      REDCLAW_CATEGORIES.map((c) => [c, (src.match(new RegExp(`redclaw\\(\\s*"${c}"`, "g")) ?? []).length]),
    );
    const missing = Object.entries(counts).filter(([, n]) => n < 2);
    expect(missing, `categories without enough cases: ${JSON.stringify(missing)}`).toEqual([]);
  });
});
