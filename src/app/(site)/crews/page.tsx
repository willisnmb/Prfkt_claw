import type { Metadata } from "next";
import { FamilyPage } from "@/components/catalog/family-page";

export const metadata: Metadata = {
  title: "Crews",
  description: "Multi-agent teams with clear roles, one shared budget and one approval policy — for research, marketing, recruiting and more.",
};

export default function CrewsPage() {
  return (
    <FamilyPage
      family="CREW"
      copy={{
        title: "Specialist teams you can understand",
        lede: "Role-based agent teams — a lead, specialists and reviewers — working one brief on a shared task board, under one budget and one approval policy.",
        points: [
          { title: "Roles you recognise", body: "Strategist, researcher, writer, reviewer: each role has a clear job and its own limits, so you can see who did what." },
          { title: "Reviewed before it ships", body: "Reviewers check the work against your guides and sources. Critical changes still pass deterministic validation." },
          { title: "One budget, one policy", body: "The whole crew shares cost ceilings, tool-action limits and the same approval rules as every other system." },
        ],
      }}
    />
  );
}
