import { FAMILIES } from "@/domain/families";

/**
 * Public site configuration.
 * OWNER ACTION: set NEXT_PUBLIC_SUPPORT_EMAIL and NEXT_PUBLIC_SECURITY_CONTACT
 * before launch. The fallbacks below use the reserved `.example` domain and
 * are shown with a visible "placeholder" note so they are never mistaken for
 * real addresses.
 */
/** The company that operates the site and sells PRFKT CLAW. Override with NEXT_PUBLIC_COMPANY_NAME (e.g. the full legal name). */
export const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || "PRFKT_BYTE";
export const PRODUCT_NAME = "PRFKT CLAW";

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@prfkt.example";
export const SECURITY_CONTACT = process.env.NEXT_PUBLIC_SECURITY_CONTACT || "security@prfkt.example";
export const CONTACTS_ARE_PLACEHOLDERS = !process.env.NEXT_PUBLIC_SUPPORT_EMAIL || !process.env.NEXT_PUBLIC_SECURITY_CONTACT;

export interface NavLink {
  href: string;
  label: string;
  description?: string;
}

/** Product sections, one per sellable family. */
export const SYSTEM_LINKS: NavLink[] = [
  { href: FAMILIES.CLAW.section.href, label: "Assistants", description: FAMILIES.CLAW.tagline },
  { href: FAMILIES.FLOW.section.href, label: "Workflows", description: FAMILIES.FLOW.tagline },
  { href: FAMILIES.CREW.section.href, label: "Crews", description: FAMILIES.CREW.tagline },
  { href: FAMILIES.STRICT.section.href, label: "AI Apps", description: FAMILIES.STRICT.tagline },
  { href: FAMILIES.SECURE.section.href, label: "Private AI", description: FAMILIES.SECURE.tagline },
  { href: FAMILIES.EDGE.section.href, label: "Edge AI", description: FAMILIES.EDGE.tagline },
];

export const EXPLORE_LINKS: NavLink[] = [
  { href: "/catalog", label: "Catalog", description: "Every system, searchable" },
  { href: "/foundations", label: "Foundations", description: "Systems by business area" },
  { href: "/compute", label: "Compute & models", description: "Where your models run" },
];

export const PRIMARY_LINKS: NavLink[] = [
  { href: "/catalog", label: "Catalog" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
];

export const FOOTER_GROUPS: { title: string; links: NavLink[] }[] = [
  { title: "Systems", links: SYSTEM_LINKS },
  {
    title: "Explore",
    links: [...EXPLORE_LINKS, { href: "/configure", label: "Configurator" }, { href: "/custom", label: "Custom build" }],
  },
  {
    title: "Company",
    links: [
      { href: "/enterprise", label: "Enterprise" },
      { href: "/security", label: "Security" },
      { href: "/pricing", label: "Pricing" },
      { href: "/support", label: "Support" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];
