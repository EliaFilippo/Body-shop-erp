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
