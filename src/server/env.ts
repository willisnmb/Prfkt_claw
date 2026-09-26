import "server-only";
import { z } from "zod";

/**
 * Server environment contract (BUILD_INSTRUCTIONS.md §3). Parsed once, lazily,
 * so pages that do not need a variable still render when it is absent.
 * Feature gates default to disabled and only the literal string "true" enables them.
 */
const flag = z
  .string()
  .optional()
  .transform((v) => v === "true");

const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))
  .pipe(z.url().optional());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  DATABASE_URL: optionalString,
  ADMIN_EMAILS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  BILLING_ENABLED: flag,
  PROVISIONING_ENABLED: flag,
  PAYMENT_WEBHOOK_SECRET: optionalString,
  OLLAMA_BASE_URL: optionalUrl,
  /** PRFKT cell controller (docs/runtime/CELL_CONTROLLER.md). Server-only; the token never reaches the browser. */
  PRFKT_CELL_CONTROLLER_URL: optionalUrl,
  PRFKT_CELL_CONTROLLER_TOKEN: optionalString,
});
export type ServerEnv = z.infer<typeof EnvSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}

/** Test hook: re-read process.env. */
export function resetServerEnvForTests(): void {
  cached = undefined;
}

export function isSupabaseAuthConfigured(env = serverEnv()): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function isDatabaseConfigured(env = serverEnv()): boolean {
  return Boolean(env.DATABASE_URL);
}
