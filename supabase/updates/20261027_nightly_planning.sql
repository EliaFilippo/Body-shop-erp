begin;
-- Atomic hand-off: rollback restores the previous timer if any target guard fails.
create or replace function public.production_start_selected_job(p_company_id uuid,p_job_id text,p_phase_id text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text; prior record;
begin
 if not public.is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if profile is null then raise exception 'Collega il profilo a un operatore';end if;
 for prior in select job_id,phase_id from production_live_sessions
  where company_id=p_company_id and operator_id=profile and status='running'
 loop
  if prior.job_id=p_job_id and prior.phase_id is not distinct from p_phase_id then return;end if;
  perform production_timer_action(p_company_id,prior.job_id,'pause');
 end loop;
 -- End cleaning/coffee atomically with the requested Start, never before the company lock.
 if to_regprocedure('public.production_activity_action(uuid,text)') is not null then
  perform production_activity_action(p_company_id,'end');
 end if;
 -- Preserve all existing duties, predecessor, drying, wash and paint capacity guards.
 perform production_timer_action(p_company_id,p_job_id,'start',p_phase_id);
end $$;
revoke all on function public.production_start_selected_job(uuid,text,text) from public,anon;
grant execute on function public.production_start_selected_job(uuid,text,text) to authenticated;

-- Operational planning facts only. No prices or budgets, no snapshot mutation.
create or replace function public.production_planning_state(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto';end if;
 select coalesce(jsonb_agg(entry order by entry->>'jobId',entry->>'phaseId',entry->>'operatorId'),'[]') into result
 from (
  select jsonb_build_object('jobId',s.job_id,'phaseId',s.phase_id,'operatorId',s.operator_id,
   'operatorName',coalesce(max(ss.operator_name),s.operator_id),
   'closedSeconds',coalesce(sum(extract(epoch from(s.ended_at-s.started_at))) filter(where s.ended_at is not null),0),
   'runningSince',min(s.started_at) filter(where s.ended_at is null),
   'firstStartedAt',min(s.started_at),'lastEndedAt',max(s.ended_at)) entry
  from production_live_segments s
  join production_live_sessions ss on ss.company_id=s.company_id and ss.job_id=s.job_id and ss.operator_id=s.operator_id
  where s.company_id=p_company_id and s.phase_id is not null
  group by s.job_id,s.phase_id,s.operator_id
 ) facts;
 return jsonb_build_object('serverNow',statement_timestamp(),'entries',result);
end $$;
revoke all on function public.production_planning_state(uuid) from public,anon;
grant execute on function public.production_planning_state(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

begin;
create table if not exists public.production_nightly_settings(
 company_id uuid primary key references public.companies(id),enabled boolean not null default true,
 run_hour integer not null default 3 check(run_hour between 0 and 20),secret_hash text not null
);
create table if not exists public.production_nightly_runs(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 run_date date not null,source_revision bigint not null,watermark text not null,
 status text not null,lease_until timestamptz not null,completed_at timestamptz,
 previous_programs jsonb,unique(company_id,run_date)
);
alter table production_nightly_settings enable row level security;
alter table production_nightly_runs enable row level security;
revoke all on production_nightly_settings,production_nightly_runs from public,anon,authenticated;
create or replace function public.production_nightly_watermark(p_company_id uuid)
returns text language sql security definer set search_path=public,pg_temp as $$
 select md5(jsonb_build_array(
 (select coalesce(max(id),0) from production_live_segments where company_id=p_company_id),
 (select coalesce(sum(extract(epoch from ended_at)),0) from production_live_segments where company_id=p_company_id),
 (select coalesce(max(checked_at)::text,'')||count(*) from production_phase_checks where company_id=p_company_id)
 )::text)
$$;
revoke all on function production_nightly_watermark(uuid) from public,anon,authenticated;
create or replace function public.production_nightly_busy(p_company_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare activity boolean:=false;
begin
 if to_regclass('public.production_operator_activities') is not null then
  execute 'select exists(select 1 from production_operator_activities where company_id=$1 and ended_at is null and kind=''cleaning'')' into activity using p_company_id;
 end if;
 return activity or exists(select 1 from production_live_segments where company_id=p_company_id and ended_at is null);
end $$;
revoke all on function production_nightly_busy(uuid) from public,anon,authenticated;
create or replace function public.production_nightly_claim(p_company_id uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare config record;source record;run record;stamp timestamptz:=clock_timestamp();day date;hour integer;facts jsonb;checks jsonb;
begin
 select * into config from production_nightly_settings where company_id=p_company_id and enabled;
 if not found or p_secret is null or encode(sha256(convert_to(p_secret,'UTF8')),'hex')<>config.secret_hash then return null;end if;
 day:=(stamp at time zone 'Europe/Rome')::date;hour:=extract(hour from stamp at time zone 'Europe/Rome');
 if hour<config.run_hour or hour>=config.run_hour+4 then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 if production_nightly_busy(p_company_id) then return null;end if;
 select * into source from erp_snapshots where company_id=p_company_id for update;
 if not found then return null;end if;
 select * into run from production_nightly_runs where company_id=p_company_id and run_date=day;
 if found and (run.status='completed' or run.lease_until>stamp) then return null;end if;
 insert into production_nightly_runs(company_id,run_date,source_revision,watermark,status,lease_until)
 values(p_company_id,day,source.revision,production_nightly_watermark(p_company_id),'running',stamp+interval '3 minutes')
 on conflict(company_id,run_date) do update set id=gen_random_uuid(),source_revision=excluded.source_revision,watermark=excluded.watermark,status='running',lease_until=excluded.lease_until
 returning * into run;
 select coalesce(jsonb_agg(entry),'[]') into facts from (
 select jsonb_build_object('jobId',s.job_id,'phaseId',s.phase_id,'operatorId',s.operator_id,'operatorName',max(ss.operator_name),
 'closedSeconds',coalesce(sum(extract(epoch from(s.ended_at-s.started_at))) filter(where s.ended_at is not null),0),
 'runningSince',min(s.started_at) filter(where s.ended_at is null),'firstStartedAt',min(s.started_at),'lastEndedAt',max(s.ended_at)) entry
 from production_live_segments s join production_live_sessions ss on ss.company_id=s.company_id and ss.job_id=s.job_id and ss.operator_id=s.operator_id
 where s.company_id=p_company_id and s.phase_id is not null group by s.job_id,s.phase_id,s.operator_id) data;
 select coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'phaseId',phase_id,'checkedBy',operator_name,'checkedAt',checked_at,'workedSeconds',worked_seconds)),'[]') into checks
 from production_phase_checks where company_id=p_company_id;
 return jsonb_build_object('id',run.id,'revision',source.revision,'day',day,'payload',source.payload,'state',jsonb_build_object('serverNow',stamp,'entries',facts),'checks',checks);
end $$;
revoke all on function production_nightly_claim(uuid,text) from public,anon,authenticated;
grant execute on function production_nightly_claim(uuid,text) to service_role;
create or replace function public.production_nightly_commit(p_company_id uuid,p_run_id uuid,p_revision bigint,p_plan jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare run record;source record;field text;next jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select * into run from production_nightly_runs where company_id=p_company_id and id=p_run_id and status='running' for update;
 if not found or run.lease_until<clock_timestamp() or run.source_revision<>p_revision then return false;end if;
 select * into source from erp_snapshots where company_id=p_company_id for update;
 if source.revision<>p_revision or production_nightly_busy(p_company_id) or run.watermark<>production_nightly_watermark(p_company_id) then
  update production_nightly_runs set status='retry',lease_until=clock_timestamp() where id=p_run_id;return false;
 end if;
 if (p_plan->'nightlyPlanning'->>'enabled') is distinct from 'true' or jsonb_typeof(p_plan->'operatorPrograms') is distinct from 'array' then raise exception 'Piano notturno non valido';end if;
 next:=source.payload;
 foreach field in array array['jobs','vehicles','plannerAssignments','operatorPrograms','operatorProgramHistory','operatorProgramRevision','productionPlanningSampleAt','nightlyPlanning'] loop
  if p_plan?field then next:=jsonb_set(next,array[field],p_plan->field);end if;
 end loop;
 update erp_snapshots set payload=next,revision=revision+1,updated_at=clock_timestamp() where company_id=p_company_id;
 update production_nightly_runs set status='completed',completed_at=clock_timestamp(),previous_programs=source.payload->'operatorPrograms' where id=p_run_id;
 return true;
end $$;
revoke all on function production_nightly_commit(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function production_nightly_commit(uuid,uuid,bigint,jsonb) to service_role;
create or replace function public.production_nightly_failed(p_company_id uuid,p_run_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
 update production_nightly_runs set status='retry',lease_until=clock_timestamp() where company_id=p_company_id and id=p_run_id and status='running'
$$;
revoke all on function production_nightly_failed(uuid,uuid) from public,anon,authenticated;
grant execute on function production_nightly_failed(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
