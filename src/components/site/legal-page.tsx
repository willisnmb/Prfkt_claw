import type { ReactNode } from "react";
import { PageHeader } from "./page-header";

/** Shared layout for policy pages. `draft` shows a visible owner-review notice. */
export function LegalPage({ title, lede, updated, draft, children }: { title: string; lede: string; updated: string; draft?: boolean; children: ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Legal" title={title} lede={lede} />
      <div className="site-container py-12">
        {draft && (
          <div role="note" className="mb-8 max-w-3xl rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
            <strong className="text-warning">Draft for owner and legal review.</strong> This text describes how the service is built today. It must be reviewed by
            counsel before launch.
          </div>
        )}
        <article className="max-w-3xl space-y-6 text-pretty [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground [&_ul]:space-y-2 [&_ul]:text-muted-foreground">
          {children}
          <p className="pt-6 font-mono text-xs">Last updated {updated}</p>
        </article>
      </div>
    </>
  );
}
