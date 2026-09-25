import { z } from "zod";

/**
 * Ollama — first-class local model route (RUNTIME_STRATEGY.md). The base URL
 * is operator configuration (OLLAMA_BASE_URL), typically on the same host or
 * private network as the cell, so it is not subject to the public-egress SSRF
 * guard; it is never taken from user input.
 */
const Tags = z.object({
  models: z.array(z.object({ name: z.string(), size: z.number().optional(), details: z.object({ family: z.string().optional(), parameter_size: z.string().optional() }).partial().optional() })),
});
const Version = z.object({ version: z.string() });

export interface OllamaHealth {
  configured: boolean;
  reachable: boolean;
  version: string | null;
  models: { name: string; family: string | null; parameterSize: string | null }[];
  error: string | null;
  checkedAt: string;
}

export async function probeOllama(baseUrl: string | undefined, fetchImpl: typeof fetch = fetch, timeoutMs = 2_000): Promise<OllamaHealth> {
  const checkedAt = new Date().toISOString();
  if (!baseUrl) return { configured: false, reachable: false, version: null, models: [], error: null, checkedAt };
  try {
    const [v, t] = await Promise.all([
      fetchImpl(new URL("/api/version", baseUrl), { signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json()),
      fetchImpl(new URL("/api/tags", baseUrl), { signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json()),
    ]);
    const tags = Tags.parse(t);
    return {
      configured: true,
      reachable: true,
      version: Version.parse(v).version,
      models: tags.models.map((m) => ({ name: m.name, family: m.details?.family ?? null, parameterSize: m.details?.parameter_size ?? null })),
      error: null,
      checkedAt,
    };
  } catch (e) {
    return { configured: true, reachable: false, version: null, models: [], error: e instanceof Error ? e.message : String(e), checkedAt };
  }
}
