import { randomInt } from "node:crypto";
import { z } from "zod";
import { recommend } from "@/domain/auto";
import { ConfigurationInput, CustomBuildRequestInput, type ActionResult } from "@/domain/intake";
import type { Sql } from "../db/sql";
import { one, withUser } from "../db/sql";
import type { ServerEnv } from "../env";
import { isFlagEnabled } from "../flags";
import { hitRateLimit, RATE_LIMITS } from "../rate-limit";
import { insertSystemEvent } from "./system-events";
import { primaryTenantIdForUser } from "./tenant";

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRequestReference(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `CR-${s}`;
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(flat)) if (v && v.length) out[k] = v;
  return out;
}

export const INTAKE_MESSAGES = {
  invalid: "Please correct the highlighted fields.",
  rejected: "We couldn't accept this request. Please try again later or contact us directly.",
  rateLimited: "Too many requests. Please wait a while before trying again.",
  disabled: "Custom requests are temporarily closed.",
  signInToSave: "Sign in to save configurations.",
  saveDisabled: "Saving configurations is temporarily unavailable.",
} as const;

export interface IntakeContext {
  ip: string;
  userId?: string | null;
  env: ServerEnv;
}

/**
 * Public custom-intake pipeline (server path only; anon cannot insert directly).
 * Order: schema → honeypot → flag → rate limits → insert + event, in one transaction.
 * Honeypot hits get the same generic rejection as other abuse so bots learn nothing;
 * they are recorded as a system event and nothing else is stored.
 */
export async function processCustomBuildRequest(
  sql: Sql,
  raw: unknown,
  ctx: IntakeContext,
): Promise<ActionResult<{ reference: string }>> {
  const honeypot = typeof raw === "object" && raw !== null && "website" in raw ? (raw as { website?: unknown }).website : undefined;
  if (typeof honeypot === "string" && honeypot.length > 0) {
    await insertSystemEvent(sql, {
      kind: "intake.honeypot",
      severity: "warning",
      message: "Custom intake honeypot triggered; submission discarded.",
    });
    return { ok: false, error: INTAKE_MESSAGES.rejected };
  }

  const parsed = CustomBuildRequestInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INTAKE_MESSAGES.invalid, fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;

  if (!(await isFlagEnabled(sql, "custom_intake_enabled", ctx.env))) return { ok: false, error: INTAKE_MESSAGES.disabled };

  const ipOk = await hitRateLimit(sql, RATE_LIMITS.intakePerIp, ctx.ip);
  const emailOk = await hitRateLimit(sql, RATE_LIMITS.intakePerEmail, input.contactEmail);
  if (!ipOk || !emailOk) {
    await insertSystemEvent(sql, {
      kind: "intake.rate_limited",
      severity: "warning",
      message: "Custom intake rate limit reached.",
      detail: { by: !ipOk ? "ip" : "email" },
    });
    return { ok: false, error: INTAKE_MESSAGES.rateLimited };
  }

  return sql.transaction(async (tx) => {
    const tenantId = ctx.userId ? await primaryTenantIdForUser(tx, ctx.userId) : undefined;
    const row = await one<{ reference: string }>(
      tx,
      `insert into public.custom_build_requests
         (reference, tenant_id, submitted_by, contact_name, contact_email, company, foundation_id, family,
          catalog_slug, problem, outcomes, data_sensitivity, timeline, budget_range)
       values ($1, $2, $3, $4, $5, $6, $7, $8,
               (select slug from public.claws where slug = $9 and published), $10, $11, $12, $13, $14)
       returning reference`,
      [
        generateRequestReference(),
        tenantId ?? null,
        ctx.userId ?? null,
        input.contactName,
        input.contactEmail,
        input.company || null,
        input.foundation ?? null,
        input.family ?? null,
        input.catalogSlug ?? null,
        input.problem,
        input.outcomes || null,
        input.dataSensitivity,
        input.timeline,
        input.budgetRange,
      ],
    );
    await insertSystemEvent(tx, {
      kind: "intake.received",
      message: `Custom build request ${row.reference} received.`,
      detail: { reference: row.reference, signedIn: Boolean(ctx.userId) },
    });
    return { ok: true as const, data: { reference: row.reference } };
  });
}

/**
 * Saves a configurator result for a signed-in customer. Runs as the user
 * (RLS). The recommendation is recomputed here from the validated inputs.
 */
export async function processSaveConfiguration(
  sql: Sql,
  raw: unknown,
  ctx: { userId: string | null | undefined; env: ServerEnv },
): Promise<ActionResult<{ id: string }>> {
  if (!ctx.userId) return { ok: false, error: INTAKE_MESSAGES.signInToSave };
  const parsed = ConfigurationInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INTAKE_MESSAGES.invalid, fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;
  if (!(await isFlagEnabled(sql, "configuration_save_enabled", ctx.env))) return { ok: false, error: INTAKE_MESSAGES.saveDisabled };
  if (!(await hitRateLimit(sql, RATE_LIMITS.configurationPerUser, ctx.userId))) {
    return { ok: false, error: INTAKE_MESSAGES.rateLimited };
  }
  const recommendation = recommend(input.auto);
  const userId = ctx.userId;
  return withUser(sql, userId, async (tx) => {
    const tenantId = await primaryTenantIdForUser(tx, userId);
    if (!tenantId) return { ok: false as const, error: "Your account has no workspace yet. Please contact support." };
    const row = await one<{ id: string }>(
      tx,
      `insert into public.configurations (tenant_id, created_by, name, catalog_slug, auto_input, recommendation, notes)
       values ($1, $2, $3, (select slug from public.claws where slug = $4), $5::jsonb, $6::jsonb, $7)
       returning id`,
      [
        tenantId,
        userId,
        input.name,
        input.catalogSlug ?? null,
        JSON.stringify(input.auto),
        JSON.stringify(recommendation),
        input.notes || null,
      ],
    );
    return { ok: true as const, data: { id: row.id } };
  });
}
