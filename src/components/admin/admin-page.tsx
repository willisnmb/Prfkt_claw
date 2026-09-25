import type { ReactNode } from "react";
import { isDatabaseConfigured } from "@/server/env";

export function AdminPageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Renders children only when the control-plane database is configured. */
export function RequireDatabase({ children }: { children: ReactNode }) {
  if (!isDatabaseConfigured()) {
    return (
      <div role="status" className="rounded-lg border border-dashed border-border p-6">
        <p className="font-medium">Database not configured</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Set DATABASE_URL (server-only) to manage this area. Nothing is shown rather than showing stale or seed data as if it were live.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
