# PRFKT CLAW Architecture

## Principle

PRFKT sells finished AI systems. Framework names are implementation details unless a customer explicitly asks for them.

## Layer model

```
Customer Experience
      ↓
PRFKT Control Plane
      ↓
PRFKT AUTO / Configurator
      ↓
PRFKT SHIELD
      ↓
CLAW | FLOW | CREW | STRICT | EDGE | SECURE
      ↓
Runtime / Workflow Adapters
      ↓
Model Router
      ↓
Compute Router
      ↓
Customer Integrations
```

## Control plane owns

Identity, tenant records, catalog, configurations, approvals, provisioning requests, runtime/model/compute registries, integration registry, billing references, audit history, security state, backup state, and support state.

## Families

- CLAW: persistent assistant/workspace; OpenClaw-first.
- FLOW: durable explicit state machine; LangGraph-first.
- CREW: multi-agent department/team; CrewAI-first.
- STRICT: typed/validated contracts; PydanticAI-first.
- EDGE: lightweight/local runtime; ZeroClaw candidate.
- SECURE: governed deployment class; runtime-independent acceptance standard.
- AUTO: architecture optimizer.

## Tenant isolation

```
Customer A → isolated runtime cell
Customer B → isolated runtime cell
Customer C → isolated runtime cell
```

Do not place unrelated customers inside one trusted runtime boundary.

## Model policies

local-only, local-first, customer-provider, managed-provider, balanced, maximum-intelligence, lowest-cost. No silent paid fallback.

## Compute policies

CPU, customer hardware, local Halo/unified-memory node, 24 GB, 48 GB, 80–96 GB, 128+ class, 141+ class. Meter cloud burst by compute/time, not model-file GB alone.

## Observability

Every runtime/workflow exposes health, current state, last success, last error, pending approval, usage, estimated cost, backup state, version, runtime, and model route.
