import type { Metadata } from "next";
import { FamilyPage } from "@/components/catalog/family-page";

export const metadata: Metadata = {
  title: "Edge AI",
  description: "Lightweight AI systems that run on your own devices — laptops, kiosks, store servers and single-board computers.",
};

export default function EdgePage() {
  return (
    <FamilyPage
      family="EDGE"
      copy={{
        title: "Small systems that run where the work happens",
        lede: "Lightweight agents for laptops, kiosks, store servers, classrooms and workshop benches, with local models as the default route. We size each deployment on your hardware rather than quoting benchmark numbers.",
        points: [
          { title: "Local by default", body: "Models and data stay on the device unless you explicitly allow otherwise. Many systems keep working when the network drops." },
          { title: "Tested on your hardware", body: "We do not publish performance claims. Capacity is measured on the hardware you plan to use during acceptance." },
          { title: "Same governance", body: "Edge systems follow the same action rules, allowlists and limits as everything else — just closer to you." },
        ],
      }}
    />
  );
}
