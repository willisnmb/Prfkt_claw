import type { CatalogItem } from "@/domain/catalog/schema";
import { cn } from "@/lib/utils";
import { ACTION_LABELS, RULE_LABELS } from "./labels";

const TONE: Record<string, string> = {
  ok: "text-success",
  gate: "text-warning",
  draft: "text-[var(--family-flow)]",
  deny: "text-destructive",
};

/** The governed-actions table: what this system may do and under which SHIELD rule. */
export function GovernedActions({ actions }: { actions: CatalogItem["actions"] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/80">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Actions this system can take and how each is governed</caption>
        <thead className="bg-muted/40 font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Action
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Rule
            </th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => {
            const r = RULE_LABELS[a.rule];
            return (
              <tr key={a.action} className="border-t border-border/60">
                <th scope="row" className="px-4 py-3 align-top font-normal">
                  <span className="font-medium">{ACTION_LABELS[a.action].label}</span>
                  <span className="block text-xs text-muted-foreground">{ACTION_LABELS[a.action].hint}</span>
                </th>
                <td className={cn("px-4 py-3 align-top font-mono text-xs tracking-wide uppercase", TONE[r.tone])}>{r.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
