import type { RuntimeAdapter } from "./adapter";
import { OpenClawAdapter } from "./openclaw";

/**
 * Resolves the adapter for a runtime. The control plane never constructs a
 * runtime-specific adapter anywhere else, so adding a runtime means adding a
 * case here (RUNTIME_STRATEGY.md). Returns a reason instead of throwing so the
 * caller can show owners why a job cannot run.
 */

export interface RuntimeAdapterEnv {
  PROVISIONING_ENABLED: boolean;
  PRFKT_CELL_CONTROLLER_URL?: string;
  PRFKT_CELL_CONTROLLER_TOKEN?: string;
}

export type AdapterResolution = { ok: true; adapter: RuntimeAdapter } | { ok: false; reason: string };

/** Cell boot plus the controller's health wait can take ~90 s; allow headroom. */
const CONTROLLER_TIMEOUT_MS = 180_000;

export function resolveRuntimeAdapter(runtime: string, env: RuntimeAdapterEnv, opts: { fetchImpl?: typeof fetch } = {}): AdapterResolution {
  switch (runtime) {
    case "openclaw": {
      const url = env.PRFKT_CELL_CONTROLLER_URL;
      const token = env.PRFKT_CELL_CONTROLLER_TOKEN;
      if (!url || !token) return { ok: false, reason: "The OpenClaw cell controller is not configured (PRFKT_CELL_CONTROLLER_URL / PRFKT_CELL_CONTROLLER_TOKEN)." };
      if (token.length < 32) return { ok: false, reason: "PRFKT_CELL_CONTROLLER_TOKEN is too short (minimum 32 characters)." };
      try {
        return {
          ok: true,
          adapter: new OpenClawAdapter({
            controllerUrl: url,
            getControllerToken: async () => token,
            provisioningEnabled: env.PROVISIONING_ENABLED,
            fetchImpl: opts.fetchImpl,
            timeoutMs: CONTROLLER_TIMEOUT_MS,
            maxAttempts: 2,
          }),
        };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "invalid cell controller configuration" };
      }
    }
    default:
      return { ok: false, reason: `No runtime adapter exists for "${runtime}" yet (F-007).` };
  }
}
