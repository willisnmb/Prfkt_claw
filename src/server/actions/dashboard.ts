"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/domain/intake";
import { requireUser } from "@/server/auth/user";
import { getSql } from "@/server/db/postgres";
import { isDatabaseConfigured } from "@/server/env";
import {
  cancelAccountDeletion,
  cancelDeploymentRequest,
  createDeploymentRequest,
  requestAccountDeletion,
} from "@/server/data/customer";

type Result = ActionResult<{ id: string }> | null;

async function run(fn: (userId: string) => Promise<ActionResult<{ id: string }>>): Promise<Result> {
  const user = await requireUser("/dashboard");
  if (!isDatabaseConfigured()) return { ok: false, error: "This environment is not connected to a database." };
  try {
    const res = await fn(user.id);
    if (res.ok) revalidatePath("/dashboard");
    return res;
  } catch (err) {
    console.error("dashboard action failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function requestDeploymentAction(_prev: Result, formData: FormData): Promise<Result> {
  return run((userId) =>
    createDeploymentRequest(getSql(), userId, {
      configurationId: formData.get("configurationId"),
      note: formData.get("note") || undefined,
    }),
  );
}

export async function cancelDeploymentAction(_prev: Result, formData: FormData): Promise<Result> {
  return run((userId) => cancelDeploymentRequest(getSql(), userId, { id: formData.get("id") }));
}

export async function requestDeletionAction(_prev: Result, formData: FormData): Promise<Result> {
  return run((userId) =>
    requestAccountDeletion(getSql(), userId, { confirm: formData.get("confirm"), reason: formData.get("reason") || undefined }),
  );
}

export async function cancelDeletionAction(_prev: Result, _formData: FormData): Promise<Result> {
  return run((userId) => cancelAccountDeletion(getSql(), userId));
}
