-- PRFKT CLAW — control-plane schema (BUILD_INSTRUCTIONS.md §4).
--
-- Access model
--   * Public catalog/registries: anon + authenticated may SELECT published rows only.
--   * Customer-owned tables: tenant_id + RLS through app.is_tenant_member().
--   * Owner-only tables: RLS enabled, NO policies, privileges revoked from
--     anon/authenticated. Reachable only through the server (postgres role)
--     after requireOwner(), with every mutation audited in the same transaction.

-- ---------------------------------------------------------------- helpers

-- Defence in depth for SECURITY.md → Secrets: rejects values that look like
-- credentials. Mirrors the high-signal patterns in src/security/secrets.ts.
create or replace function app.looks_like_secret(v text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v is not null and (
       v ~ '-----BEGIN [A-Z ]*PRIVATE KEY'
    or v ~ '\msk-ant-[A-Za-z0-9_-]{20,}'
    or v ~ '\msk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}'
    or v ~ '\m(sk|rk)_(live|test)_[A-Za-z0-9]{16,}'
    or v ~ '\mwhsec_[A-Za-z0-9]{16,}'
    or v ~ '\mgh[pousr]_[A-Za-z0-9]{30,}'
    or v ~ '\mgithub_pat_[A-Za-z0-9_]{40,}'
    or v ~ '\m(AKIA|ASIA)[0-9A-Z]{16}\M'
    or v ~ '\mAIza[0-9A-Za-z_-]{35}'
    or v ~ '\mxox[abprs]-[A-Za-z0-9-]{10,}'
    or v ~ 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
    or v ~ 'postgres(ql)?://[^[:space:]:@/]+:[^[:space:]@/]{6,}@'
  )
$$;

-- Secret references use the SHIELD format secret://<tenant-uuid>/<name>
-- (src/security/secret-refs.ts). Anything else in a secret_refs map is
-- rejected, and every reference must belong to the row's own tenant, so raw
-- credentials and cross-tenant references can never be stored.
create or replace function app.secret_refs_valid(refs jsonb, owner_tenant uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(refs) = 'object'
     and not exists (
       select 1 from jsonb_each(refs) e
       where jsonb_typeof(e.value) <> 'string'
          or (e.value #>> '{}') !~ '^secret://[0-9a-f-]{36}/[a-z0-9][a-z0-9_.-]{0,63}$'
          or split_part(substr(e.value #>> '{}', 10), '/', 1) <> owner_tenant::text
     )
$$;

-- --------------------------------------------------------------- catalog

create table public.foundations (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 60),
  summary text not null check (char_length(summary) between 10 and 400),
  sort_order integer not null default 0
);

create table public.claws (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  name text not null check (char_length(name) between 3 and 60),
  family text not null check (family in ('CLAW', 'FLOW', 'CREW', 'STRICT', 'EDGE', 'SECURE', 'AUTO', 'SHIELD')),
  foundation_id text not null references public.foundations (id),
  summary text not null,
  -- Owner-controlled overrides of the seed definition.
  maturity text not null default 'CONFIGURABLE' check (maturity in ('READY', 'CONFIGURABLE', 'CUSTOM')),
  published boolean not null default true,
  -- Full catalog definition (validated by src/domain/catalog/schema.ts on read and write).
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index claws_family_idx on public.claws (family);
create index claws_foundation_idx on public.claws (foundation_id);

create table public.claw_evidence (
  id uuid primary key default gen_random_uuid(),
  claw_slug text not null references public.claws (slug) on delete cascade,
  gate text not null check (gate in (
    'dependency_scan', 'secrets_scan', 'rls_isolation', 'redclaw_critical',
    'backup_restore', 'admin_authorization', 'public_abuse_controls', 'runtime_isolation'
  )),
  ref text not null check (char_length(ref) between 3 and 500),
  result text not null check (result = 'pass'),
  verified_at date not null,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (claw_slug, gate, ref)
);

-- READY requires passing evidence for all 8 release gates (SECURITY.md → Release gate).
-- Deferred constraint triggers so a claw and its evidence can be written in one transaction.
create or replace function app.enforce_ready_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target text;
  covered integer;
begin
  if tg_table_name = 'claws' then
    target := new.slug;
  else
    target := coalesce(old.claw_slug, new.claw_slug);
  end if;
  if exists (select 1 from public.claws c where c.slug = target and c.maturity = 'READY') then
    select count(distinct e.gate) into covered
    from public.claw_evidence e
    where e.claw_slug = target and e.result = 'pass';
    if covered < 8 then
      raise exception 'READY requires passing evidence for all 8 release gates (claw %, % covered)', target, covered
        using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger claws_ready_requires_evidence
  after insert or update of maturity on public.claws
  deferrable initially deferred
  for each row execute function app.enforce_ready_evidence();

create constraint trigger claw_evidence_ready_guard
  after delete or update on public.claw_evidence
  deferrable initially deferred
  for each row execute function app.enforce_ready_evidence();

create trigger claws_touch before update on public.claws
  for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------ registries

create table public.runtime_registry (
  id text primary key,
  label text not null,
  role text not null,
  status text not null check (status in ('connected', 'embedded', 'not-configured', 'candidate', 'disabled')),
  isolation text not null check (isolation in ('per-customer-cell', 'control-plane', 'customer-device')),
  notes text,
  updated_at timestamptz not null default now()
);

create table public.model_registry (
  id text primary key,
  label text not null,
  description text not null,
  routes text[] not null,
  may_incur_managed_cost boolean not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.compute_registry (
  id text primary key,
  label text not null,
  description text not null,
  memory_gb integer check (memory_gb is null or memory_gb > 0),
  metering text not null check (metering in ('none', 'compute-hours')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger runtime_registry_touch before update on public.runtime_registry
  for each row execute function app.touch_updated_at();
create trigger model_registry_touch before update on public.model_registry
  for each row execute function app.touch_updated_at();
create trigger compute_registry_touch before update on public.compute_registry
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------- owner-only operations

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,60}$'),
  enabled boolean not null default false,
  description text not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger feature_flags_touch before update on public.feature_flags
  for each row execute function app.touch_updated_at();

create table public.system_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) between 3 and 80),
  severity text not null default 'info' check (severity in ('info', 'warning', 'error', 'critical')),
  source text not null default 'control-plane',
  message text not null check (char_length(message) <= 1000),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index system_events_created_idx on public.system_events (created_at desc);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text not null,
  action text not null check (char_length(action) between 3 and 80),
  target_type text not null,
  target_id text,
  before jsonb,
  after jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

-- Append-only, for everyone including the table owner.
create or replace function app.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger admin_audit_log_no_update before update or delete on public.admin_audit_log
  for each row execute function app.audit_log_is_append_only();
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
  for each statement execute function app.audit_log_is_append_only();

create table public.rate_limit_buckets (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Atomic fixed-window counter. Returns true when the call is within the limit.
create or replace function app.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limit_buckets as b (key, window_start, count)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set count = b.count + 1
  returning b.count into n;
  return n <= p_max;
end;
$$;
revoke all on function app.rate_limit_hit(text, integer, integer) from public, anon, authenticated;

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('logical-tenant', 'platform-pitr')),
  tenant_id uuid,
  status text not null check (status in ('running', 'succeeded', 'failed', 'restore-verified')),
  row_count integer,
  checksum text,
  location_ref text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  restore_verified_at timestamptz
);

-- ------------------------------------------------------ customer-owned data

create table public.configurations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  name text not null check (char_length(name) between 2 and 80),
  catalog_slug text references public.claws (slug) on delete set null,
  auto_input jsonb not null check (jsonb_typeof(auto_input) = 'object'),
  -- Always computed server-side from auto_input; never taken from the client.
  recommendation jsonb not null check (jsonb_typeof(recommendation) = 'object'),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index configurations_tenant_idx on public.configurations (tenant_id, created_at desc);
create trigger configurations_touch before update on public.configurations
  for each row execute function app.touch_updated_at();

create table public.custom_build_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^CR-[A-Z0-9]{8}$'),
  tenant_id uuid references public.tenants (id) on delete cascade,
  submitted_by uuid references auth.users (id) on delete set null,
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  contact_email text not null check (char_length(contact_email) <= 254 and contact_email like '%@%'),
  company text check (company is null or char_length(company) <= 160),
  foundation_id text references public.foundations (id),
  family text check (family is null or family in ('CLAW', 'FLOW', 'CREW', 'STRICT', 'EDGE', 'SECURE', 'AUTO', 'SHIELD')),
  catalog_slug text references public.claws (slug) on delete set null,
  problem text not null check (char_length(problem) between 20 and 4000),
  outcomes text check (outcomes is null or char_length(outcomes) <= 2000),
  data_sensitivity text not null check (data_sensitivity in ('public', 'internal', 'confidential', 'regulated')),
  timeline text not null check (timeline in ('exploring', 'this-quarter', 'this-month', 'urgent')),
  budget_range text not null check (budget_range in ('under-5k', '5k-25k', '25k-100k', '100k-plus', 'not-sure')),
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'TRIAGED', 'SCOPED', 'DECLINED', 'CONVERTED')),
  owner_notes text check (owner_notes is null or char_length(owner_notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_build_requests_status_idx on public.custom_build_requests (status, created_at desc);
create index custom_build_requests_tenant_idx on public.custom_build_requests (tenant_id);
create trigger custom_build_requests_touch before update on public.custom_build_requests
  for each row execute function app.touch_updated_at();

-- Explicit status workflow: RECEIVED → TRIAGED → SCOPED → DECLINED | CONVERTED
-- (DECLINED also allowed from RECEIVED/TRIAGED). Terminal states are final.
create or replace function app.enforce_custom_request_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then return new; end if;
  if not (
       (old.status = 'RECEIVED' and new.status in ('TRIAGED', 'DECLINED'))
    or (old.status = 'TRIAGED'  and new.status in ('SCOPED', 'DECLINED'))
    or (old.status = 'SCOPED'   and new.status in ('DECLINED', 'CONVERTED'))
  ) then
    raise exception 'invalid custom request transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger custom_build_requests_transition before update of status on public.custom_build_requests
  for each row execute function app.enforce_custom_request_transition();

create table public.runtime_cells (
  id uuid primary key default gen_random_uuid(),
  -- One customer trust domain per cell; a cell never spans tenants.
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(name) <= 60),
  runtime text not null references public.runtime_registry (id),
  profile text not null default 'SAFE' check (profile in ('SAFE', 'OPERATOR')),
  model_policy text not null references public.model_registry (id),
  compute_class text not null references public.compute_registry (id),
  deployment_target text not null check (deployment_target in ('managed-cell', 'private-cloud', 'on-prem', 'edge-device')),
  status text not null default 'NOT_PROVISIONED' check (status in ('NOT_PROVISIONED', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DESTROYED', 'FAILED')),
  endpoint_ref text check (endpoint_ref is null or not app.looks_like_secret(endpoint_ref)),
  secret_refs jsonb not null default '{}'::jsonb constraint runtime_cells_secret_refs_check check (app.secret_refs_valid(secret_refs, tenant_id)),
  health text not null default 'unknown' check (health in ('unknown', 'healthy', 'degraded', 'down')),
  last_health_at timestamptz,
  version text,
  backup_state text not null default 'none' check (backup_state in ('none', 'scheduled', 'succeeded', 'failed', 'restore-verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create trigger runtime_cells_touch before update on public.runtime_cells
  for each row execute function app.touch_updated_at();

create table public.deployment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  configuration_id uuid not null references public.configurations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null default auth.uid(),
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
  customer_note text check (customer_note is null or char_length(customer_note) <= 2000),
  review_note text check (review_note is null or char_length(review_note) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deployment_requests_tenant_idx on public.deployment_requests (tenant_id, created_at desc);
create index deployment_requests_status_idx on public.deployment_requests (status);
create trigger deployment_requests_touch before update on public.deployment_requests
  for each row execute function app.touch_updated_at();

-- Configuration must belong to the same tenant as the request.
-- Customers may only create PENDING_REVIEW requests and cancel pending ones;
-- APPROVED/REJECTED is an owner decision made through the server path.
create or replace function app.enforce_deployment_request_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.configurations c where c.id = new.configuration_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'configuration does not belong to tenant' using errcode = 'check_violation';
  end if;
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and (new.status <> 'PENDING_REVIEW' or new.reviewed_by is not null or new.reviewed_at is not null or new.review_note is not null) then
      raise exception 'customers can only create pending deployment requests' using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and not (old.status = 'PENDING_REVIEW' and new.status = 'CANCELLED') then
      raise exception 'customers can only cancel pending deployment requests' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status <> new.status and old.status <> 'PENDING_REVIEW' then
    raise exception 'deployment request already decided (%)', old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger deployment_requests_rules before insert or update on public.deployment_requests
  for each row execute function app.enforce_deployment_request_rules();

create table public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  deployment_request_id uuid not null references public.deployment_requests (id) on delete cascade,
  cell_id uuid references public.runtime_cells (id) on delete set null,
  runtime text not null references public.runtime_registry (id),
  status text not null default 'BLOCKED' check (status in ('BLOCKED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  blocked_reason text,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  last_error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index provisioning_jobs_tenant_idx on public.provisioning_jobs (tenant_id);
create trigger provisioning_jobs_touch before update on public.provisioning_jobs
  for each row execute function app.touch_updated_at();

-- Provisioning never auto-runs: a job can only leave BLOCKED when the
-- deployment request is APPROVED and the provisioning flag is on. The app
-- additionally enforces the PROVISIONING_ENABLED environment ceiling.
create or replace function app.enforce_provisioning_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id <> (select d.tenant_id from public.deployment_requests d where d.id = new.deployment_request_id) then
    raise exception 'provisioning job tenant mismatch' using errcode = 'check_violation';
  end if;
  if new.cell_id is not null and new.tenant_id <> (select c.tenant_id from public.runtime_cells c where c.id = new.cell_id) then
    raise exception 'runtime cell belongs to another tenant' using errcode = 'check_violation';
  end if;
  if new.status in ('QUEUED', 'RUNNING', 'SUCCEEDED') then
    if not exists (select 1 from public.deployment_requests d where d.id = new.deployment_request_id and d.status = 'APPROVED') then
      raise exception 'provisioning requires an APPROVED deployment request' using errcode = 'check_violation';
    end if;
    if not coalesce((select f.enabled from public.feature_flags f where f.key = 'provisioning_enabled'), false) then
      raise exception 'provisioning is disabled' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger provisioning_jobs_gate before insert or update on public.provisioning_jobs
  for each row execute function app.enforce_provisioning_gate();

-- Memory with provenance and corrections (HANDOFF non-negotiable 8).
-- Rows are never edited in place: a correction is a new row that supersedes the old one.
create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  cell_id uuid references public.runtime_cells (id) on delete set null,
  content text not null check (char_length(content) between 1 and 8000 and not app.looks_like_secret(content)),
  source_type text not null check (source_type in ('user', 'assistant', 'tool', 'document', 'website', 'email', 'system')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  trust text not null default 'untrusted' check (trust in ('trusted', 'untrusted')),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  supersedes_id uuid references public.memory_items (id) on delete set null,
  correction_reason text check (correction_reason is null or char_length(correction_reason) <= 1000),
  created_at timestamptz not null default now(),
  check (supersedes_id is null or correction_reason is not null),
  -- External content can never enter memory as trusted.
  check (trust = 'untrusted' or source_type in ('user', 'system'))
);
create index memory_items_tenant_idx on public.memory_items (tenant_id, created_at desc);
create unique index memory_items_single_successor on public.memory_items (supersedes_id) where supersedes_id is not null;

create or replace function app.enforce_memory_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'memory items are immutable; write a correction that supersedes this item' using errcode = 'insufficient_privilege';
  end if;
  if new.supersedes_id is not null and not exists (
    select 1 from public.memory_items m where m.id = new.supersedes_id and m.tenant_id = new.tenant_id
  ) then
    raise exception 'correction must supersede an item in the same tenant' using errcode = 'check_violation';
  end if;
  if new.cell_id is not null and not exists (
    select 1 from public.runtime_cells c where c.id = new.cell_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'memory cell belongs to another tenant' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger memory_items_rules before insert or update on public.memory_items
  for each row execute function app.enforce_memory_rules();

create table public.data_export_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null default auth.uid(),
  status text not null default 'DELIVERED' check (status in ('REQUESTED', 'DELIVERED', 'FAILED')),
  row_count integer,
  created_at timestamptz not null default now()
);

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'CANCELLED', 'COMPLETED')),
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index account_deletion_one_open on public.account_deletion_requests (user_id) where status = 'REQUESTED';

create or replace function app.enforce_deletion_request_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.status <> 'REQUESTED' then
      raise exception 'deletion requests start as REQUESTED' using errcode = 'insufficient_privilege';
    end if;
    if tg_op = 'UPDATE' and not (old.status = 'REQUESTED' and new.status = 'CANCELLED') then
      raise exception 'customers can only cancel an open deletion request' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
create trigger account_deletion_requests_rules before insert or update on public.account_deletion_requests
  for each row execute function app.enforce_deletion_request_rules();

-- ------------------------------------------------------------------- RLS

alter table public.foundations enable row level security;
alter table public.claws enable row level security;
alter table public.claw_evidence enable row level security;
alter table public.runtime_registry enable row level security;
alter table public.model_registry enable row level security;
alter table public.compute_registry enable row level security;
alter table public.feature_flags enable row level security;
alter table public.system_events enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.rate_limit_buckets enable row level security;
alter table public.backup_runs enable row level security;
alter table public.configurations enable row level security;
alter table public.custom_build_requests enable row level security;
alter table public.runtime_cells enable row level security;
alter table public.deployment_requests enable row level security;
alter table public.provisioning_jobs enable row level security;
alter table public.memory_items enable row level security;
alter table public.data_export_requests enable row level security;
alter table public.account_deletion_requests enable row level security;

-- Public catalog and registries: read-only.
revoke insert, update, delete, truncate on
  public.foundations, public.claws, public.claw_evidence,
  public.runtime_registry, public.model_registry, public.compute_registry
  from anon, authenticated;

create policy foundations_public_read on public.foundations for select to anon, authenticated using (true);
create policy claws_public_read on public.claws for select to anon, authenticated using (published);
create policy claw_evidence_public_read on public.claw_evidence for select to anon, authenticated
  using (exists (select 1 from public.claws c where c.slug = claw_slug and c.published));
create policy runtime_registry_public_read on public.runtime_registry for select to anon, authenticated using (true);
create policy model_registry_public_read on public.model_registry for select to anon, authenticated using (true);
create policy compute_registry_public_read on public.compute_registry for select to anon, authenticated using (true);

-- Owner-only: no policies at all, and no privileges for browser roles.
revoke all on public.feature_flags, public.system_events, public.admin_audit_log,
  public.rate_limit_buckets, public.backup_runs
  from anon, authenticated;

-- Customer-owned: anon has nothing.
revoke all on public.configurations, public.custom_build_requests, public.runtime_cells,
  public.deployment_requests, public.provisioning_jobs, public.memory_items,
  public.data_export_requests, public.account_deletion_requests
  from anon;

-- configurations: full CRUD inside the member's tenant.
create policy configurations_member_select on public.configurations for select to authenticated
  using (app.is_tenant_member(tenant_id));
create policy configurations_member_insert on public.configurations for insert to authenticated
  with check (app.is_tenant_member(tenant_id) and created_by = auth.uid());
create policy configurations_member_update on public.configurations for update to authenticated
  using (app.is_tenant_member(tenant_id)) with check (app.is_tenant_member(tenant_id));
create policy configurations_member_delete on public.configurations for delete to authenticated
  using (app.is_tenant_member(tenant_id));

-- custom_build_requests: created only by the server intake path; members can
-- read their tenant's requests but not the owner's private notes.
revoke all on public.custom_build_requests from authenticated;
grant select (id, reference, tenant_id, submitted_by, contact_name, contact_email, company, foundation_id,
  family, catalog_slug, problem, outcomes, data_sensitivity, timeline, budget_range, status, created_at, updated_at)
  on public.custom_build_requests to authenticated;
create policy custom_build_requests_member_select on public.custom_build_requests for select to authenticated
  using (tenant_id is not null and app.is_tenant_member(tenant_id));

-- runtime_cells: read-only for members; created/changed by provisioning only.
revoke insert, update, delete, truncate on public.runtime_cells from authenticated;
create policy runtime_cells_member_select on public.runtime_cells for select to authenticated
  using (app.is_tenant_member(tenant_id));

-- deployment_requests: members create pending requests and may cancel them.
revoke update, delete, truncate on public.deployment_requests from authenticated;
grant update (status, customer_note) on public.deployment_requests to authenticated;
create policy deployment_requests_member_select on public.deployment_requests for select to authenticated
  using (app.is_tenant_member(tenant_id));
create policy deployment_requests_member_insert on public.deployment_requests for insert to authenticated
  with check (app.is_tenant_member(tenant_id) and requested_by = auth.uid());
create policy deployment_requests_member_cancel on public.deployment_requests for update to authenticated
  using (app.is_tenant_member(tenant_id)) with check (app.is_tenant_member(tenant_id));

-- provisioning_jobs: read-only for members.
revoke insert, update, delete, truncate on public.provisioning_jobs from authenticated;
create policy provisioning_jobs_member_select on public.provisioning_jobs for select to authenticated
  using (app.is_tenant_member(tenant_id));

-- memory_items: members read and append (incl. corrections); no edits or deletes.
revoke update, delete, truncate on public.memory_items from authenticated;
create policy memory_items_member_select on public.memory_items for select to authenticated
  using (app.is_tenant_member(tenant_id));
create policy memory_items_member_insert on public.memory_items for insert to authenticated
  with check (app.is_tenant_member(tenant_id) and created_by = auth.uid());

-- data_export_requests: members read and record their exports.
revoke update, delete, truncate on public.data_export_requests from authenticated;
create policy data_export_requests_member_select on public.data_export_requests for select to authenticated
  using (app.is_tenant_member(tenant_id));
create policy data_export_requests_member_insert on public.data_export_requests for insert to authenticated
  with check (app.is_tenant_member(tenant_id) and requested_by = auth.uid());

-- account_deletion_requests: a user manages only their own request.
revoke delete, truncate on public.account_deletion_requests from authenticated;
revoke update on public.account_deletion_requests from authenticated;
grant update (status) on public.account_deletion_requests to authenticated;
create policy account_deletion_select_own on public.account_deletion_requests for select to authenticated
  using (user_id = auth.uid());
create policy account_deletion_insert_own on public.account_deletion_requests for insert to authenticated
  with check (user_id = auth.uid() and app.is_tenant_member(tenant_id));
create policy account_deletion_cancel_own on public.account_deletion_requests for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- app.looks_like_secret / app.secret_refs_valid stay executable: they are pure
-- and CHECK constraints evaluate them with the inserting role's privileges.
