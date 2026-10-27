begin;
alter table public.production_live_segments add column if not exists manual_start boolean not null default false;
-- Segment tables already have RLS and no direct client write grants. Only the RPC can start work.
create or replace function public.guard_production_cycle_start()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; has_phases boolean;
begin
 -- Manual work is an explicit authenticated choice, recorded on the immutable work segment.
 if new.manual_start then
  if not is_active_company_member(new.company_id) or not exists(
   select 1 from production_profiles p where p.company_id=new.company_id and p.user_id=auth.uid() and p.operator_id=new.operator_id
  ) then raise exception 'Accesso operatore richiesto' using errcode='42501';end if;
  return new;
 end if;
 select jsonb_array_length(coalesce(j->'phases','[]'))>0 into has_phases from erp_snapshots s,
  jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=new.company_id and j->>'id'=new.job_id;
 if coalesce(has_phases,false) and not production_operator_can_phase(new.company_id,new.job_id,new.operator_id,new.phase_id)
  then raise exception 'Mansione non abilitata per questo operatore' using errcode='42501';end if;
 reason:=production_cycle_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason;end if;
 return new;
end $$;
revoke all on function public.guard_production_cycle_start() from public,anon,authenticated;

create or replace function public.production_manual_start(p_company_id uuid,p_job_id text,p_phase_id text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text; op jsonb; snapshot jsonb; job jsonb; phase jsonb; prior record; stamp timestamptz; painted_at timestamptz; target_order bigint; paint_order bigint; paint_phase jsonb;
begin
 if not is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 if profile is null or not exists(select 1 from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o
  where o->>'id'=profile and coalesce((o->>'active')::boolean,false)) then raise exception 'Collega un operatore attivo al profilo';end if;
 select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'id'=p_job_id;
 if job is null or coalesce(job->>'status','') in ('Consegnata','Annullata') then raise exception 'La commessa è chiusa o non disponibile';end if;
 select r into op from production_live_jobs j,jsonb_array_elements(j.operator_rates) r
  where j.company_id=p_company_id and j.job_id=p_job_id and r->>'id'=profile;
 if op is null then raise exception 'Budget non confermato per questo operatore';end if;
 if jsonb_array_length(coalesce(job->'phases','[]'))>0 then
  select ph into phase from jsonb_array_elements(job->'phases') ph where ph->>'id'=p_phase_id;
  if phase is null or coalesce((phase->>'notRequired')::boolean,false) then raise exception 'Scegli una fase prevista sulla vettura';end if;
  if phase->>'name'='Consegna' then raise exception 'La consegna viene registrata dall’ufficio';end if;
 elsif p_phase_id is not null then raise exception 'Fase non disponibile';end if;
 if job->>'workflowCycle'='elias-v1' then
  select ord into target_order from jsonb_array_elements(job->'phases') with ordinality s(ph,ord) where ph->>'id'=p_phase_id;
  select ph,ord into paint_phase,paint_order from jsonb_array_elements(job->'phases') with ordinality s(ph,ord) where ph->>'name'='Verniciatura' and not coalesce((ph->>'notRequired')::boolean,false);
  if target_order>paint_order then
   select checked_at into painted_at from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=paint_phase->>'id';
   painted_at:=coalesce(painted_at,nullif(paint_phase->>'completedAt','')::timestamptz,nullif(paint_phase->>'endedAt','')::timestamptz);
   select greatest(painted_at,max(ended_at)) into painted_at from production_live_segments
    where company_id=p_company_id and job_id=p_job_id and phase_id=paint_phase->>'id' and manual_start;
   if painted_at+interval '1 hour'>clock_timestamp() then raise exception 'Attesa asciugatura prima di proseguire';end if;
  end if;
 end if;
 -- Validate before stopping anything. The whole function rolls back if a station guard rejects Start.
 for prior in select job_id,phase_id from production_live_sessions
  where company_id=p_company_id and operator_id=profile and status='running' loop
  if prior.job_id=p_job_id and prior.phase_id is not distinct from p_phase_id then return;end if;
  perform production_timer_action(p_company_id,prior.job_id,'pause');
 end loop;
 perform production_activity_action(p_company_id,'end');
 stamp:=clock_timestamp();
 insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 values(p_company_id,p_job_id,profile,auth.uid(),op->>'name','running',p_phase_id)
 on conflict(company_id,job_id,operator_id) do update set status='running',user_id=auth.uid(),phase_id=excluded.phase_id;
 insert into production_live_segments(company_id,job_id,operator_id,rate,started_at,phase_id,ordinary_schedule,manual_start)
 values(p_company_id,p_job_id,profile,(op->>'rate')::numeric,stamp,p_phase_id,production_operator_schedule(snapshot,profile),true);
 -- Existing signatures are history: additional work never erases or fabricates completion.
end $$;
revoke all on function public.production_manual_start(uuid,text,text) from public,anon;
grant execute on function public.production_manual_start(uuid,text,text) to authenticated;

-- All open published vehicles and phases are visible; automatic assignments keep their skill filter.
create or replace function public.production_live_feed_before_cones(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;profile text;item jsonb;phases jsonb;jobs jsonb:='[]';program jsonb;
 snapshot jsonb;op jsonb;allowed jsonb;open_jobs jsonb;
begin
 result:=production_live_feed_before_duties(p_company_id); -- Original tenant/role/economic privacy checks.
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 select value into op from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) where value->>'id'=profile;
 select coalesce(jsonb_object_agg(j->>'id',ids),'{}'),coalesce(jsonb_agg(j->'id') filter(where coalesce(j->>'status','') not in ('Consegnata','Annullata')),'[]')
 into allowed,open_jobs from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j
 cross join lateral (select coalesce(jsonb_agg(p->'id'),'[]') ids from jsonb_array_elements(coalesce(j->'phases','[]')) p
 where production_phase_matches_operator(op,p)) permitted;
 for item in select value from jsonb_array_elements(coalesce(result->'jobs','[]')) loop
  -- A stale closed vehicle can only remain visible to stop the caller's outstanding timer.
  if not (open_jobs ? (item->>'jobId')) and coalesce(item->>'ownStatus','') not in ('running','paused') then continue;end if;
  select coalesce(jsonb_agg(ph||jsonb_build_object('automaticAllowed',coalesce((allowed->(item->>'jobId')) ? (ph->>'id'),false))),'[]')
  into phases from jsonb_array_elements(coalesce(item->'phases','[]')) ph;
  jobs:=jobs||jsonb_build_array(item||jsonb_build_object('phases',phases,'dutiesFiltered',false,'manualStartAllowed',open_jobs ? (item->>'jobId')));
 end loop;
 select coalesce(jsonb_agg(t),'[]') into program from jsonb_array_elements(coalesce(result->'program','[]')) t
 where coalesce((allowed->(t->>'jobId')) ? (t->>'phaseId'),false);
 return result||jsonb_build_object('jobs',jobs,'program',program,'dutiesFiltered',false,'manualSelection',true);
end $$;
revoke all on function public.production_live_feed_before_cones(uuid) from public,anon,authenticated;
create or replace function public.guard_paint_station_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_name text; occupied integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select p->>'name' into phase_name
 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
  jsonb_array_elements(coalesce(j->'phases','[]')) p
 where s.company_id=new.company_id and j->>'id'=new.job_id and p->>'id'=new.phase_id;
 if phase_name is distinct from 'Verniciatura' then return new;end if;
 with phases as (
  select j->>'id' as job_id,p,
   (select max(c.checked_at) from production_phase_checks c
    where c.company_id=new.company_id and c.job_id=j->>'id' and c.phase_id=p->>'id') checked_at,
   exists(select 1 from production_live_segments seg
    where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id') has_started
  from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
   jsonb_array_elements(coalesce(j->'phases','[]')) p
  where s.company_id=new.company_id and j->>'id'<>new.job_id
   and coalesce(j->>'status','') not in ('Annullata','Consegnata')
   and p->>'name'='Verniciatura' and not coalesce((p->>'notRequired')::boolean,false)
 ), occupied_phases as (
  select job_id from phases where
   case when exists(select 1 from production_live_sessions ss
    where ss.company_id=new.company_id and ss.job_id=phases.job_id and ss.phase_id=p->>'id' and ss.status in ('running','paused')
    and exists(select 1 from production_live_segments seg where seg.company_id=ss.company_id and seg.job_id=ss.job_id and seg.operator_id=ss.operator_id and seg.phase_id=ss.phase_id and seg.manual_start and seg.started_at>coalesce(checked_at,'-infinity'::timestamptz))) then true
   when exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=phases.job_id and seg.phase_id=p->>'id' and seg.manual_start and seg.ended_at+interval '1 hour'>clock_timestamp()) then true
   when checked_at is not null or p->>'status'='Completata' then
    coalesce(checked_at,nullif(p->>'completedAt','')::timestamptz,nullif(p->>'endedAt','')::timestamptz)
     +make_interval(mins=>greatest(0,coalesce((p->>'technicalWaitMinutes')::integer,60)))>clock_timestamp()
   else has_started or p->>'status'='In lavorazione' end
 )
 select count(distinct job_id) into occupied from occupied_phases;
 if occupied>=3 then
  raise exception 'Le 3 postazioni di verniciatura sono occupate, inclusa l’asciugatura. Attendi che se ne liberi una prima di avviare un’altra vettura.';
 end if;
 return new;
end $$;
revoke all on function public.guard_paint_station_capacity() from public,anon,authenticated;

create or replace function public.guard_wash_station_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_name text; occupied boolean;
begin
 if new.ended_at is not null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select p->>'name' into phase_name from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(coalesce(j->'phases','[]')) p
 where s.company_id=new.company_id and j->>'id'=new.job_id and p->>'id'=new.phase_id;
 if phase_name is null or phase_name not in ('Lavaggio esterno','Lavaggio interni','Lavaggio') then return new;end if;
 select exists(
  select 1 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(coalesce(j->'phases','[]')) p
  where s.company_id=new.company_id and coalesce(j->>'status','') not in ('Annullata','Consegnata')
  and p->>'name' in ('Lavaggio esterno','Lavaggio interni','Lavaggio') and not coalesce((p->>'notRequired')::boolean,false)
  and (
   exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id' and seg.operator_id<>new.operator_id and seg.ended_at is null)
   or (
    (j->>'id'<>new.job_id or p->>'id'<>new.phase_id)
    and (
     (p->>'status'<>'Completata'
      and not exists(select 1 from production_phase_checks c where c.company_id=new.company_id and c.job_id=j->>'id' and c.phase_id=p->>'id')
      and exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id'))
     or exists(select 1 from production_live_sessions ss where ss.company_id=new.company_id and ss.job_id=j->>'id' and ss.phase_id=p->>'id' and ss.status='paused'
      and exists(select 1 from production_live_segments seg where seg.company_id=ss.company_id and seg.job_id=ss.job_id and seg.operator_id=ss.operator_id and seg.phase_id=ss.phase_id and seg.manual_start and seg.started_at>coalesce((select c.checked_at from production_phase_checks c where c.company_id=ss.company_id and c.job_id=ss.job_id and c.phase_id=ss.phase_id),'-infinity'::timestamptz)))
    )
   )
  )
 ) into occupied;
 if occupied then raise exception 'La sola postazione di lavaggio è occupata. Attendi il completamento del lavaggio o lavora su un’altra fase abilitata.';end if;
 return new;
end $$;
revoke all on function public.guard_wash_station_capacity() from public,anon,authenticated;

-- Some installations have the function but missed the wash trigger update.
do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='public.production_live_segments'::regclass and tgname='wash_station_capacity_start' and not tgisinternal) then
  create trigger wash_station_capacity_start before insert on public.production_live_segments
   for each row execute function public.guard_wash_station_capacity();
 end if;
end $$;
notify pgrst,'reload schema';
commit;
