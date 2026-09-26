import { it } from "vitest";
import type { RedClawCategory } from "@/security/taxonomy";

/**
 * RED CLAW case. Every case is CRITICAL: a failure blocks READY (SECURITY.md).
 * The title prefix is what tests/redclaw/coverage.test.ts counts.
 */
export function redclaw(category: RedClawCategory, title: string, fn: () => unknown | Promise<unknown>) {
  it(`[RED CLAW:${category}] ${title}`, fn);
}
