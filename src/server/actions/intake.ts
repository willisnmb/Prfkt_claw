"use server";

import type { ActionResult } from "@/domain/intake";

/**
 * Server actions for the configurator and custom intake.
 * CONTRACT STUB — implemented in the data/auth slice.
 */
export async function saveConfiguration(_input: unknown): Promise<ActionResult<{ id: string }>> {
  return { ok: false, error: "Saving configurations is not available yet." };
}

export async function submitCustomBuildRequest(_input: unknown): Promise<ActionResult<{ reference: string }>> {
  return { ok: false, error: "Custom requests are not available yet." };
}
