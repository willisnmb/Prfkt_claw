import { z } from "zod";
import { AutoInput } from "./auto";
import { FamilyId } from "./families";
import { FoundationId } from "./foundations";

/** Shared result shape for server actions. Never leaks internal error details. */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * Saved configurator result. The server recomputes the recommendation from
 * `auto` — a client-supplied recommendation is never trusted.
 */
export const ConfigurationInput = z.object({
  name: trimmed(2, 80),
  catalogSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
  auto: AutoInput,
  notes: trimmed(0, 2000).optional(),
});
export type ConfigurationInput = z.infer<typeof ConfigurationInput>;

export const DATA_SENSITIVITY = ["public", "internal", "confidential", "regulated"] as const;
export const TIMELINES = ["exploring", "this-quarter", "this-month", "urgent"] as const;
export const BUDGET_RANGES = ["under-5k", "5k-25k", "25k-100k", "100k-plus", "not-sure"] as const;

export const CustomBuildRequestInput = z.object({
  contactName: trimmed(2, 120),
  contactEmail: z.email().max(254),
  company: trimmed(0, 160).optional(),
  foundation: FoundationId.optional(),
  family: FamilyId.optional(),
  catalogSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
  problem: trimmed(20, 4000),
  outcomes: trimmed(0, 2000).optional(),
  dataSensitivity: z.enum(DATA_SENSITIVITY),
  timeline: z.enum(TIMELINES),
  budgetRange: z.enum(BUDGET_RANGES),
  consent: z.literal(true, { error: "Please confirm we may contact you about this request." }),
  /** Honeypot. Real users never see or fill it; any value marks the submission as abuse. */
  website: z.string().max(0).optional(),
});
export type CustomBuildRequestInput = z.infer<typeof CustomBuildRequestInput>;
