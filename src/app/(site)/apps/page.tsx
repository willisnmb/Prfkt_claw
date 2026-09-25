import type { Metadata } from "next";
import { FamilyPage } from "@/components/catalog/family-page";

export const metadata: Metadata = {
  title: "AI Apps",
  description: "AI applications whose every output is schema-validated before it reaches a person, a database or another system.",
};

export default function AppsPage() {
  return (
    <FamilyPage
      family="STRICT"
      copy={{
        title: "AI apps with outputs you can rely on",
        lede: "Applications whose every model output must pass a typed contract before it reaches a user, a database or another system. If it does not validate, it does not ship.",
        points: [
          { title: "Typed contracts", body: "Each output has a schema — fields, formats, arithmetic checks. Invalid results are rejected with the exact reason." },
          { title: "No guessing", body: "Missing or contradictory inputs are routed to review instead of being filled in with plausible-looking values." },
          { title: "Safe to automate against", body: "Because results are validated, your CRM, ledger or planning system can consume them without extra cleanup." },
        ],
      }}
    />
  );
}
