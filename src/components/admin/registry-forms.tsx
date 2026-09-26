"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelProvisioningJobAction,
  createProvisioningJobAction,
  requeueProvisioningJobAction,
  runProvisioningJobAction,
  setComputeEnabledAction,
  setFlagAction,
  setModelEnabledAction,
  setRuntimeStatusAction,
} from "@/server/actions/admin";
import { AdminForm } from "./admin-form";

const STATUSES = ["connected", "embedded", "not-configured", "candidate", "disabled"] as const;

export function RuntimeStatusForm({ id, status, notes }: { id: string; status: string; notes: string | null }) {
  return (
    <AdminForm action={setRuntimeStatusAction} inline>
      {(pending) => (
        <>
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`rt-${id}`} className="sr-only">
            Status for {id}
          </label>
          <select id={`rt-${id}`} name="status" defaultValue={status} className="h-11 rounded-md border border-input bg-transparent px-3 text-sm">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label htmlFor={`rt-notes-${id}`} className="sr-only">
            Notes for {id}
          </label>
          <Input id={`rt-notes-${id}`} name="notes" defaultValue={notes ?? ""} placeholder="Evidence / notes" maxLength={1000} className="h-11 w-56" />
          <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
            Save
          </Button>
        </>
      )}
    </AdminForm>
  );
}

export function EnabledToggle({ id, enabled, kind }: { id: string; enabled: boolean; kind: "model" | "compute" }) {
  return (
    <AdminForm action={kind === "model" ? setModelEnabledAction : setComputeEnabledAction} inline>
      {(pending) => (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="enabled" value={String(!enabled)} />
          <Button type="submit" size="sm" variant={enabled ? "outline" : "default"} className="min-h-11" disabled={pending}>
            {enabled ? "Disable" : "Enable"}
          </Button>
        </>
      )}
    </AdminForm>
  );
}

export function FlagToggle({ flagKey, stored, ceiling }: { flagKey: string; stored: boolean; ceiling: boolean }) {
  return (
    <AdminForm action={setFlagAction} inline>
      {(pending) => (
        <>
          <input type="hidden" name="key" value={flagKey} />
          <input type="hidden" name="enabled" value={String(!stored)} />
          <Button
            type="submit"
            size="sm"
            variant={stored ? "outline" : "default"}
            className="min-h-11"
            disabled={pending || (!stored && !ceiling)}
            aria-describedby={!ceiling ? `ceiling-${flagKey}` : undefined}
          >
            {stored ? "Turn off" : "Turn on"}
          </Button>
          {!ceiling && !stored && (
            <span id={`ceiling-${flagKey}`} className="text-xs text-muted-foreground">
              Blocked by environment ceiling
            </span>
          )}
        </>
      )}
    </AdminForm>
  );
}

export function CreateJobForm({ deploymentRequestId }: { deploymentRequestId: string }) {
  return (
    <AdminForm action={createProvisioningJobAction} inline>
      {(pending) => (
        <>
          <input type="hidden" name="deploymentRequestId" value={deploymentRequestId} />
          <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
            Create provisioning job
          </Button>
        </>
      )}
    </AdminForm>
  );
}

/** Owner controls for one provisioning job; which buttons appear depends on its status. */
export function JobActions({ jobId, status, gateOpen }: { jobId: string; status: string; gateOpen: boolean }) {
  const canRun = gateOpen && (status === "QUEUED" || status === "RUNNING");
  const canQueue = gateOpen && (status === "BLOCKED" || status === "FAILED");
  const canCancel = status === "BLOCKED" || status === "QUEUED" || status === "FAILED";
  if (!canRun && !canQueue && !canCancel) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {canRun && (
        <AdminForm action={runProvisioningJobAction} inline>
          {(pending) => (
            <>
              <input type="hidden" name="jobId" value={jobId} />
              <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
                {pending ? "Provisioning… (up to 3 min)" : status === "RUNNING" ? "Resume run" : "Run"}
              </Button>
            </>
          )}
        </AdminForm>
      )}
      {canQueue && (
        <AdminForm action={requeueProvisioningJobAction} inline>
          {(pending) => (
            <>
              <input type="hidden" name="jobId" value={jobId} />
              <Button type="submit" size="sm" variant="outline" className="min-h-11" disabled={pending}>
                {status === "FAILED" ? "Retry" : "Queue"}
              </Button>
            </>
          )}
        </AdminForm>
      )}
      {canCancel && (
        <AdminForm action={cancelProvisioningJobAction} inline>
          {(pending) => (
            <>
              <input type="hidden" name="jobId" value={jobId} />
              <Button type="submit" size="sm" variant="ghost" className="min-h-11" disabled={pending}>
                Cancel job
              </Button>
            </>
          )}
        </AdminForm>
      )}
    </div>
  );
}
