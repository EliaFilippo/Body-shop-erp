begin;
alter table public.production_live_jobs add column if not exists phase_budgets jsonb not null default '{}';
alter table public.production_live_jobs add column if not exists phase_time_limits jsonb not null default '{}';
-- Shares sum to the original vehicle budget. Zero-time phases receive no invented time.
create or replace function public.production_budget_shares(p_company_id uuid,p_job_id text,p_budget numeric)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with phases as (
    select ph->>'id' id,greatest(0,coalesce((ph->>'estimatedMinutes')::numeric,0)) weight
    from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
      jsonb_array_elements(coalesce(j->'phases','[]')) ph
    where s.company_id=p_company_id and j->>'id'=p_job_id
      and not coalesce((ph->>'notRequired')::boolean,false) and ph->>'name'<>'Consegna'
  ) select coalesce(jsonb_object_agg(id,to_jsonb(case when total>0 then p_budget*weight/total else 0 end)),'{}')
    from (select *,sum(weight) over() total from phases) q;
$$;
revoke all on function public.production_budget_shares(uuid,text,numeric) from public,anon,authenticated;
-- Freeze the shared allowance and its members alongside the financial budget.
create or replace function public.production_time_limits(p_company_id uuid,p_job_id text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with phases as (
  select ph from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
   jsonb_array_elements(coalesce(j->'phases','[]')) ph
  where s.company_id=p_company_id and j->>'id'=p_job_id
   and not coalesce((ph->>'notRequired')::boolean,false) and ph->>'name'<>'Consegna'
 ) select coalesce(jsonb_object_agg(ph->>'id',jsonb_build_object(
  'key',coalesce(nullif(ph->>'sharedTimeKey',''),ph->>'id'),
  'minutes',greatest(0,coalesce((ph->>'sharedTimeMinutes')::numeric,(ph->>'estimatedMinutes')::numeric,0)),
  'label',case ph->>'sharedTimeKey' when 'sr' then 'Smontaggio / rimontaggio' when 'is' then 'Incartatura / scartatura'
   when 'v' then 'Verniciatura, carteggiatura e stuccatura' else ph->>'name' end
 )),'{}') from phases;
$$;
revoke all on function public.production_time_limits(uuid,text) from public,anon,authenticated;
create or replace function public.production_freeze_phase_budgets()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and exists(select 1 from production_live_sessions where company_id=new.company_id and job_id=new.job_id) then
    new.phase_budgets:=old.phase_budgets;
    new.phase_time_limits:=old.phase_time_limits;
  else
    new.phase_budgets:=production_budget_shares(new.company_id,new.job_id,new.initial_budget);
    new.phase_time_limits:=production_time_limits(new.company_id,new.job_id);
  end if;
  return new;
end $$;
revoke all on function public.production_freeze_phase_budgets() from public,anon,authenticated;
-- Backfill preserves initial budget, rate snapshots and all existing time records.
update public.production_live_jobs set phase_budgets=production_budget_shares(company_id,job_id,initial_budget) where phase_budgets='{}';
update public.production_live_jobs set phase_time_limits=production_time_limits(company_id,job_id) where phase_time_limits='{}';
drop trigger if exists production_freeze_phase_budgets on public.production_live_jobs;
create trigger production_freeze_phase_budgets before insert or update of initial_budget on public.production_live_jobs
  for each row execute function public.production_freeze_phase_budgets();
do $$begin
  if to_regprocedure('public.production_live_feed_before_phase_budgets(uuid)') is null then
    alter function public.production_live_feed(uuid) rename to production_live_feed_before_phase_budgets;
  end if;
end $$;
revoke all on function public.production_live_feed_before_phase_budgets(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; item jsonb; ph jsonb; phases jsonb; jobs jsonb:='[]'; jid text;
  profile text; stamp timestamptz:=clock_timestamp(); initial numeric; allocation jsonb;
  total_spent numeric; phase_spent numeric; own_rate numeric; active_rate numeric;
  remaining numeric; share numeric; phase_count integer; limits jsonb; member_ids text[]; group_key text;
  time_minutes numeric; spent_seconds numeric; standard_remaining numeric;
begin
  result:=production_live_feed_before_phase_budgets(p_company_id); -- membership/tenant checks remain authoritative
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  for item in select value from jsonb_array_elements(result->'jobs') loop
    jid:=item->>'jobId'; phases:='[]';
    select initial_budget,phase_budgets,phase_time_limits,coalesce((select (r->>'rate')::numeric from jsonb_array_elements(operator_rates) r where r->>'id'=profile),0)
      into initial,allocation,limits,own_rate from production_live_jobs where company_id=p_company_id and job_id=jid;
    select coalesce(sum(extract(epoch from(coalesce(ended_at,stamp)-started_at))*rate/3600),0) into total_spent
      from production_live_segments where company_id=p_company_id and job_id=jid;
    for ph in select value from jsonb_array_elements(coalesce(item->'phases','[]')) loop
      group_key:=coalesce(limits->(ph->>'id')->>'key',ph->>'id');
      select coalesce(array_agg(key),array[ph->>'id']) into member_ids from jsonb_each(limits) where value->>'key'=group_key;
      select coalesce(sum(value::numeric),0) into share from jsonb_each_text(allocation) where key=any(member_ids);
      time_minutes:=coalesce((limits->(ph->>'id')->>'minutes')::numeric,0);
      select coalesce(sum(extract(epoch from(coalesce(ended_at,stamp)-started_at))*rate/3600),0),
        coalesce(sum(rate) filter(where ended_at is null),0),count(*) filter(where ended_at is null),
        coalesce(sum(extract(epoch from(coalesce(ended_at,stamp)-started_at))),0)
        into phase_spent,active_rate,phase_count,spent_seconds from production_live_segments
        where company_id=p_company_id and job_id=jid and phase_id=any(member_ids);
      remaining:=greatest(0,least(share-phase_spent,initial-total_spent));
      ph:=ph||jsonb_build_object('clock',jsonb_build_object(
        'remainingSeconds',case when share>0 and greatest(own_rate,active_rate)>0 then remaining/(case when active_rate>0 then active_rate else own_rate end)*3600 else null end,
        'ownRemainingSeconds',case when share>0 and own_rate>0 then remaining/own_rate*3600 else null end,
        'ownBurnFactor',case when own_rate>0 then active_rate/own_rate else 0 end,
        'remainingPercent',case when share>0 then remaining/share*100 else 100 end,'activeCount',phase_count));
      standard_remaining:=greatest(0,time_minutes*60-spent_seconds);
      ph:=ph||jsonb_build_object('standardClock',jsonb_build_object(
        'label',limits->(ph->>'id')->>'label','totalMinutes',time_minutes,
        'remainingSeconds',case when time_minutes>0 then standard_remaining/greatest(1,phase_count) else null end,
        'ownRemainingSeconds',case when time_minutes>0 then standard_remaining else null end,
        'ownBurnFactor',phase_count,'activeCount',phase_count,
        'remainingPercent',case when time_minutes>0 then standard_remaining/(time_minutes*60)*100 else 100 end));
      phases:=phases||jsonb_build_array(ph);
    end loop;
    jobs:=jobs||jsonb_build_array(item||jsonb_build_object('phases',phases));
  end loop;
  return result||jsonb_build_object('jobs',jobs);
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
create or replace function public.production_prepare_job(p_company_id uuid,p_job_id text,p_revision bigint,p_budget numeric,p_rates jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; revision bigint; job jsonb;
begin
  if not public.is_office_company_member(p_company_id) then raise exception 'Solo il titolare può confermare il budget'; end if;
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


commit;
