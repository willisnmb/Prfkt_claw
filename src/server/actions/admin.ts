"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import { requireOwner } from "@/server/auth/owner";
import { getSql } from "@/server/db/postgres";
import type { Sql } from "@/server/db/sql";
import { isDatabaseConfigured, serverEnv } from "@/server/env";
import {
  addClawEvidence,
  completeAccountDeletion,
  createProvisioningJob,
  reviewDeploymentRequest,
  setClawMaturity,
  setClawPublished,
  setComputeEnabled,
  setFeatureFlag,
  setModelEnabled,
  setRuntimeStatus,
  updateCustomRequest,
  type OwnerContext,
  type OwnerResult,
} from "@/server/data/admin";

export type AdminFormState = { ok: boolean; message: string } | null;

/**
 * Every owner mutation: requireOwner() (server-verified, per request) → one
 * transaction containing the change and its admin_audit_log entry.
 */
async function ownerMutation<T>(fn: (tx: Sql, ctx: OwnerContext) => Promise<OwnerResult<T>>, paths: string[]): Promise<AdminFormState> {
  const principal = await requireOwner();
  if (!isDatabaseConfigured()) return { ok: false, message: "The database is not configured in this environment." };
  const requestId = (await headers()).get("x-request-id") ?? randomUUID();
  try {
    const res = await getSql().transaction((tx) => fn(tx, { actor: { userId: principal.userId, email: principal.email }, requestId }));
    if (!res.ok) return { ok: false, message: res.error };
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

function describeError(err: unknown): string {
  if (err instanceof ZodError) return "Invalid input.";
  const code = (err as { code?: string } | null)?.code;
  // Messages raised by our own constraints/triggers are safe to show to owners.
  if ((code === "23514" || code === "42501" || code === "23503") && err instanceof Error) return err.message;
  console.error("admin mutation failed", err instanceof Error ? err.name : "unknown");
  return "The change could not be saved.";
}

const bool = (v: FormDataEntryValue | null) => v === "true";
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : undefined);

export async function setPublishedAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation((tx, ctx) => setClawPublished(tx, ctx, { slug: str(fd.get("slug")), published: bool(fd.get("published")) }), [
    "/admin/catalog",
    "/catalog",
  ]);
}

export async function setMaturityAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation((tx, ctx) => setClawMaturity(tx, ctx, { slug: str(fd.get("slug")), maturity: str(fd.get("maturity")) }), [
    "/admin/catalog",
    "/catalog",
  ]);
}

export async function addEvidenceAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation(
    (tx, ctx) =>
      addClawEvidence(tx, ctx, {
        slug: str(fd.get("slug")),
        gate: str(fd.get("gate")),
        ref: str(fd.get("ref")),
        verifiedAt: str(fd.get("verifiedAt")),
      }),
    ["/admin/catalog"],
  );
}

export async function updateCustomRequestAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation(
    (tx, ctx) => updateCustomRequest(tx, ctx, { id: str(fd.get("id")), status: str(fd.get("status")), ownerNotes: str(fd.get("ownerNotes")) }),
    ["/admin/requests", "/admin"],
  );
}

export async function reviewDeploymentAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation(
    (tx, ctx) =>
      reviewDeploymentRequest(tx, ctx, { id: str(fd.get("id")), decision: str(fd.get("decision")), note: str(fd.get("note")) || undefined }),
    ["/admin/requests", "/admin/provisioning", "/admin"],
  );
}

export async function completeDeletionAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  if (str(fd.get("confirm")) !== "DELETE") return { ok: false, message: "Type DELETE to confirm." };
  return ownerMutation((tx, ctx) => completeAccountDeletion(tx, ctx, { id: str(fd.get("id")) }), ["/admin/requests", "/admin"]);
}

export async function createProvisioningJobAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation(
    (tx, ctx) => createProvisioningJob(tx, ctx, { deploymentRequestId: str(fd.get("deploymentRequestId")) }, serverEnv()),
    ["/admin/provisioning"],
  );
}

export async function setRuntimeStatusAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation(
    (tx, ctx) => setRuntimeStatus(tx, ctx, { id: str(fd.get("id")), status: str(fd.get("status")), notes: str(fd.get("notes")) || undefined }),
    ["/admin/runtimes"],
  );
}

export async function setModelEnabledAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation((tx, ctx) => setModelEnabled(tx, ctx, { id: str(fd.get("id")), enabled: bool(fd.get("enabled")) }), ["/admin/models"]);
}

export async function setComputeEnabledAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation((tx, ctx) => setComputeEnabled(tx, ctx, { id: str(fd.get("id")), enabled: bool(fd.get("enabled")) }), ["/admin/compute"]);
}

export async function setFlagAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  return ownerMutation((tx, ctx) => setFeatureFlag(tx, ctx, { key: str(fd.get("key")), enabled: bool(fd.get("enabled")) }, serverEnv()), [
    "/admin/system",
  ]);
}
