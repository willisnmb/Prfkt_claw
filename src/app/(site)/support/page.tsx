import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/site/page-header";
import { CONTACTS_ARE_PLACEHOLDERS, SECURITY_CONTACT, SUPPORT_EMAIL } from "@/components/site/site-config";

export const metadata: Metadata = { title: "Support", description: "How to reach PRFKT support and report security issues." };

export default function SupportPage() {
  return (
    <>
      <PageHeader eyebrow="Support" title="How to reach us" lede="For questions about a request, a running system or your data, contact support. Report security issues separately." />
      <Section>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border/80 bg-card/60 p-6">
            <h2 className="text-lg font-semibold">Support</h2>
            <p className="mt-2 text-sm text-muted-foreground">Requests, running systems, data export and deletion.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-4 inline-flex min-h-11 items-center font-mono text-sm text-primary underline underline-offset-4">
              {SUPPORT_EMAIL}
            </a>
          </div>
          <div className="rounded-xl border border-border/80 bg-card/60 p-6">
            <h2 className="text-lg font-semibold">Security</h2>
            <p className="mt-2 text-sm text-muted-foreground">Vulnerability reports. Please do not include secrets or other customers&apos; data.</p>
            <a href={`mailto:${SECURITY_CONTACT}`} className="mt-4 inline-flex min-h-11 items-center font-mono text-sm text-primary underline underline-offset-4">
              {SECURITY_CONTACT}
            </a>
          </div>
        </div>
        {CONTACTS_ARE_PLACEHOLDERS && (
          <p role="note" className="mt-6 text-sm text-warning">
            These are placeholder addresses and are not yet monitored.
          </p>
        )}
        <p className="mt-8 text-sm text-muted-foreground">
          Signed-in customers can see request status, export their data and request deletion from the{" "}
          <Link href="/dashboard" prefetch={false} className="text-foreground underline underline-offset-4">
            dashboard
          </Link>
          .
        </p>
      </Section>
    </>
  );
}
