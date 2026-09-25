"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createProvisioningJobAction,
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
