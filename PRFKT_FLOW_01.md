# PRFKT FLOW 01 — Lead-to-Customer

## Purpose

First LangGraph acceptance project. Prove durable state, interruption, approval, idempotency, recovery, and explicit transitions. Use fake side-effect adapters first.

## State machine

```
NEW_LEAD
→ SOURCE_VERIFICATION
→ RESEARCH
→ RESEARCH_COMPLETE
→ QUALIFICATION_REVIEW
→ QUALIFIED | DISQUALIFIED
→ PROPOSAL_DRAFT
→ WAITING_FOR_APPROVAL
→ APPROVED_FOR_SEND | REJECTED_FOR_REVISION
→ SEND_REQUESTED
→ SENT
→ WAITING_FOR_REPLY
→ CUSTOMER_ACCEPTED | LOST | FOLLOW_UP_DUE
→ PAYMENT_CONFIRMATION
→ PAYMENT_CONFIRMED
→ PROVISIONING_REVIEW
→ PROVISIONING
→ CONFIG_VALIDATION
→ ACCEPTANCE_TEST
→ DEPLOYMENT_APPROVAL
→ ACTIVE
```

## Durable state record

workflow_id, tenant_id, lead_id, current_state, previous_state, state_version, idempotency_key, evidence IDs, output, validator result, approval ID, retry count, last error, created/updated timestamps.

## Mandatory approvals

Proposal send, payment-sensitive state, provisioning, production activation.

## Fake adapters

FakeResearch, FakeEmail, FakePayment, FakeProvisioner, FakeAcceptance.

## Required acceptance scenarios

1. Normal path reaches ACTIVE exactly once.
2. Kill at WAITING_FOR_APPROVAL; restart; resume without rerunning completed steps.
3. Reject proposal; verify no send; revision requires new approval.
4. Duplicate webhook produces one transition and no duplicate side effect.
5. Model timeout causes bounded retries and no implicit advancement.
6. Malformed structured output is rejected by schema.
7. Provisioner failure resumes/idempotently compensates.
8. Failed acceptance test blocks ACTIVE.

## UI

Show timeline, current state, pending approval, evidence, retries, error, resume status, and audit history.

## Metrics

Duration, active compute, model calls, tokens, estimated cost, retries, approvals, failures, recovery count, duplicate events suppressed.

## Done

FLOW 01 is complete only when an intentional process termination resumes from persisted state without duplicating completed side effects.
