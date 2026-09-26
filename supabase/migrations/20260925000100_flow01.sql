-- PRFKT FLOW 01 — Lead-to-Customer durable workflow (PRFKT_FLOW_01.md).
-- The run row is the durable state record. Transitions are compare-and-set on
-- state_version, restricted to the declared graph, and ACTIVE additionally
-- requires passing acceptance evidence plus an approved production activation.

create table public.flow_transitions (
  from_state text not null,
  to_state text not null,
  primary key (from_state, to_state)
);

insert into public.flow_transitions (from_state, to_state) values
  ('NEW_LEAD', 'SOURCE_VERIFICATION'),
  ('SOURCE_VERIFICATION', 'RESEARCH'),
  ('SOURCE_VERIFICATION', 'DISQUALIFIED'),
  ('RESEARCH', 'RESEARCH_COMPLETE'),
  ('RESEARCH_COMPLETE', 'QUALIFICATION_REVIEW'),
  ('QUALIFICATION_REVIEW', 'QUALIFIED'),
  ('QUALIFICATION_REVIEW', 'DISQUALIFIED'),
  ('QUALIFIED', 'PROPOSAL_DRAFT'),
  ('PROPOSAL_DRAFT', 'WAITING_FOR_APPROVAL'),
  ('WAITING_FOR_APPROVAL', 'APPROVED_FOR_SEND'),
  ('WAITING_FOR_APPROVAL', 'REJECTED_FOR_REVISION'),
  ('REJECTED_FOR_REVISION', 'PROPOSAL_DRAFT'),
  ('APPROVED_FOR_SEND', 'SEND_REQUESTED'),
  ('SEND_REQUESTED', 'SENT'),
  ('SENT', 'WAITING_FOR_REPLY'),
  ('WAITING_FOR_REPLY', 'CUSTOMER_ACCEPTED'),
  ('WAITING_FOR_REPLY', 'LOST'),
  ('WAITING_FOR_REPLY', 'FOLLOW_UP_DUE'),
  ('FOLLOW_UP_DUE', 'PROPOSAL_DRAFT'),
  ('FOLLOW_UP_DUE', 'LOST'),
  ('CUSTOMER_ACCEPTED', 'PAYMENT_CONFIRMATION'),
  ('PAYMENT_CONFIRMATION', 'PAYMENT_CONFIRMED'),
  ('PAYMENT_CONFIRMED', 'PROVISIONING_REVIEW'),
  ('PROVISIONING_REVIEW', 'PROVISIONING'),
  ('PROVISIONING', 'CONFIG_VALIDATION'),
  ('CONFIG_VALIDATION', 'ACCEPTANCE_TEST'),
  ('ACCEPTANCE_TEST', 'DEPLOYMENT_APPROVAL'),
  ('DEPLOYMENT_APPROVAL', 'ACTIVE');

create table public.flow_runs (
  workflow_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workflow_type text not null default 'PRFKT_FLOW_01',
  lead_id text not null check (char_length(lead_id) between 1 and 200),
  lead jsonb not null,
  current_state text not null default 'NEW_LEAD',
  previous_state text,
  state_version integer not null default 0 check (state_version >= 0),
  status text not null default 'running'
    check (status in ('running', 'retry_wait', 'waiting_approval', 'waiting_event', 'waiting_timer', 'failed', 'blocked', 'completed', 'closed')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  evidence_ids uuid[] not null default '{}',
  output jsonb not null default '{}'::jsonb,
  validator_result jsonb,
  approval_id uuid,
  retry_count integer not null default 0 check (retry_count >= 0),
  last_error text,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  -- metrics (PRFKT_FLOW_01.md → Metrics)
  model_calls integer not null default 0,
  tokens_in bigint not null default 0,
  tokens_out bigint not null default 0,
  est_cost_micro_usd bigint not null default 0,
  active_compute_ms bigint not null default 0,
  retries_total integer not null default 0,
  approvals_total integer not null default 0,
  failures_total integer not null default 0,
  recovery_count integer not null default 0,
  duplicates_suppressed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint flow_runs_state_known check (current_state in (
    'NEW_LEAD','SOURCE_VERIFICATION','RESEARCH','RESEARCH_COMPLETE','QUALIFICATION_REVIEW','QUALIFIED','DISQUALIFIED',
    'PROPOSAL_DRAFT','WAITING_FOR_APPROVAL','APPROVED_FOR_SEND','REJECTED_FOR_REVISION','SEND_REQUESTED','SENT',
    'WAITING_FOR_REPLY','CUSTOMER_ACCEPTED','LOST','FOLLOW_UP_DUE','PAYMENT_CONFIRMATION','PAYMENT_CONFIRMED',
    'PROVISIONING_REVIEW','PROVISIONING','CONFIG_VALIDATION','ACCEPTANCE_TEST','DEPLOYMENT_APPROVAL','ACTIVE'))
);
create index flow_runs_tenant_idx on public.flow_runs (tenant_id, created_at desc);
create index flow_runs_due_idx on public.flow_runs (status, next_attempt_at);

create table public.flow_events (
  id bigint generated always as identity primary key,
  workflow_id uuid not null references public.flow_runs (workflow_id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null check (char_length(type) between 1 and 60),
  from_state text,
  to_state text,
  state_version integer,
  actor text not null default 'system',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index flow_events_run_idx on public.flow_events (workflow_id, id);

create table public.flow_evidence (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  workflow_id uuid not null references public.flow_runs (workflow_id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('source_verification','research','validator','proposal','send','payment','provisioning','config_validation','acceptance_test','compensation')),
  passed boolean,
  content jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now()
);
create index flow_evidence_run_idx on public.flow_evidence (workflow_id, kind);

create table public.flow_approvals (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.flow_runs (workflow_id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('PROPOSAL_SEND','PAYMENT','PROVISIONING','PRODUCTION_ACTIVATION')),
  action_class text not null check (action_class in ('SEND_EXTERNAL','SPEND','DEPLOY','WRITE_INTERNAL')),
  payload jsonb not null,
  payload_hash text not null,
  requested_state_version integer not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text,
  reason text check (reason is null or char_length(reason) <= 2000),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint flow_approvals_decision_complete check ((status = 'pending') = (decided_at is null))
);
-- One open approval per kind per run.
create unique index flow_approvals_one_pending on public.flow_approvals (workflow_id, kind) where status = 'pending';
-- One approval per exact payload (a revision has a new payload hash).
create unique index flow_approvals_payload_once on public.flow_approvals (workflow_id, kind, payload_hash);

create table public.flow_side_effects (
  idempotency_key text primary key check (char_length(idempotency_key) between 8 and 300),
  workflow_id uuid not null references public.flow_runs (workflow_id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  adapter text not null,
  operation text not null,
  status text not null check (status in ('started','succeeded','failed','compensated')),
  request_hash text not null,
  result jsonb,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flow_side_effects_run_idx on public.flow_side_effects (workflow_id);

create table public.flow_webhook_events (
  provider text not null check (char_length(provider) between 1 and 40),
  event_id text not null check (char_length(event_id) between 1 and 200),
  workflow_id uuid references public.flow_runs (workflow_id) on delete cascade,
  type text not null,
  payload jsonb not null,
  outcome text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------- guards

create or replace function app.flow_runs_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.tenant_id <> old.tenant_id or new.idempotency_key <> old.idempotency_key or new.lead_id <> old.lead_id then
    raise exception 'flow_runs identity columns are immutable';
  end if;
  if new.current_state is distinct from old.current_state then
    if new.state_version <> old.state_version + 1 then
      raise exception 'state_version must increment by exactly 1 on transition';
    end if;
    if new.previous_state is distinct from old.current_state then
      raise exception 'previous_state must equal the prior current_state';
    end if;
    if not exists (select 1 from public.flow_transitions t where t.from_state = old.current_state and t.to_state = new.current_state) then
      raise exception 'illegal FLOW 01 transition % -> %', old.current_state, new.current_state;
    end if;
    if new.current_state = 'APPROVED_FOR_SEND' and not exists (
      select 1 from public.flow_approvals a where a.id = new.approval_id and a.workflow_id = new.workflow_id
        and a.kind = 'PROPOSAL_SEND' and a.status = 'approved') then
      raise exception 'APPROVED_FOR_SEND requires an approved PROPOSAL_SEND approval';
    end if;
    if new.current_state = 'PAYMENT_CONFIRMED' and not exists (
      select 1 from public.flow_approvals a where a.id = new.approval_id and a.workflow_id = new.workflow_id
        and a.kind = 'PAYMENT' and a.status = 'approved') then
      raise exception 'PAYMENT_CONFIRMED requires an approved PAYMENT approval';
    end if;
    if new.current_state = 'PROVISIONING' and not exists (
      select 1 from public.flow_approvals a where a.id = new.approval_id and a.workflow_id = new.workflow_id
        and a.kind = 'PROVISIONING' and a.status = 'approved') then
      raise exception 'PROVISIONING requires an approved PROVISIONING approval';
    end if;
    if new.current_state = 'ACTIVE' then
      if coalesce((
           select e.passed from public.flow_evidence e
           where e.workflow_id = new.workflow_id and e.kind = 'acceptance_test'
           order by e.seq desc limit 1), false) is not true then
        raise exception 'ACTIVE requires the latest acceptance test to have passed';
      end if;
      if not exists (
        select 1 from public.flow_approvals a where a.id = new.approval_id and a.workflow_id = new.workflow_id
          and a.kind = 'PRODUCTION_ACTIVATION' and a.status = 'approved') then
        raise exception 'ACTIVE requires an approved PRODUCTION_ACTIVATION approval';
      end if;
    end if;
  elsif new.state_version <> old.state_version then
    raise exception 'state_version changes only with a transition';
  end if;
  return new;
end;
$$;

create trigger flow_runs_guard before update on public.flow_runs
  for each row execute function app.flow_runs_guard();

create or replace function app.flow_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger flow_events_append_only before update or delete on public.flow_events
  for each row when (pg_trigger_depth() = 0) execute function app.flow_append_only();
create trigger flow_evidence_append_only before update or delete on public.flow_evidence
  for each row when (pg_trigger_depth() = 0) execute function app.flow_append_only();

-- Approvals: decided exactly once; payload and binding are immutable.
create or replace function app.flow_approvals_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending' then
    raise exception 'approval % already decided', old.id;
  end if;
  if new.payload_hash <> old.payload_hash or new.kind <> old.kind or new.workflow_id <> old.workflow_id or new.action_class <> old.action_class then
    raise exception 'approval binding is immutable';
  end if;
  return new;
end;
$$;
create trigger flow_approvals_guard before update on public.flow_approvals
  for each row execute function app.flow_approvals_guard();

-- --------------------------------------------------------------- RLS
-- Customers may read their own tenant's workflow records (dashboard);
-- all writes happen on the server/worker path.

alter table public.flow_transitions enable row level security;
alter table public.flow_runs enable row level security;
alter table public.flow_events enable row level security;
alter table public.flow_evidence enable row level security;
alter table public.flow_approvals enable row level security;
alter table public.flow_side_effects enable row level security;
alter table public.flow_webhook_events enable row level security;

create policy flow_transitions_read on public.flow_transitions for select to authenticated using (true);
create policy flow_runs_member_read on public.flow_runs for select to authenticated using (app.is_tenant_member(tenant_id));
create policy flow_events_member_read on public.flow_events for select to authenticated using (app.is_tenant_member(tenant_id));
create policy flow_evidence_member_read on public.flow_evidence for select to authenticated using (app.is_tenant_member(tenant_id));
create policy flow_approvals_member_read on public.flow_approvals for select to authenticated using (app.is_tenant_member(tenant_id));
-- flow_side_effects and flow_webhook_events: no customer policies (internal ledger).

revoke insert, update, delete, truncate on
  public.flow_transitions, public.flow_runs, public.flow_events, public.flow_evidence,
  public.flow_approvals, public.flow_side_effects, public.flow_webhook_events
  from anon, authenticated;
revoke all on public.flow_side_effects, public.flow_webhook_events from anon, authenticated;
revoke all on public.flow_runs, public.flow_events, public.flow_evidence, public.flow_approvals, public.flow_transitions from anon;
