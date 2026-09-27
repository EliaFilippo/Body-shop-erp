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

-- Consente al primo utente autenticato di creare in sicurezza la propria azienda.
-- La funzione può essere richiamata una sola volta per account: se esiste già
-- un'appartenenza restituisce quella esistente senza creare duplicati.
create or replace function public.bootstrap_company(
  p_company_name text,
  p_member_display_name text
)
returns table (company_id uuid, company_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_company_id uuid;
  new_company_id uuid;
begin
  if current_user_id is null then
    raise exception 'Autenticazione richiesta';
  end if;

  select cm.company_id
  into existing_company_id
  from public.company_members cm
  where cm.user_id = current_user_id and cm.active
  order by cm.created_at
  limit 1;

  if existing_company_id is not null then
    return query
      select c.id, c.name, cm.role
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where c.id = existing_company_id and cm.user_id = current_user_id;
    return;
  end if;

  if nullif(trim(p_company_name), '') is null or nullif(trim(p_member_display_name), '') is null then
    raise exception 'Nome azienda e nome utente sono obbligatori';
  end if;

  insert into public.companies (name)
  values (trim(p_company_name))
  returning id into new_company_id;

  insert into public.company_members (company_id, user_id, display_name, role)
  values (new_company_id, current_user_id, trim(p_member_display_name), 'owner');

  return query
    select c.id, c.name, cm.role
    from public.companies c
    join public.company_members cm on cm.company_id = c.id
    where c.id = new_company_id and cm.user_id = current_user_id;
end;
$$;

revoke all on function public.bootstrap_company(text, text) from public;
grant execute on function public.bootstrap_company(text, text) to authenticated;

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

-- I privilegi sulle tabelle sono necessari anche quando le policy RLS esistono.
-- Le policy limitano ogni operazione ai membri attivi della relativa azienda.
grant select on public.companies, public.company_members to authenticated;
grant select, insert, update on public.erp_snapshots to authenticated;
