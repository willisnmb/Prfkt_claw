import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";
import { SECURITY_CONTACT, SUPPORT_EMAIL } from "@/components/site/site-config";

export const metadata: Metadata = { title: "Privacy", description: "How PRFKT handles personal data, customer data, secrets, export and deletion." };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" lede="What we collect, why, where it lives and how you can export or delete it." updated="25 September 2026" draft>
      <h2>What we collect</h2>
      <ul>
        <li>Account details you give us: name, email address and company.</li>
        <li>Configurations you save and custom build requests you submit.</li>
        <li>For customers with a running system: the data that system processes inside your isolated cell, as agreed during scoping.</li>
        <li>Security and audit records of actions taken in the control plane.</li>
      </ul>
      <h2>What we never store</h2>
      <p>
        Passwords, API keys, OAuth refresh tokens, private keys, service-role keys, payment credentials and gateway tokens are never placed in prompts, memory, documents,
        logs, analytics or your browser&apos;s local storage. Integrations use secret references resolved by a broker at the moment of use.
      </p>
      <h2>Isolation</h2>
      <p>Each customer&apos;s systems run in a separate runtime cell. Database access policies prevent one customer from reading or acting on another customer&apos;s records.</p>
      <h2>Model providers</h2>
      <p>
        Which model routes process your data is set by your model policy. Local-only and local-first policies keep processing on local models; customer-provider policies
        use your own provider account. We never switch your data to a paid external route without an explicit, recorded approval.
      </p>
      <h2>Export and deletion</h2>
      <p>
        You can request a complete, machine-readable export of your configurations, requests, memory and audit history, and you can request deletion. Deletion is executed
        across our stores and confirmed with a deletion record, except where the law requires us to retain something — in which case we will tell you what and why.
      </p>
      <h2>Contact</h2>
      <p>
        Privacy questions: {SUPPORT_EMAIL}. Security issues: {SECURITY_CONTACT}.
      </p>
    </LegalPage>
  );
}
