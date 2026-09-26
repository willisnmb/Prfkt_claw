-- PRFKT CLAW — identity and tenancy.
-- One tenant = one customer trust domain. Every customer-owned row carries
-- tenant_id and is protected by RLS through app.is_tenant_member().

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_members_user_idx on public.tenant_members (user_id);

-- Membership check used by every tenant-scoped policy. SECURITY DEFINER so the
-- policy on tenant_members itself does not recurse; search_path pinned.
create or replace function app.is_tenant_member(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid()
  )
$$;

create or replace function app.is_tenant_admin(t uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = t and m.user_id = auth.uid() and m.role = 'admin'
  )
$$;

revoke all on function app.is_tenant_member(uuid) from public;
revoke all on function app.is_tenant_admin(uuid) from public;
grant execute on function app.is_tenant_member(uuid) to authenticated, service_role;
grant execute on function app.is_tenant_admin(uuid) to authenticated, service_role;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.tenant_members enable row level security;

create policy tenants_select_member on public.tenants
  for select to authenticated using (app.is_tenant_member(id));
create policy tenants_update_admin on public.tenants
  for update to authenticated using (app.is_tenant_admin(id)) with check (app.is_tenant_admin(id));

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy tenant_members_select_member on public.tenant_members
  for select to authenticated using (app.is_tenant_member(tenant_id));

-- Tenants and memberships are created only by the signup trigger or the
-- server (service role); customers cannot add themselves to another tenant.
revoke insert, delete on public.tenants from anon, authenticated;
revoke insert, update, delete on public.tenant_members from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;
revoke all on public.tenants, public.profiles, public.tenant_members from anon;

-- New auth user → profile + personal tenant (their own trust domain).
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant uuid;
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.tenants (name)
  values (coalesce(nullif(new.raw_user_meta_data ->> 'company', ''), split_part(coalesce(new.email, 'customer'), '@', 1)))
  returning id into new_tenant;
  insert into public.tenant_members (tenant_id, user_id, role) values (new_tenant, new.id, 'admin');
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

create or replace function app.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();
