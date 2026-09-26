import type { Metadata } from "next";
import { FamilyPage } from "@/components/catalog/family-page";

export const metadata: Metadata = {
  title: "Workflows",
  description: "Durable AI workflows with explicit states that survive restarts, pause for approval and never repeat a completed side effect.",
};

export default function WorkflowsPage() {
  return (
    <FamilyPage
      family="FLOW"
      copy={{
        title: "Workflows that survive restarts and never double-send",
        lede: "Explicit state machines for work that must be right every time. Each step is recorded, approvals pause the run, and a crash resumes from the last completed step.",
        points: [
          { title: "Explicit states", body: "Every run is in exactly one named state, with a timeline of how it got there and who approved each transition." },
          { title: "Exactly-once side effects", body: "Emails, invoices and provisioning calls carry idempotency keys. A duplicate notification or a restart never repeats them." },
          { title: "Failures stop safely", body: "Timeouts retry within a ceiling, malformed output is rejected by schema, and a failed acceptance test blocks go-live." },
        ],
      }}
    />
  );
}
