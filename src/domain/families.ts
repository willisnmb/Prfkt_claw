import { z } from "zod";

export const FAMILY_IDS = ["CLAW", "FLOW", "CREW", "STRICT", "EDGE", "SECURE", "AUTO", "SHIELD"] as const;
export const FamilyId = z.enum(FAMILY_IDS);
export type FamilyId = z.infer<typeof FamilyId>;

export const RUNTIME_IDS = ["openclaw", "langgraph", "crewai", "pydanticai", "zeroclaw", "nemoclaw", "ollama", "control-plane"] as const;
export const RuntimeId = z.enum(RUNTIME_IDS);
export type RuntimeId = z.infer<typeof RuntimeId>;

export interface Family {
  id: FamilyId;
  name: string;
  /** Public section the family is sold under. */
  section: { href: string; label: string };
  tagline: string;
  description: string;
  primaryRuntime: RuntimeId;
  /** CSS custom property holding the family accent (see globals.css). */
  accentVar: `--family-${Lowercase<FamilyId>}`;
}

export const FAMILIES: Record<FamilyId, Family> = {
  CLAW: {
    id: "CLAW",
    name: "CLAW",
    section: { href: "/assistants", label: "Assistants" },
    tagline: "Persistent assistants and workspaces",
    description:
      "Long-lived assistants with memory, a bounded workspace and approved integrations. Each customer runs in its own runtime cell.",
    primaryRuntime: "openclaw",
    accentVar: "--family-claw",
  },
  FLOW: {
    id: "FLOW",
    name: "FLOW",
    section: { href: "/workflows", label: "Workflows" },
    tagline: "Durable workflows",
    description:
      "Explicit state machines that survive restarts, pause for approvals and never repeat a completed side effect.",
    primaryRuntime: "langgraph",
    accentVar: "--family-flow",
  },
  CREW: {
    id: "CREW",
    name: "CREW",
    section: { href: "/crews", label: "Crews" },
    tagline: "Multi-agent teams",
    description:
      "Role-based agent teams with a lead, reviewers and a shared task board, under one budget and one approval policy.",
    primaryRuntime: "crewai",
    accentVar: "--family-crew",
  },
  STRICT: {
    id: "STRICT",
    name: "STRICT",
    section: { href: "/apps", label: "AI Apps" },
    tagline: "Typed, validated AI apps",
    description:
      "Applications whose every model output is schema-validated before it reaches a user, a database or another system.",
    primaryRuntime: "pydanticai",
    accentVar: "--family-strict",
  },
  EDGE: {
    id: "EDGE",
    name: "EDGE",
    section: { href: "/edge", label: "Edge AI" },
    tagline: "Lightweight and local agents",
    description:
      "Small-footprint agents that run on a laptop, a store server or a device, with Ollama as the first-class local model route.",
    primaryRuntime: "zeroclaw",
    accentVar: "--family-edge",
  },
  SECURE: {
    id: "SECURE",
    name: "SECURE",
    section: { href: "/private-ai", label: "Private AI" },
    tagline: "Governed, private deployments",
    description:
      "Deployments inside your boundary — private cloud, on-premises or air-gapped — with your keys, your logs and your approvals.",
    primaryRuntime: "openclaw",
    accentVar: "--family-secure",
  },
  AUTO: {
    id: "AUTO",
    name: "AUTO",
    section: { href: "/configure", label: "Configurator" },
    tagline: "Architecture, model and compute recommendation",
    description:
      "A deterministic recommender that maps your requirements to a family, runtime, model route and compute tier — and explains why.",
    primaryRuntime: "control-plane",
    accentVar: "--family-auto",
  },
  SHIELD: {
    id: "SHIELD",
    name: "SHIELD",
    section: { href: "/security", label: "Security" },
    tagline: "Shared security and control",
    description:
      "The action firewall, secret broker, injection handling, blast-radius limits and audit trail every other family runs behind.",
    primaryRuntime: "control-plane",
    accentVar: "--family-shield",
  },
};

export const FAMILY_LIST: Family[] = FAMILY_IDS.map((id) => FAMILIES[id]);
