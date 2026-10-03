-- Canonical tablet timers. Independent of whole-ERP snapshot writes.
begin;
-- Production accounts use the operational feed instead of the financial ERP snapshot.
create or replace function public.is_office_company_member(target_company_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from company_members where company_id=target_company_id
    and user_id=auth.uid() and active and role in ('owner','office'));
$$;
revoke all on function public.is_office_company_member(uuid) from public;
grant execute on function public.is_office_company_member(uuid) to authenticated;
drop policy if exists snapshots_member_read on public.erp_snapshots;
create policy snapshots_member_read on public.erp_snapshots for select
  using(public.is_office_company_member(company_id));
drop policy if exists snapshots_member_write on public.erp_snapshots;
create policy snapshots_member_write on public.erp_snapshots for all
  using(public.is_office_company_member(company_id))
  with check(public.is_office_company_member(company_id) and updated_by=auth.uid());
create table if not exists public.production_profiles (
  company_id uuid not null, user_id uuid not null, operator_id text not null,
  primary key(company_id,user_id), unique(company_id,operator_id),
  foreign key(company_id,user_id) references public.company_members(company_id,user_id)
);
create table if not exists public.production_live_jobs (
  company_id uuid not null references public.companies(id), job_id text not null,
  plate text not null, number text not null, initial_budget numeric not null check(initial_budget>0),
  operator_rates jsonb not null, source_revision bigint not null,
  approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now(),
  primary key(company_id,job_id)
);
create table if not exists public.production_live_sessions (
  company_id uuid not null, job_id text not null, operator_id text not null,
  user_id uuid not null references auth.users(id), operator_name text not null,
  status text not null check(status in ('running','paused','finished')),
  primary key(company_id,job_id,operator_id),
  foreign key(company_id,job_id) references public.production_live_jobs(company_id,job_id)
);
create unique index if not exists production_one_running_job
  on public.production_live_sessions(company_id,operator_id) where status='running';
create table if not exists public.production_live_segments (
  id bigint generated always as identity primary key,
  company_id uuid not null, job_id text not null, operator_id text not null,
  rate numeric not null check(rate>0), started_at timestamptz not null default now(), ended_at timestamptz,
  foreign key(company_id,job_id,operator_id) references public.production_live_sessions(company_id,job_id,operator_id),
  check(ended_at is null or ended_at>=started_at)
);
create unique index if not exists production_one_open_segment
  on public.production_live_segments(company_id,operator_id) where ended_at is null;
alter table public.production_profiles enable row level security;
alter table public.production_live_jobs enable row level security;
alter table public.production_live_sessions enable row level security;
alter table public.production_live_segments enable row level security;
-- No direct client writes or financial-table reads; all operations use scoped RPCs.
revoke all on public.production_profiles, public.production_live_jobs,
  public.production_live_sessions, public.production_live_segments from anon, authenticated;

create or replace function public.production_bind_profile(p_company_id uuid,p_user_id uuid,p_operator_id text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_company_owner(p_company_id) then raise exception 'Solo il titolare può assegnare i profili'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  if not exists(select 1 from company_members where company_id=p_company_id and user_id=p_user_id and active)
    then raise exception 'Account non abilitato per questa azienda'; end if;
  if not exists(select 1 from erp_snapshots s,
    jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
    where s.company_id=p_company_id and o->>'id'=p_operator_id and (o->>'active')::boolean)
    then raise exception 'Operatore non attivo nel planner'; end if;
  if exists(select 1 from production_live_sessions where company_id=p_company_id and user_id=p_user_id and status='running')
    then raise exception 'Metti in pausa il lavoro prima di cambiare profilo'; end if;
  insert into production_profiles values(p_company_id,p_user_id,p_operator_id)
    on conflict(company_id,user_id) do update set operator_id=excluded.operator_id;
end $$;

create or replace function public.production_prepare_job(p_company_id uuid,p_job_id text,p_revision bigint,p_budget numeric,p_rates jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; revision bigint; job jsonb;
begin
  if not public.is_company_owner(p_company_id) then raise exception 'Solo il titolare può confermare il budget'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  select s.payload,s.revision into snapshot,revision from erp_snapshots s where s.company_id=p_company_id for share;
  if revision is distinct from p_revision then raise exception 'I dati sono cambiati: aggiorna prima di confermare il budget'; end if;
  select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'id'=p_job_id;
  if job is null or job->>'status' in ('Consegnata','Annullata') then raise exception 'Commessa non disponibile'; end if;
  if exists(select 1 from production_live_sessions where company_id=p_company_id and job_id=p_job_id)
    then raise exception 'Il budget è già in uso: conservato per evitare di modificare il lavoro registrato'; end if;
  if p_budget is null or p_budget<=0 or p_budget='NaN'::numeric or p_budget>10000000
    or jsonb_typeof(p_rates) is distinct from 'array' or jsonb_array_length(p_rates)=0
    then raise exception 'Budget o tariffe non validi'; end if;
  if exists(select 1 from jsonb_array_elements(p_rates) r where nullif(r->>'id','') is null
    or nullif(r->>'name','') is null or coalesce((r->>'rate')::numeric,0)<=0
    or (r->>'rate')::numeric='NaN'::numeric or (r->>'rate')::numeric>100000)
    or (select count(*) from jsonb_array_elements(p_rates))<>(select count(distinct r->>'id') from jsonb_array_elements(p_rates) r)
    then raise exception 'Tariffe operatori incomplete'; end if;
  insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
    values(p_company_id,p_job_id,job->>'plate',job->>'number',p_budget,p_rates,p_revision,auth.uid())
    on conflict(company_id,job_id) do update set initial_budget=excluded.initial_budget,operator_rates=excluded.operator_rates,
      plate=excluded.plate,number=excluded.number,source_revision=excluded.source_revision,approved_by=auth.uid(),approved_at=now();
end $$;

create or replace function public.production_timer_action(p_company_id uuid,p_job_id text,p_action text)
returns void language plpgsql security definer set search_path=public as $$
declare profile text; operator jsonb; current_status text; stamp timestamptz:=clock_timestamp();
begin
  if not public.is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  -- Take time after waiting for the lock, never backdate overlapping actions.
  stamp:=clock_timestamp();
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  if profile is null then raise exception 'Il titolare deve collegare questo account a un operatore'; end if;
  if not exists(select 1 from erp_snapshots s, jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
      where s.company_id=p_company_id and o->>'id'=profile and (o->>'active')::boolean)
    then raise exception 'Operatore disattivato'; end if;
  select r into operator from production_live_jobs j,jsonb_array_elements(j.operator_rates) r
    where j.company_id=p_company_id and j.job_id=p_job_id and r->>'id'=profile;
  if operator is null then raise exception 'Budget non confermato per questo operatore'; end if;
  select status into current_status from production_live_sessions
    where company_id=p_company_id and job_id=p_job_id and operator_id=profile;
  if p_action='start' then
    if current_status='running' then return; end if; -- repeated request is safe
    if exists(select 1 from production_live_sessions where company_id=p_company_id and operator_id=profile and status='running')
      then raise exception 'Metti in pausa la vettura già avviata prima di iniziarne un’altra'; end if;
    if not exists(select 1 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j
      where s.company_id=p_company_id and j->>'id'=p_job_id and j->>'status' not in ('Consegnata','Annullata'))
      then raise exception 'La commessa è chiusa'; end if;
    insert into production_live_sessions values(p_company_id,p_job_id,profile,auth.uid(),operator->>'name','running')
      on conflict(company_id,job_id,operator_id) do update set status='running',user_id=auth.uid();
    insert into production_live_segments(company_id,job_id,operator_id,rate,started_at)
      values(p_company_id,p_job_id,profile,(operator->>'rate')::numeric,stamp);
  elsif p_action in ('pause','finish') then
    if current_status is null then raise exception 'Nessun lavoro avviato su questa vettura'; end if;
    -- Stop the caller only. A colleague may still be working on this job.
    update production_live_segments set ended_at=stamp
      where company_id=p_company_id and job_id=p_job_id and operator_id=profile and ended_at is null;
    update production_live_sessions set status=case when p_action='finish' then 'finished'
      when current_status='finished' then 'finished' else 'paused' end
      where company_id=p_company_id and job_id=p_job_id and operator_id=profile;
  else raise exception 'Comando non valido'; end if;
end $$;

create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare profile text; member_role text; stamp timestamptz:=clock_timestamp(); result jsonb;
begin
  select role into member_role from company_members where company_id=p_company_id and user_id=auth.uid() and active;
  if member_role is null then raise exception 'Accesso aziendale richiesto'; end if;
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  with clocks as (
    select j.*,coalesce((select sum(extract(epoch from(coalesce(g.ended_at,stamp)-g.started_at))*g.rate/3600)
      from production_live_segments g where g.company_id=j.company_id and g.job_id=j.job_id),0) spent,
      coalesce((select sum(g.rate) from production_live_segments g where g.company_id=j.company_id and g.job_id=j.job_id and g.ended_at is null),0) active_rate,
      (select count(*) from production_live_segments g where g.company_id=j.company_id and g.job_id=j.job_id and g.ended_at is null) active_count,
      coalesce((select (r->>'rate')::numeric from jsonb_array_elements(j.operator_rates) r where r->>'id'=profile),0) own_rate
    from production_live_jobs j where j.company_id=p_company_id
  ) select jsonb_build_object('companyId',p_company_id,'serverNow',stamp,'role',member_role,
    'operatorName',(select o->>'name' from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
      where s.company_id=p_company_id and o->>'id'=profile),
    'members',case when member_role='owner' then coalesce((select jsonb_agg(jsonb_build_object('userId',cm.user_id,'name',cm.display_name,'operatorId',pp.operator_id))
      from company_members cm left join production_profiles pp on pp.company_id=cm.company_id and pp.user_id=cm.user_id
      where cm.company_id=p_company_id and cm.active),'[]'::jsonb) else '[]'::jsonb end,
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('jobId',c.job_id,'plate',c.plate,'number',c.number,
      'remainingSeconds',case when greatest(c.active_rate,c.own_rate)>0 then greatest(0,c.initial_budget-c.spent)/
        (case when c.active_rate>0 then c.active_rate else c.own_rate end)*3600 else null end,
      'remainingPercent',greatest(0,c.initial_budget-c.spent)/c.initial_budget*100,'activeCount',c.active_count,
      'ownStatus',(select ss.status from production_live_sessions ss where ss.company_id=c.company_id and ss.job_id=c.job_id and ss.operator_id=profile),
      'operators',coalesce((select jsonb_agg(jsonb_build_object('name',ss.operator_name,'status',ss.status)) from production_live_sessions ss
        where ss.company_id=c.company_id and ss.job_id=c.job_id),'[]'::jsonb))) from clocks c),'[]'::jsonb)) into result;
  return result;
end $$;
revoke all on function public.production_bind_profile(uuid,uuid,text),public.production_prepare_job(uuid,text,bigint,numeric,jsonb),
  public.production_timer_action(uuid,text,text),public.production_live_feed(uuid) from public;
grant execute on function public.production_bind_profile(uuid,uuid,text),public.production_prepare_job(uuid,text,bigint,numeric,jsonb),
  public.production_timer_action(uuid,text,text),public.production_live_feed(uuid) to authenticated;
commit;
