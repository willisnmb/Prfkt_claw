import { z } from "zod";

/** The 14 foundations from HANDOFF.md. Every catalog item belongs to exactly one. */
export const FOUNDATION_IDS = [
  "chief",
  "research",
  "crm-sales",
  "support",
  "operations",
  "finance-admin",
  "marketing-creative",
  "developer-builder",
  "commerce-inventory",
  "voice-reception",
  "knowledge-memory",
  "security-compliance",
  "family-play",
  "learning-maker",
] as const;
export const FoundationId = z.enum(FOUNDATION_IDS);
export type FoundationId = z.infer<typeof FoundationId>;

export interface Foundation {
  id: FoundationId;
  name: string;
  summary: string;
}

export const FOUNDATIONS: Record<FoundationId, Foundation> = {
  chief: { id: "chief", name: "Chief", summary: "Chief-of-staff systems: briefings, priorities, follow-through and decision logs." },
  research: { id: "research", name: "Research", summary: "Sourced research, monitoring and synthesis with citations you can check." },
  "crm-sales": { id: "crm-sales", name: "CRM / Sales", summary: "Lead intake, qualification, proposals and pipeline hygiene with approval before anything is sent." },
  support: { id: "support", name: "Support", summary: "Ticket triage, drafted replies and escalation with your policies attached." },
  operations: { id: "operations", name: "Operations", summary: "Scheduling, handoffs, checklists and exception handling for day-to-day operations." },
  "finance-admin": { id: "finance-admin", name: "Finance / Admin", summary: "Invoices, reconciliations and admin paperwork, draft-first and never auto-paying." },
  "marketing-creative": { id: "marketing-creative", name: "Marketing / Creative", summary: "Campaign drafts, content calendars and brand-checked creative, publish on approval." },
  "developer-builder": { id: "developer-builder", name: "Developer / Builder", summary: "Code review, test triage and release notes inside a bounded workspace." },
  "commerce-inventory": { id: "commerce-inventory", name: "Commerce / Inventory", summary: "Catalog upkeep, stock signals and order exceptions for online and physical stores." },
  "voice-reception": { id: "voice-reception", name: "Voice / Reception", summary: "Call answering, booking and message taking with clear handoff to a person." },
  "knowledge-memory": { id: "knowledge-memory", name: "Knowledge / Memory", summary: "Organisational memory with provenance, corrections and retention rules." },
  "security-compliance": { id: "security-compliance", name: "Security / Compliance", summary: "Evidence collection, policy checks and audit preparation." },
  "family-play": { id: "family-play", name: "Family / Play", summary: "Household planning, games and learning companions with guardian controls." },
  "learning-maker": { id: "learning-maker", name: "Learning / Maker", summary: "Tutors, study plans and maker-project guides that run locally where possible." },
};

export const FOUNDATION_LIST: Foundation[] = FOUNDATION_IDS.map((id) => FOUNDATIONS[id]);
