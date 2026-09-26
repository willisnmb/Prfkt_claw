"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { completeDeletionAction, reviewDeploymentAction, updateCustomRequestAction } from "@/server/actions/admin";
import { AdminForm } from "./admin-form";

const NEXT_STATUSES: Record<string, string[]> = {
  RECEIVED: ["TRIAGED", "DECLINED"],
  TRIAGED: ["SCOPED", "DECLINED"],
  SCOPED: ["CONVERTED", "DECLINED"],
};

export function CustomRequestForm({ id, status, ownerNotes }: { id: string; status: string; ownerNotes: string | null }) {
  const options = NEXT_STATUSES[status] ?? [];
  return (
    <AdminForm action={updateCustomRequestAction}>
      {(pending) => (
        <>
          <input type="hidden" name="id" value={id} />
          <div className="space-y-1">
            <Label htmlFor={`notes-${id}`}>Private owner notes</Label>
            <Textarea id={`notes-${id}`} name="ownerNotes" defaultValue={ownerNotes ?? ""} maxLength={4000} rows={2} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`status-${id}`} className="sr-only">
              New status
            </label>
            <select id={`status-${id}`} name="status" defaultValue={status} className="h-11 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value={status}>{status} (keep)</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
              Save
            </Button>
          </div>
        </>
      )}
    </AdminForm>
  );
}

export function DeploymentReviewForm({ id }: { id: string }) {
  return (
    <AdminForm action={reviewDeploymentAction}>
      {(pending) => (
        <>
          <input type="hidden" name="id" value={id} />
          <div className="space-y-1">
            <Label htmlFor={`review-${id}`}>Note to the customer (required to reject)</Label>
            <Textarea id={`review-${id}`} name="note" maxLength={2000} rows={2} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="APPROVED" size="sm" className="min-h-11" disabled={pending}>
              Approve
            </Button>
            <Button type="submit" name="decision" value="REJECTED" size="sm" variant="destructive" className="min-h-11" disabled={pending}>
              Reject
            </Button>
          </div>
        </>
      )}
    </AdminForm>
  );
}

export function CompleteDeletionForm({ id }: { id: string }) {
  return (
    <AdminForm action={completeDeletionAction}>
      {(pending) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Label htmlFor={`del-${id}`}>Type DELETE to permanently delete this account</Label>
          <div className="flex flex-wrap gap-2">
            <Input id={`del-${id}`} name="confirm" autoComplete="off" className="h-11 w-40 font-mono" />
            <Button type="submit" variant="destructive" size="sm" className="min-h-11" disabled={pending}>
              Complete deletion
            </Button>
          </div>
        </>
      )}
    </AdminForm>
  );
}
