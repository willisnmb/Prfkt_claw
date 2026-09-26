import type { CatalogItemInput } from "../schema";
import { A } from "./_rules";

/** AUTO items are control-plane services that recommend; they do not act on your systems. */
const base = {
  family: "AUTO",
  runtime: "control-plane",
  modelPolicies: ["lowest-cost", "balanced", "local-first"],
  compute: ["cpu"],
  deployments: ["managed-cell", "private-cloud"],
  maturity: "CONFIGURABLE",
  profile: "SAFE",
} as const satisfies Partial<CatalogItemInput>;

export const AUTO_ITEMS: CatalogItemInput[] = [
  {
    ...base,
    slug: "architecture-advisor",
    name: "Architecture Advisor",
    foundation: "developer-builder",
    summary: "Maps your requirements to the right kind of AI system and explains every choice it makes.",
    description:
      "Answer eleven questions — conversation, explicit states, teams, strict outputs, edge hardware, privacy, governance, latency, budget, concurrency and approvals — and the Architecture Advisor recommends a system family, deployment, model policy and compute class. The recommendation is deterministic and each decision carries the reason behind it.",
    outcomes: [
      "A recommended system shape from eleven questions",
      "A reason attached to every decision",
      "The same inputs always give the same answer",
    ],
    integrations: ["Configurator", "Export to PDF"],
    actions: [A.read, A.draft, A.adminDeny],
    tags: ["recommendation", "architecture"],
  },
  {
    ...base,
    slug: "model-router",
    name: "Model Router",
    foundation: "developer-builder",
    summary: "Routes each step to local, your-provider or managed models under the policy you choose — never a silent paid fallback.",
    description:
      "The Model Router applies your model policy per step: local only, local first, your provider, managed, balanced, maximum intelligence or lowest cost. When a route is unavailable it fails or asks for approval according to policy; it never silently switches to a paid route. Every routing decision is logged with its cost estimate.",
    outcomes: [
      "Per-step routing under an explicit model policy",
      "No silent fallback to paid routes",
      "Routing decisions logged with cost estimates",
    ],
    integrations: ["Local model server", "Your provider account", "Managed providers"],
    actions: [A.read, A.spendApproval, A.adminDeny],
    tags: ["routing", "cost-control"],
  },
  {
    ...base,
    slug: "compute-planner",
    name: "Compute Planner",
    foundation: "operations",
    summary: "Sizes the compute class for your workload from concurrency and model needs, and shows the trade-offs.",
    description:
      "The Compute Planner takes your expected users, workloads and model policy and proposes a compute class — from CPU through unified-memory nodes to large GPU classes — with the trade-offs of the options either side. Cloud burst is planned by compute time, not by model file size.",
    outcomes: [
      "A proposed compute class with alternatives",
      "Trade-offs shown for the options either side",
      "Burst planned by compute time",
    ],
    integrations: ["Configurator", "Usage exports"],
    actions: [A.read, A.draft, A.adminDeny],
    tags: ["capacity", "sizing"],
  },
  {
    ...base,
    slug: "cost-guard",
    name: "Cost Guard",
    foundation: "finance-admin",
    summary: "Daily model-cost and compute ceilings per system, with alerts before limits and hard stops at them.",
    description:
      "Cost Guard tracks estimated model and compute spend per system and per day. It alerts at thresholds you set and stops further paid calls at the ceiling until an owner approves more. Estimates and actuals are reconciled so you can see where forecasts were wrong.",
    outcomes: [
      "Per-system daily cost ceilings",
      "Alerts before limits, hard stops at limits",
      "Estimates reconciled with actuals",
    ],
    integrations: ["Usage exports", "Slack", "Email"],
    actions: [A.read, A.write, A.spendDeny, A.adminDeny],
    tags: ["budgets", "limits"],
  },
  {
    ...base,
    slug: "local-first-planner",
    name: "Local-First Planner",
    foundation: "knowledge-memory",
    summary: "Identifies which steps of your system can run on local models and what that means for privacy and cost.",
    description:
      "The Local-First Planner reviews each step of a proposed system and marks which can run on local models, which need more capable routes and why. It estimates the privacy and cost effect of moving steps local and proposes a local-first policy you can adopt step by step.",
    outcomes: [
      "Each step classified as local-capable or not, with reasons",
      "Privacy and cost effect of moving steps local",
      "A staged local-first adoption plan",
    ],
    integrations: ["Configurator", "Local model server"],
    actions: [A.read, A.draft, A.adminDeny],
    modelPolicies: ["local-first", "local-only"],
    tags: ["local", "privacy"],
  },
  {
    ...base,
    slug: "provider-comparison",
    name: "Provider Comparison",
    foundation: "research",
    summary: "Compares model routes on your own evaluation tasks, so choices rest on your data rather than headlines.",
    description:
      "Provider Comparison runs your evaluation set across the routes you are considering and reports quality, cost and latency on your tasks. Results are reproducible, dated and kept with the exact configuration used, so decisions can be revisited when models change.",
    outcomes: [
      "Quality, cost and latency measured on your tasks",
      "Reproducible, dated results with exact configuration",
      "Decisions revisitable as models change",
    ],
    integrations: ["Evaluation datasets", "Your provider accounts"],
    actions: [A.read, A.draft, A.spendApproval, A.adminDeny],
    tags: ["evaluation", "benchmarking"],
  },
  {
    ...base,
    slug: "capacity-forecaster",
    name: "Capacity Forecaster",
    foundation: "operations",
    summary: "Forecasts when your systems will need more compute from real usage, with lead time to plan the change.",
    description:
      "The Capacity Forecaster reads usage trends per system and projects when the current compute class will run short, with a confidence range. It proposes the change and the lead time needed, and it flags forecasts built on too little history.",
    outcomes: [
      "Projected capacity shortfalls with confidence ranges",
      "Proposed changes with lead time",
      "Low-history forecasts clearly flagged",
    ],
    integrations: ["Usage metrics", "Slack", "Email"],
    actions: [A.read, A.draft, A.adminDeny],
    tags: ["forecasting", "capacity"],
  },
  {
    ...base,
    slug: "model-migration-planner",
    name: "Model Migration Planner",
    foundation: "developer-builder",
    summary: "Plans a move between models or providers with side-by-side checks, staged rollout and a rollback path.",
    description:
      "When a model is retired or a better option appears, the Migration Planner runs your evaluation set on both routes, highlights regressions and proposes a staged rollout with a rollback path. Switching production routing is an approval-gated deploy action.",
    outcomes: [
      "Side-by-side checks before any switch",
      "Regressions highlighted per task",
      "Staged rollout with rollback, approval-gated",
    ],
    integrations: ["Evaluation datasets", "Model Router"],
    actions: [A.read, A.draft, A.deployApproval, A.adminDeny],
    tags: ["migration", "rollout"],
  },
  {
    ...base,
    slug: "evaluation-bench",
    name: "Evaluation Bench",
    foundation: "security-compliance",
    summary: "Keeps an evaluation set for each system and re-runs it on every change, blocking regressions from release.",
    description:
      "Evaluation Bench maintains a versioned evaluation set per system — expected behaviours, refusal cases and injection tests — and re-runs it whenever prompts, models or tools change. A regression blocks the release until it is fixed or explicitly accepted by an owner.",
    outcomes: [
      "Versioned evaluation sets per system",
      "Re-run automatically on every change",
      "Regressions block release until resolved",
    ],
    integrations: ["CI pipelines", "GitHub Actions"],
    actions: [A.read, A.write, A.deployDeny, A.adminDeny],
    tags: ["evals", "regression"],
  },
  {
    ...base,
    slug: "budget-planner",
    name: "AI Budget Planner",
    foundation: "finance-admin",
    summary: "Turns planned systems and usage into a monthly budget range, separating setup, cells, compute and model use.",
    description:
      "The Budget Planner converts your planned systems and expected usage into a monthly range, separating one-off setup, per-cell running costs, compute time and model usage by policy. Assumptions are listed so finance can challenge them.",
    outcomes: [
      "A monthly budget range by cost component",
      "Assumptions listed for review",
      "Scenarios for different model policies",
    ],
    integrations: ["Spreadsheet export", "Configurator"],
    actions: [A.read, A.draft, A.adminDeny],
    tags: ["budgeting", "planning"],
  },
  {
    ...base,
    slug: "latency-tuner",
    name: "Latency Tuner",
    foundation: "developer-builder",
    summary: "Finds the slow steps in your systems and proposes routing, caching or compute changes with measured effect.",
    description:
      "The Latency Tuner traces where time goes in each run — model calls, tools, waits — and proposes changes such as routing a step locally, caching stable context or moving to a different compute class. Proposals include the measured effect on a test run before you adopt them.",
    outcomes: [
      "Per-step timing for each system",
      "Proposed changes with measured effect",
      "Adoption only after review",
    ],
    integrations: ["Run traces", "Model Router"],
    actions: [A.read, A.draft, A.deployApproval, A.adminDeny],
    tags: ["latency", "performance"],
  },
  {
    ...base,
    slug: "deployment-selector",
    name: "Deployment Selector",
    foundation: "security-compliance",
    summary: "Recommends managed, private-cloud, on-premises or edge deployment from your data and governance requirements.",
    description:
      "The Deployment Selector weighs data sensitivity, governance requirements, connectivity and budget and recommends where each system should run. It lists the controls each option requires and flags combinations that cannot be met, such as air-gapped operation with hosted models.",
    outcomes: [
      "A deployment recommendation per system",
      "Required controls listed for each option",
      "Impossible combinations flagged early",
    ],
    integrations: ["Configurator"],
    actions: [A.read, A.draft, A.adminDeny],
    tags: ["deployment", "governance"],
  },
  {
    ...base,
    slug: "local-hardware-sizer",
    name: "Local Hardware Sizer",
    foundation: "learning-maker",
    summary: "Helps you choose hardware for running models at home, in class or at the bench, from what you want to do.",
    description:
      "Describe what you want to run locally and how many people will use it; the Hardware Sizer suggests memory and compute classes that fit, what each allows and where the limits are. It makes no vendor performance claims — it explains the trade-offs and lets you test.",
    outcomes: [
      "Memory and compute classes that fit your plans",
      "Clear explanation of limits and trade-offs",
      "No vendor performance claims",
    ],
    integrations: ["Configurator"],
    actions: [A.read, A.draft, A.adminDeny],
    modelPolicies: ["local-only", "local-first"],
    deployments: ["edge-device", "on-prem"],
    compute: ["customer-hardware", "unified-memory-node"],
    tags: ["hardware", "local"],
  },
];
