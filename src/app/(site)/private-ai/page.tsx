import type { Metadata } from "next";
import { FamilyPage } from "@/components/catalog/family-page";

export const metadata: Metadata = {
  title: "Private AI",
  description: "Governed AI deployments inside your boundary — private cloud, on-premises or air-gapped — with your keys, logs and approvals.",
};

export default function PrivateAiPage() {
  return (
    <FamilyPage
      family="SECURE"
      copy={{
        title: "AI inside your boundary, on your terms",
        lede: "Private-cloud, on-premises and air-gapped deployments with your identity provider, your secrets vault and your logs. SECURE is an acceptance standard, not a single product: whatever runs inside must pass it.",
        points: [
          { title: "Your keys, your logs", body: "Secrets stay in your vault and are referenced, never copied. Logs and audit history go to your systems." },
          { title: "Local or your provider", body: "Models run locally or through your own provider account. Nothing falls back to a paid external route without an explicit approval." },
          { title: "Accepted on your terms", body: "Isolation, secrets handling, audit, backup and restore are tested against your requirements before go-live." },
        ],
      }}
    />
  );
}
