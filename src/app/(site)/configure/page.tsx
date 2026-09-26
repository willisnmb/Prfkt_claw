import type { Metadata } from "next";
import { Configurator } from "@/components/configurator/configurator";
import { presetFromItem } from "@/components/configurator/presets";
import { PageHeader } from "@/components/site/page-header";
import { getPublicCatalogItem } from "@/server/catalog-source";

export const metadata: Metadata = {
  title: "Configurator",
  description: "Answer eleven questions and get a recommended AI system shape — family, deployment, model policy and compute — with the reasoning shown.",
};

export default async function ConfigurePage(props: PageProps<"/configure">) {
  const params = await props.searchParams;
  const slug = typeof params.slug === "string" ? params.slug : undefined;
  const item = slug ? await getPublicCatalogItem(slug) : undefined;

  return (
    <>
      <PageHeader
        eyebrow="PRFKT AUTO · Configurator"
        title={item ? `Configure ${item.name}` : "Describe what you need. We will show our reasoning."}
        lede="Eleven questions map to a recommended system family, deployment, model policy and compute class. The recommendation is deterministic, and every choice comes with its reason."
      />
      <div className="site-container py-10">
        <Configurator key={item?.slug ?? "none"} initial={presetFromItem(item)} catalogSlug={item?.slug} catalogName={item?.name} />
      </div>
    </>
  );
}
