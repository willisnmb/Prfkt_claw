import { AUTO_DEFAULT_INPUT, type AutoInput } from "@/domain/auto";
import type { CatalogItem } from "@/domain/catalog/schema";

/** Starting answers for the configurator when arriving from a catalog item. */
export function presetFromItem(item: CatalogItem | undefined): AutoInput {
  const base: AutoInput = { ...AUTO_DEFAULT_INPUT };
  if (!item) return base;
  switch (item.family) {
    case "CLAW":
      return { ...base, persistentConversation: true };
    case "FLOW":
      return { ...base, persistentConversation: false, explicitStates: true, latency: "near-real-time" };
    case "CREW":
      return { ...base, persistentConversation: false, multiAgentBenefit: true, concurrency: "department", latency: "near-real-time" };
    case "STRICT":
      return { ...base, persistentConversation: false, strictSchema: true, latency: "near-real-time" };
    case "EDGE":
      return { ...base, edgeHardware: true, privacy: "sensitive", concurrency: "single" };
    case "SECURE":
      return { ...base, privacy: "regulated", governance: "strict" };
    default:
      return base;
  }
}
