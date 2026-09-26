import type { Metadata } from "next";
import { CustomIntakeForm } from "@/components/intake/custom-intake-form";
import { PageHeader } from "@/components/site/page-header";
import { FamilyId } from "@/domain/families";
import { FoundationId } from "@/domain/foundations";
import { getPublicCatalogItem } from "@/server/catalog-source";

export const metadata: Metadata = {
  title: "Custom build",
  description: "Describe the AI system you need. A person reviews every request and agrees acceptance criteria with you before any build.",
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CustomPage(props: PageProps<"/custom">) {
  const params = await props.searchParams;
  const slug = first(params.slug);
  const item = slug ? await getPublicCatalogItem(slug) : undefined;
  const family = FamilyId.safeParse(first(params.family) ?? item?.family);
  const foundation = FoundationId.safeParse(first(params.foundation) ?? item?.foundation);

  return (
    <>
      <PageHeader
        eyebrow="Custom build"
        title="Tell us what you need"
        lede="A person reviews every request. We agree written acceptance criteria with you before any build, and nothing goes live until it passes them."
      />
      <div className="site-container grid gap-12 py-10 lg:grid-cols-[1.6fr_1fr]">
        <CustomIntakeForm
          defaults={{
            family: family.success ? family.data : undefined,
            foundation: foundation.success ? foundation.data : undefined,
            catalogSlug: item?.slug,
            catalogName: item?.name,
          }}
        />
        <aside className="space-y-4 text-sm text-muted-foreground lg:pt-10">
          <h2 className="font-mono text-xs tracking-widest text-foreground uppercase">What happens next</h2>
          <ol className="space-y-3">
            <li><span className="font-mono text-primary">01</span> We review your request, usually within two working days.</li>
            <li><span className="font-mono text-primary">02</span> A scoping conversation to agree outcomes and acceptance criteria.</li>
            <li><span className="font-mono text-primary">03</span> A written quote. Billing is not yet enabled online.</li>
            <li><span className="font-mono text-primary">04</span> Build in an isolated cell, acceptance testing, then activation on your approval.</li>
          </ol>
          <p className="rounded-lg border border-border/80 p-4">
            Please do not include passwords, API keys or other secrets. When a system needs access to your tools, we connect it through secret references.
          </p>
        </aside>
      </div>
    </>
  );
}
