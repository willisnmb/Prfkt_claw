"use client";

import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelDeletionAction,
  cancelDeploymentAction,
  requestDeletionAction,
  requestDeploymentAction,
} from "@/server/actions/dashboard";
import { ActionForm } from "./action-form";

export function RequestDeploymentForm({ configurationId, configurationName }: { configurationId: string; configurationName: string }) {
  return (
    <ActionForm action={requestDeploymentAction} successMessage="Sent for owner review. You'll see the decision here.">
      {(pending) => (
        <>
          <input type="hidden" name="configurationId" value={configurationId} />
          <Label htmlFor={`note-${configurationId}`} className="sr-only">
            Note for the reviewer about {configurationName}
          </Label>
          <Textarea id={`note-${configurationId}`} name="note" maxLength={2000} rows={2} placeholder="Anything the reviewer should know (optional)" />
          <Button type="submit" size="sm" className="min-h-11" disabled={pending}>
            {pending && <Loader2Icon aria-hidden="true" className="animate-spin" />} Request deployment
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function CancelDeploymentForm({ id }: { id: string }) {
  return (
    <ActionForm action={cancelDeploymentAction} successMessage="Request cancelled.">
      {(pending) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="outline" className="min-h-11" disabled={pending}>
            Cancel request
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function RequestDeletionForm() {
  return (
    <ActionForm action={requestDeletionAction} successMessage="Deletion requested. The owner will process it and confirm.">
      {(pending) => (
        <>
          <div className="space-y-2">
            <Label htmlFor="deletion-reason">Reason (optional)</Label>
            <Textarea id="deletion-reason" name="reason" maxLength={1000} rows={2} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deletion-confirm">Type DELETE to confirm</Label>
            <Input id="deletion-confirm" name="confirm" autoComplete="off" autoCapitalize="characters" required className="h-11 max-w-48 font-mono" />
          </div>
          <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>
            Request account deletion
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function CancelDeletionForm() {
  return (
    <ActionForm action={cancelDeletionAction} successMessage="Deletion request cancelled.">
      {(pending) => (
        <Button type="submit" variant="outline" className="min-h-11" disabled={pending}>
          Cancel deletion request
        </Button>
      )}
    </ActionForm>
  );
}
