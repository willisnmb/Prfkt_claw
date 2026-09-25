import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Terms", description: "Terms for using the PRFKT CLAW website, configurator and custom request service." };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" lede="The terms for using this website, the configurator and the custom request form." updated="25 September 2026" draft>
      <h2>The website and configurator</h2>
      <p>
        The catalog and configurator describe systems we can build and operate. A configurator recommendation is guidance, not an offer; every engagement is scoped and
        quoted separately.
      </p>
      <h2>Maturity labels</h2>
      <p>
        READY means every release gate has recorded, passing evidence. CONFIGURABLE and CUSTOM systems are accepted against agreed criteria before go-live. We do not
        switch on a system before acceptance tests pass and you approve activation.
      </p>
      <h2>Billing</h2>
      <p>Online billing is not yet enabled. Any paid engagement is governed by a separate written agreement.</p>
      <h2>Acceptable use</h2>
      <ul>
        <li>Do not submit other people&apos;s personal data through the custom request form without their permission.</li>
        <li>Do not attempt to access other customers&apos; data, probe the service without a written testing agreement, or automate submissions.</li>
        <li>Do not include passwords, keys or other secrets in requests; we will ask for secret references when needed.</li>
      </ul>
      <h2>Changes</h2>
      <p>We will update this page when these terms change and show the date of the latest version below.</p>
    </LegalPage>
  );
}
