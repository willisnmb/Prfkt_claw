"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/server/auth/owner";
import { writeAudit } from "@/server/audit";
import { getSql } from "@/server/db/postgres";
import { maybeOne } from "@/server/db/sql";
import { getFlow01Engine } from "@/flow/flow01/wiring";
import { FlowConflictError } from "@/flow/flow01/engine";
import { ALLOWED_LEAD_SOURCES } from "@/flow/flow01/definition";
import { payloadHash } from "@/security/firewall";

export type FlowFormState = { ok: boolean; message: string } | null;

const unavailable: FlowFormState = { ok: false, message: "FLOW 01 is not available in this environment." };

const Decision = z.object({
  approvalId: z.uuid(),
  workflowId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(2000).optional(),
});

export async function decideFlowApproval(_prev: FlowFormState, fd: FormData): Promise<FlowFormState> {
  const owner = await requireOwner();
  const engine = getFlow01Engine();
  if (!engine) return unavailable;
  const parsed = Decision.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, message: "Invalid decision." };
  const { approvalId, workflowId, decision, reason } = parsed.data;
  if (decision === "rejected" && !reason) return { ok: false, message: "Give a reason so the revision can address it." };
  try {
    await engine.decideApproval({
      approvalId,
      decision,
      reason,
      actor: `owner:${owner.email}`,
      audit: (tx, a) =>
        writeAudit(tx, owner, { action: `flow.approval.${decision}`, targetType: "flow_run", targetId: workflowId, after: { approvalId: a.id, kind: a.kind, payloadHash: a.payloadHash, reason: reason ?? null } }),
    });
  } catch (e) {
    if (e instanceof FlowConflictError) return { ok: false, message: "This approval was already decided or is no longer current." };
    throw e;
  }
  const r = await engine.advance(workflowId);
  revalidatePath(`/admin/flows/${workflowId}`);
  revalidatePath("/admin/flows");
  return { ok: true, message: `Recorded. Run is now ${r.state} (${r.status}).` };
}

export async function retryFlowRun(_prev: FlowFormState, fd: FormData): Promise<FlowFormState> {
  const owner = await requireOwner();
  const engine = getFlow01Engine();
  if (!engine) return unavailable;
  const workflowId = z.uuid().safeParse(fd.get("workflowId"));
  if (!workflowId.success) return { ok: false, message: "Invalid run." };
  try {
    await engine.retryRun(workflowId.data, `owner:${owner.email}`, (tx, run) =>
      writeAudit(tx, owner, { action: "flow.run.retry", targetType: "flow_run", targetId: run.workflowId, before: { state: run.currentState, lastError: run.lastError } }),
    );
  } catch (e) {
    if (e instanceof FlowConflictError) return { ok: false, message: "Only failed or blocked runs can be retried." };
    throw e;
  }
  const r = await engine.advance(workflowId.data);
  revalidatePath(`/admin/flows/${workflowId.data}`);
  return { ok: true, message: `Retried. Run is now ${r.state} (${r.status}).` };
}

const StartLead = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().min(1).max(160),
  email: z.email().max(254),
  website: z.url().max(300),
  source: z.enum(ALLOWED_LEAD_SOURCES),
});

export async function startFlowRun(_prev: FlowFormState, fd: FormData): Promise<FlowFormState> {
  const owner = await requireOwner();
  const engine = getFlow01Engine();
  if (!engine) return unavailable;
  const parsed = StartLead.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const house = await maybeOne<{ tenant_id: string }>(getSql(), "select tenant_id from public.tenant_members where user_id = $1 order by created_at limit 1", [owner.userId]);
  if (!house) return { ok: false, message: "Your account has no tenant to own this workflow." };
  const key = `manual:${payloadHash({ email: parsed.data.email.toLowerCase(), company: parsed.data.company })}`;
  const { run, created } = await engine.createRun({
    tenantId: house.tenant_id,
    leadId: parsed.data.email.toLowerCase(),
    lead: parsed.data,
    idempotencyKey: key,
    audit: (tx, r) => writeAudit(tx, owner, { action: "flow.run.start", targetType: "flow_run", targetId: r.workflowId, after: { company: parsed.data.company, source: parsed.data.source } }),
  });
  if (created) await engine.advance(run.workflowId);
  revalidatePath("/admin/flows");
  return { ok: true, message: created ? `Started run ${run.workflowId.slice(0, 8)}.` : "A run for this lead already exists." };
}
