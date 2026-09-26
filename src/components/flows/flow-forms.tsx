"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideFlowApproval, retryFlowRun, startFlowRun, type FlowFormState } from "@/app/admin/flows/actions";

function Result({ state }: { state: FlowFormState }) {
  return (
    <p aria-live="polite" className="min-h-5 text-sm">
      {state?.ok === true && <span className="text-success">{state.message}</span>}
      {state?.ok === false && (
        <span role="alert" className="text-destructive">
          {state.message}
        </span>
      )}
    </p>
  );
}

export function ApprovalDecisionForm({ approvalId, workflowId }: { approvalId: string; workflowId: string }) {
  const [state, action, pending] = useActionState<FlowFormState, FormData>(decideFlowApproval, null);
  const [rejecting, setRejecting] = useState(false);
  const reasonId = useId();
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="workflowId" value={workflowId} />
      {rejecting && (
        <div className="space-y-1.5">
          <Label htmlFor={reasonId}>Reason for rejection (sent into the revision)</Label>
          <Textarea id={reasonId} name="reason" required minLength={3} maxLength={2000} rows={3} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!rejecting ? (
          <>
            <Button type="submit" name="decision" value="approved" disabled={pending} className="min-h-11">
              {pending ? "Recording…" : "Approve"}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setRejecting(true)} disabled={pending}>
              Reject…
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value="rejected" variant="destructive" disabled={pending} className="min-h-11">
              {pending ? "Recording…" : "Reject with reason"}
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setRejecting(false)} disabled={pending}>
              Cancel
            </Button>
          </>
        )}
      </div>
      <Result state={state} />
    </form>
  );
}

export function RetryRunForm({ workflowId }: { workflowId: string }) {
  const [state, action, pending] = useActionState<FlowFormState, FormData>(retryFlowRun, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workflowId" value={workflowId} />
      <Button type="submit" variant="outline" disabled={pending} className="min-h-11">
        {pending ? "Retrying…" : "Retry step"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function StartRunForm({ sources }: { sources: readonly string[] }) {
  const [state, action, pending] = useActionState<FlowFormState, FormData>(startFlowRun, null);
  const id = useId();
  const field = (name: string, label: string, type = "text", placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-${name}`}>{label}</Label>
      <Input id={`${id}-${name}`} name={name} type={type} required placeholder={placeholder} className="min-h-11" />
    </div>
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {field("name", "Contact name")}
      {field("company", "Company")}
      {field("email", "Contact email", "email")}
      {field("website", "Company website", "url", "https://")}
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-source`}>Lead source</Label>
        <select id={`${id}-source`} name="source" className="min-h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm" defaultValue={sources[0]}>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="min-h-11 w-full sm:w-auto">
          {pending ? "Starting…" : "Start FLOW 01"}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <Result state={state} />
      </div>
    </form>
  );
}
