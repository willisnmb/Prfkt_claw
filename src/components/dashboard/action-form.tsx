"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/domain/intake";
import { cn } from "@/lib/utils";

type Result = ActionResult<{ id: string }> | null;

/**
 * Wraps a customer server action with pending state and an announced result.
 * Children receive `pending` so the submit button can disable itself.
 */
export function ActionForm({
  action,
  children,
  successMessage,
  className,
}: {
  action: (prev: Result, fd: FormData) => Promise<Result>;
  children: (pending: boolean) => ReactNode;
  successMessage: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<Result, FormData>(action, null);
  return (
    <form action={formAction} className={cn("space-y-2", className)}>
      {children(pending)}
      <p aria-live="polite" className="min-h-5 text-sm">
        {state?.ok === true && <span className="text-success">{successMessage}</span>}
        {state?.ok === false && (
          <span role="alert" className="text-destructive">
            {state.error}
          </span>
        )}
      </p>
    </form>
  );
}
