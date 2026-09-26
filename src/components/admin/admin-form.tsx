"use client";

import { useActionState, type ReactNode } from "react";
import type { AdminFormState } from "@/server/actions/admin";
import { cn } from "@/lib/utils";

/** Owner action form: pending state + announced result. Authorization happens in the action. */
export function AdminForm({
  action,
  children,
  className,
  inline,
}: {
  action: (prev: AdminFormState, fd: FormData) => Promise<AdminFormState>;
  children: (pending: boolean) => ReactNode;
  className?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<AdminFormState, FormData>(action, null);
  return (
    <form action={formAction} className={cn(inline ? "flex flex-wrap items-center gap-2" : "space-y-2", className)}>
      {children(pending)}
      <span aria-live="polite" className="text-xs">
        {state?.ok === true && <span className="text-success">{state.message}</span>}
        {state?.ok === false && (
          <span role="alert" className="text-destructive">
            {state.message}
          </span>
        )}
      </span>
    </form>
  );
}
