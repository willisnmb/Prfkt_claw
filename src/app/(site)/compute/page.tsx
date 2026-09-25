import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/site/page-header";
import { COMPUTE_CLASS_IDS, COMPUTE_CLASSES, MODEL_POLICIES, MODEL_POLICY_IDS } from "@/domain/registries";

export const metadata: Metadata = {
  title: "Compute & models",
  description: "Model policies and compute classes for PRFKT systems. No silent paid fallback; cloud burst metered by compute time.",
};

const ROUTE_LABEL = { local: "Local", "customer-provider": "Your provider", "managed-provider": "Managed provider" } as const;

export default function ComputePage() {
  return (
    <>
      <PageHeader
        eyebrow="Compute & models"
        title="You choose where models run — and what they may cost"
        lede="Every system has an explicit model policy and compute class. Local models are a first-class route, and no system ever falls back to a paid route without an explicit, recorded approval."
      />
      <Section
        id="model-policies"
        title="Model policies"
        intro="A model policy decides which routes a system may use, in order. Policies that can incur managed-provider cost are marked, and every such call counts against a daily ceiling."
      >
        <ul role="list" className="grid gap-4 md:grid-cols-2">
          {MODEL_POLICY_IDS.map((id) => {
            const p = MODEL_POLICIES[id];
            return (
              <li key={id} className="rounded-xl border border-border/80 bg-card/60 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{p.label}</h3>
                  <span className={p.mayIncurManagedCost ? "font-mono text-xs text-warning" : "font-mono text-xs text-success"}>
                    {p.mayIncurManagedCost ? "May incur managed cost" : "No managed cost"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
                <p className="mt-3 font-mono text-xs text-muted-foreground">
                  Routes: {p.routes.map((r) => ROUTE_LABEL[r]).join(" → ")}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <strong className="text-primary">No silent paid fallback.</strong> If a local or customer-provider route is unavailable, the call fails or waits for
          approval according to policy. It never quietly switches to a route that costs you money.
        </p>
      </Section>
      <Section
        id="compute-classes"
        title="Compute classes"
        intro="Compute is sized to how many people use a system and which models it needs. Cloud burst is metered by compute time — not by the size of a model file."
      >
        <div className="overflow-x-auto rounded-xl border border-border/80">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Compute classes</caption>
            <thead className="bg-muted/40 font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Class</th>
                <th scope="col" className="px-4 py-3 font-medium">Suited to</th>
                <th scope="col" className="px-4 py-3 font-medium">Metering</th>
              </tr>
            </thead>
            <tbody>
              {COMPUTE_CLASS_IDS.map((id) => {
                const c = COMPUTE_CLASSES[id];
                return (
                  <tr key={id} className="border-t border-border/60">
                    <th scope="row" className="px-4 py-3 align-top font-medium">{c.label}</th>
                    <td className="px-4 py-3 align-top text-muted-foreground">{c.description}</td>
                    <td className="px-4 py-3 align-top font-mono text-xs">{c.metering === "none" ? "Not metered by PRFKT" : "Compute-hours"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
