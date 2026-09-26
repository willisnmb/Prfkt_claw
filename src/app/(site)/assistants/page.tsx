import type { Metadata } from "next";
import { FamilyPage } from "@/components/catalog/family-page";

export const metadata: Metadata = {
  title: "Assistants",
  description: "Persistent AI assistants with memory, a bounded workspace and approved integrations — each in its own isolated cell.",
};

export default function AssistantsPage() {
  return (
    <FamilyPage
      family="CLAW"
      copy={{
        title: "Assistants that remember, and ask before they act",
        lede: "Long-lived assistants with memory, a bounded workspace and the integrations you approve. Each customer's assistants run in their own isolated cell.",
        points: [
          { title: "Memory with provenance", body: "Everything remembered keeps its source and time. Corrections are versioned, never silent overwrites, and secrets are rejected before storage." },
          { title: "A bounded workspace", body: "File access, commands, hosts and integrations are allowlisted. The assistant cannot reach beyond what you grant." },
          { title: "Approval where it matters", body: "Drafting is free; sending, publishing, spending, deleting and deploying wait for you — bound to the exact content you saw." },
        ],
      }}
    />
  );
}
