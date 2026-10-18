begin;
create or replace function public.production_owner_password_recent(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.is_company_owner(p_company_id) and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) e
  where e->>'method'='password' and (e->>'timestamp')::numeric between extract(epoch from statement_timestamp())-300 and extract(epoch from statement_timestamp())+30);
$$;
revoke all on function public.production_owner_password_recent(uuid) from public,anon,authenticated;
create or replace function public.production_report_access(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not production_owner_password_recent(p_company_id) then raise exception 'Inserisci nuovamente la password del titolare per leggere i report dei dipendenti.' using errcode='42501';end if;
end $$;
revoke all on function public.production_report_access(uuid) from public,anon;
grant execute on function public.production_report_access(uuid) to authenticated;
do $$begin
 if to_regprocedure('public.production_hours_report_before_password(uuid,text,date,date)') is null then
  alter function public.production_hours_report(uuid,text,date,date) rename to production_hours_report_before_password;
 end if;
 if to_regprocedure('public.production_control_report_before_report_password(uuid,date,date,bigint)') is null then
  alter function public.production_control_report(uuid,date,date,bigint) rename to production_control_report_before_report_password;
 end if;
end $$;
revoke all on function public.production_hours_report_before_password(uuid,text,date,date),
 public.production_control_report_before_report_password(uuid,date,date,bigint) from public,anon,authenticated;
create or replace function public.production_hours_report(p_company_id uuid,p_operator_id text,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare own_operator text;
begin
 if not is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto';end if;
 select operator_id into own_operator from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if own_operator is distinct from p_operator_id then perform production_report_access(p_company_id);end if;
 return production_hours_report_before_password(p_company_id,p_operator_id,p_from,p_to);
end $$;
revoke all on function public.production_hours_report(uuid,text,date,date) from public,anon;
grant execute on function public.production_hours_report(uuid,text,date,date) to authenticated;
create or replace function public.production_staff_hours(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare stamp date:=(statement_timestamp() at time zone 'Europe/Rome')::date;
begin
 perform production_report_access(p_company_id);
 return coalesce((select jsonb_agg(jsonb_build_object('operatorId',o->>'id','name',o->>'name',
  'today',production_hours_report_before_password(p_company_id,o->>'id',stamp,stamp)))
  from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
  where s.company_id=p_company_id),'[]');
end $$;
revoke all on function public.production_staff_hours(uuid) from public,anon;
grant execute on function public.production_staff_hours(uuid) to authenticated;
create or replace function public.production_control_report(p_company_id uuid,p_from date,p_to date,p_ack_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 return production_control_report_before_report_password(p_company_id,p_from,p_to,p_ack_id)
  ||jsonb_build_object('operators','[]'::jsonb,'teams','[]'::jsonb);
end $$;
revoke all on function public.production_control_report(uuid,date,date,bigint) from public,anon;
grant execute on function public.production_control_report(uuid,date,date,bigint) to authenticated;
create or replace function public.production_productivity_report(p_company_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform production_report_access(p_company_id);
 return production_control_report_before_report_password(p_company_id,p_from,p_to,null);
end $$;
revoke all on function public.production_productivity_report(uuid,date,date) from public,anon;
grant execute on function public.production_productivity_report(uuid,date,date) to authenticated;
-- Do not preload anyone else's hours in the ordinary tablet feed, even for the owner.
create or replace function public.production_live_feed_before_phase_budgets(p_company_id uuid)
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
      'ownRemainingSeconds',case when c.own_rate>0 then greatest(0,c.initial_budget-c.spent)/c.own_rate*3600 else null end,
      'ownBurnFactor',case when c.own_rate>0 then c.active_rate/c.own_rate else 0 end,
      'ownPhaseId',(select ss.phase_id from production_live_sessions ss where ss.company_id=c.company_id and ss.job_id=c.job_id and ss.operator_id=profile),
      'remainingPercent',greatest(0,c.initial_budget-c.spent)/c.initial_budget*100,'activeCount',c.active_count,
      'ownStatus',(select ss.status from production_live_sessions ss where ss.company_id=c.company_id and ss.job_id=c.job_id and ss.operator_id=profile),
      'operators',coalesce((select jsonb_agg(jsonb_build_object('name',ss.operator_name,'status',ss.status)) from production_live_sessions ss
        where ss.company_id=c.company_id and ss.job_id=c.job_id),'[]'::jsonb)) || production_job_details(p_company_id,c.job_id)) from clocks c),'[]'::jsonb)) into result;
  result:=result || jsonb_build_object('program',coalesce((select jsonb_agg(jsonb_build_object('id',task->>'id','jobId',task->>'jobId','plate',task->>'plate',
      'phaseId',task->>'phaseId','phaseName',task->>'phaseName','startAt',task->>'startAt','endAt',task->>'endAt','panels',coalesce(task->'panelNames','[]'),
      'ready',exists(select 1 from production_live_jobs lj where lj.company_id=p_company_id and lj.job_id=task->>'jobId')) order by task->>'startAt')
      from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'operatorPrograms','[]')) program,jsonb_array_elements(coalesce(program->'tasks','[]')) task
      where s.company_id=p_company_id and program->>'operatorId'=profile
        and not exists(select 1 from production_phase_checks pc where pc.company_id=p_company_id and pc.job_id=task->>'jobId' and pc.phase_id=task->>'phaseId')
        and exists(select 1 from jsonb_array_elements(coalesce(s.payload->'jobs','[]')) jj where jj->>'id'=task->>'jobId' and jj->>'status' not in ('Consegnata','Annullata')
          and not exists(select 1 from jsonb_array_elements(coalesce(jj->'phases','[]')) ph where ph->>'id'=task->>'phaseId' and (ph->>'status'='Completata' or coalesce((ph->>'notRequired')::boolean,false))))),'[]'::jsonb),
    'today',case when profile is not null then production_hours_report(p_company_id,profile,(stamp at time zone 'Europe/Rome')::date,(stamp at time zone 'Europe/Rome')::date) else null end,
    'staff',case when false then coalesce((select jsonb_agg(jsonb_build_object('operatorId',o->>'id','name',o->>'name',
      'today',production_hours_report(p_company_id,o->>'id',(stamp at time zone 'Europe/Rome')::date,(stamp at time zone 'Europe/Rome')::date)))
      from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o where s.company_id=p_company_id),'[]'::jsonb) else '[]'::jsonb end);
  return result;
end $$;
revoke all on function public.production_live_feed_before_phase_budgets(uuid) from public,anon,authenticated;
commit;
