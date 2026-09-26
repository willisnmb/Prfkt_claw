import type { CatalogItemInput } from "../schema";
import { A } from "./_rules";

/**
 * SECURE is a runtime-independent acceptance standard: each item is a governed
 * deployment inside the customer's boundary, accepted against SHIELD gates.
 */
const base = {
  family: "SECURE",
  runtime: "openclaw",
  modelPolicies: ["local-first", "customer-provider", "local-only"],
  compute: ["unified-memory-node", "gpu-48gb", "gpu-80-96gb"],
  deployments: ["private-cloud", "on-prem"],
  maturity: "CUSTOM",
  profile: "SAFE",
} as const satisfies Partial<CatalogItemInput>;

export const SECURE_ITEMS: CatalogItemInput[] = [
  {
    ...base,
    slug: "private-workspace",
    name: "Private Assistant Workspace",
    foundation: "chief",
    summary: "A governed assistant workspace deployed in your own cloud account, with your keys, logs and approvals.",
    description:
      "The Private Assistant Workspace runs in a cell inside your cloud account. Identity comes from your provider, secrets stay in your vault and are referenced rather than copied, logs go to your logging stack and every consequential action is approval-gated. Acceptance covers isolation, secrets handling and audit before go-live.",
    outcomes: [
      "An assistant workspace inside your own cloud boundary",
      "Secrets referenced from your vault, never copied into prompts",
      "Isolation and audit accepted before go-live",
    ],
    integrations: ["Microsoft Entra ID", "Okta", "AWS", "Azure", "Google Cloud"],
    actions: [A.read, A.draft, A.write, A.sendApproval, A.deleteApproval, A.adminDeny],
    tags: ["private-cloud", "sso"],
  },
  {
    ...base,
    slug: "air-gapped-assistant",
    name: "Air-Gapped Assistant",
    foundation: "knowledge-memory",
    summary: "A knowledge assistant for networks with no internet connection: local models, local index, offline updates.",
    description:
      "For environments with no outbound connectivity, the Air-Gapped Assistant runs entirely on your hardware: local models, a local document index and an offline update process with verifiable packages. Any request that would need an external service fails closed. Acceptance is performed on site against your requirements.",
    outcomes: [
      "Question answering with no external connectivity",
      "Offline, verifiable update packages",
      "External calls fail closed by design",
    ],
    integrations: ["Local file shares", "On-prem document stores"],
    actions: [A.read, A.draft, A.sendDeny, A.deployApproval, A.adminDeny],
    modelPolicies: ["local-only"],
    deployments: ["on-prem"],
    compute: ["unified-memory-node", "gpu-80-96gb", "gpu-128gb-plus"],
    tags: ["air-gapped", "offline"],
  },
  {
    ...base,
    slug: "regulated-support",
    name: "Regulated Support Desk",
    foundation: "support",
    summary: "Support drafting for regulated industries: personal data stays in your boundary and every reply is reviewed.",
    description:
      "The Regulated Support Desk drafts replies from your approved knowledge inside your environment. Personal data is minimised in prompts, every reply is reviewed by an agent before sending, and a complete audit trail is kept in your systems. Retention and deletion follow your policies.",
    outcomes: [
      "Reply drafts generated inside your boundary",
      "Every reply reviewed before sending",
      "Audit trail and retention under your control",
    ],
    integrations: ["Zendesk", "Salesforce Service Cloud", "ServiceNow"],
    actions: [A.read, A.draft, A.write, A.sendApproval, A.adminDeny],
    tags: ["regulated", "support"],
  },
  {
    ...base,
    slug: "clinical-admin",
    name: "Clinical Admin Assistant",
    foundation: "operations",
    summary: "Administrative support for clinics — scheduling, referrals and paperwork — deployed privately. No clinical advice.",
    description:
      "The Clinical Admin Assistant handles administrative work: scheduling requests, referral paperwork, form completion and document routing. It is explicitly scoped away from diagnosis or treatment advice. Deployment is private, access follows your roles and every outbound message is approval-gated.",
    outcomes: [
      "Scheduling and referral paperwork prepared",
      "Explicitly no diagnosis or treatment advice",
      "Outbound messages approved by staff",
    ],
    integrations: ["EHR export", "Fax/email gateway", "Calendar"],
    actions: [A.read, A.draft, A.write, A.sendApproval, A.adminDeny],
    tags: ["healthcare-admin", "private"],
  },
  {
    ...base,
    slug: "matter-workspace",
    name: "Matter Workspace",
    foundation: "research",
    summary: "A private research workspace per legal matter, with walls between matters and citations to your documents.",
    description:
      "Each matter gets its own isolated workspace: documents, research notes and drafts do not cross between matters. The assistant researches and drafts with citations to your documents, and conflicts between matters are prevented by isolation rather than by instructions.",
    outcomes: [
      "One isolated workspace per matter",
      "Research and drafts cited to your documents",
      "No data crossing between matters",
    ],
    integrations: ["iManage", "NetDocuments", "SharePoint"],
    actions: [A.read, A.draft, A.write, A.sendDeny, A.adminDeny],
    tags: ["legal", "isolation"],
  },
  {
    ...base,
    slug: "finance-controls",
    name: "Finance Controls Assistant",
    foundation: "finance-admin",
    summary: "Monitors transactions against your controls inside your environment and prepares exceptions for review.",
    description:
      "The Finance Controls Assistant checks journal entries, payments and vendor changes against your control rules and prepares exception reports with evidence. It has read access to finance data, no ability to move money, and runs inside your environment with logs in your systems.",
    outcomes: [
      "Transactions checked against your control rules",
      "Exception reports with supporting evidence",
      "No ability to move money",
    ],
    integrations: ["SAP", "Oracle NetSuite", "Workday", "Snowflake"],
    actions: [A.read, A.draft, A.spendDeny, A.adminDeny],
    tags: ["controls", "finance"],
  },
  {
    ...base,
    slug: "secure-code-assistant",
    name: "Secure Code Assistant",
    foundation: "developer-builder",
    summary: "A coding assistant deployed in your environment for proprietary code, with no code leaving your boundary.",
    description:
      "The Secure Code Assistant runs inside your network against your repositories. Models run locally or through your own provider account. It works in isolated workspaces with command allowlists, and merges, releases and deployments remain approval-gated.",
    outcomes: [
      "Code assistance without code leaving your boundary",
      "Isolated workspaces with command allowlists",
      "Merges and deployments approval-gated",
    ],
    integrations: ["GitHub Enterprise", "GitLab self-managed", "Bitbucket Data Center"],
    actions: [A.read, A.draft, A.write, A.publishApproval, A.deployApproval, A.adminDeny],
    compute: ["gpu-48gb", "gpu-80-96gb", "gpu-128gb-plus"],
    tags: ["code", "private"],
  },
  {
    ...base,
    slug: "private-sales-desk",
    name: "Private Sales Desk",
    foundation: "crm-sales",
    summary: "Sales assistance for firms whose client data cannot leave their environment — CRM hygiene and drafted outreach.",
    description:
      "The Private Sales Desk keeps client records current and drafts outreach inside your environment. Client data stays in your systems, outreach is approved before sending, and suppression and consent rules are enforced before any draft is created.",
    outcomes: [
      "CRM hygiene without client data leaving your boundary",
      "Consent and suppression checked before drafting",
      "Outreach approved before sending",
    ],
    integrations: ["Salesforce", "Microsoft Dynamics", "Outlook"],
    actions: [A.read, A.draft, A.write, A.sendApproval, A.adminDeny],
    tags: ["crm", "private"],
  },
  {
    ...base,
    slug: "compliance-copilot",
    name: "Compliance Assistant",
    foundation: "security-compliance",
    summary: "Answers policy questions and prepares control evidence inside your environment, with every answer cited.",
    description:
      "Staff ask what a policy requires and receive answers cited to the policy text. For compliance teams, the assistant prepares evidence packages and drafts control narratives for review. It makes no certification claims and runs within your boundary.",
    outcomes: [
      "Policy answers cited to the policy text",
      "Evidence packages and control narratives drafted",
      "No certification claims — preparation only",
    ],
    integrations: ["SharePoint", "Confluence", "ServiceNow GRC"],
    actions: [A.read, A.draft, A.write, A.sendDeny, A.adminDeny],
    tags: ["policy", "evidence"],
  },
  {
    ...base,
    slug: "private-voice-reception",
    name: "Private Voice Reception",
    foundation: "voice-reception",
    summary: "Call answering where recordings and transcripts must stay on your infrastructure.",
    description:
      "Private Voice Reception answers and routes calls, takes structured messages and books into open slots, with speech processing and storage on your infrastructure. Recording consent is captured, retention follows your policy and transfers to a person are always available.",
    outcomes: [
      "Calls answered with audio kept on your infrastructure",
      "Consent captured and retention enforced",
      "Transfer to a person always available",
    ],
    integrations: ["SIP trunk", "Microsoft Teams Phone", "Calendar"],
    actions: [A.read, A.write, A.sendApproval, A.adminDeny],
    runtime: "nemoclaw",
    tags: ["voice", "private"],
  },
  {
    ...base,
    slug: "research-enclave",
    name: "Research Enclave",
    foundation: "research",
    summary: "A sealed research environment for sensitive datasets: analysis in place, only approved outputs leave.",
    description:
      "The Research Enclave brings analysis to your data instead of moving data out. Researchers work in isolated sessions, outputs are checked against disclosure rules and only approved outputs can leave the enclave. Every session is logged.",
    outcomes: [
      "Analysis performed where the data lives",
      "Outputs checked against disclosure rules",
      "Only approved outputs leave the enclave",
    ],
    integrations: ["Snowflake", "Databricks", "S3-compatible storage"],
    actions: [A.read, A.draft, A.write, A.publishApproval, A.sendDeny, A.adminDeny],
    runtime: "nemoclaw",
    compute: ["gpu-80-96gb", "gpu-128gb-plus", "gpu-141gb-plus"],
    tags: ["data", "disclosure-control"],
  },
  {
    ...base,
    slug: "board-pack",
    name: "Board Pack Preparer",
    foundation: "chief",
    summary: "Assembles board and committee packs from management reports, privately, with a change log between drafts.",
    description:
      "The Board Pack Preparer gathers management reports, drafts summaries and assembles the pack in your template, keeping a change log between drafts. Distribution to directors is approval-gated, and material stays inside your environment throughout.",
    outcomes: [
      "Board packs assembled in your template",
      "A change log between each draft",
      "Distribution only after approval",
    ],
    integrations: ["SharePoint", "Diligent export", "Google Drive"],
    actions: [A.read, A.draft, A.write, A.sendApproval, A.adminDeny],
    tags: ["governance", "reporting"],
  },
  {
    ...base,
    slug: "sovereign-knowledge-base",
    name: "Sovereign Knowledge Base",
    foundation: "knowledge-memory",
    summary: "Organisational memory hosted in your jurisdiction and infrastructure, with provenance and corrections preserved.",
    description:
      "The Sovereign Knowledge Base keeps organisational memory in the region and infrastructure you choose. Every entry records its source and author, corrections are versioned, and export and deletion are available at any time. Model calls follow your chosen local or customer-provider policy.",
    outcomes: [
      "Memory hosted in your chosen jurisdiction",
      "Provenance and versioned corrections on every entry",
      "Export and deletion on demand",
    ],
    integrations: ["Confluence Data Center", "SharePoint", "S3-compatible storage"],
    actions: [A.read, A.draft, A.write, A.deleteApproval, A.adminDeny],
    tags: ["sovereignty", "memory"],
  },
];
