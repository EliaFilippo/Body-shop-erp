-- Body Shop ERP — schema cloud iniziale e isolamento per azienda.
-- Eseguire nel SQL editor di Supabase solo dopo aver creato il progetto.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner', 'office', 'production')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.erp_snapshots (
  company_id uuid primary key references public.companies(id) on delete cascade,
  revision bigint not null default 0,
  payload jsonb not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.erp_snapshots enable row level security;

create or replace function public.is_active_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = auth.uid() and active
  );
$$;

create or replace function public.is_company_owner(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = auth.uid() and active and role = 'owner'
  );
$$;

drop policy if exists companies_member_read on public.companies;
create policy companies_member_read on public.companies for select using (public.is_active_company_member(id));

drop policy if exists members_member_read on public.company_members;
create policy members_member_read on public.company_members for select using (public.is_active_company_member(company_id));

drop policy if exists members_owner_write on public.company_members;
create policy members_owner_write on public.company_members for all using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));

drop policy if exists snapshots_member_read on public.erp_snapshots;
create policy snapshots_member_read on public.erp_snapshots for select using (public.is_active_company_member(company_id));

drop policy if exists snapshots_member_write on public.erp_snapshots;
create policy snapshots_member_write on public.erp_snapshots for all using (public.is_active_company_member(company_id)) with check (public.is_active_company_member(company_id) and updated_by = auth.uid());
