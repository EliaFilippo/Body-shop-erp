begin;

create or replace function public.production_efficiency(
 p_company_id uuid, p_from date, p_to date, p_staff boolean default false, p_details boolean default false
)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshot jsonb; own_operator text; result jsonb;
begin
 if not is_active_company_member(p_company_id) then
  raise exception 'Accesso aziendale richiesto' using errcode='42501';
 end if;
 if p_staff is true then
  if not is_office_company_member(p_company_id) then
   raise exception 'Accesso ufficio richiesto' using errcode='42501';
  end if;
  if p_details is true then
   perform production_report_access(p_company_id);
  end if;
 else
  select operator_id into own_operator from production_profiles
  where company_id=p_company_id and user_id=auth.uid();
  if own_operator is null or p_details is true then
   raise exception 'Profilo operatore richiesto' using errcode='42501';
  end if;
 end if;

 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then
  raise exception 'Periodo non valido';
 end if;
 select payload into snapshot from production_read_snapshots where company_id=p_company_id;

 with roster as (
  select o->>'id' as id,o->>'name' as name
  from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o
  where (p_staff is true and (o->>'active')::boolean) or o->>'id'=own_operator
 ), closed_jobs as materialized (
  select j->>'id' as id
  from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j
  where j->>'status' in ('Pronta consegna','Consegnata')
 ), comparable as (
  select f.*,coalesce(a.weights,'{}') as weights
  from production_time_facts(p_company_id) f
  join closed_jobs j on j.id=f.job_id
  left join production_time_assignments a on a.company_id=p_company_id and a.job_id=f.job_id and a.group_key=f.group_key
  where f.completed and f.assigned_seconds>0
   and (f.completed_at at time zone 'Europe/Rome')::date between p_from and p_to
 ), allocations as (
  select f.job_id,f.plate,f.label,f.group_key,f.completed_at,
   o->>'operatorId' as operator_id,(o->>'seconds')::numeric as worked,
   case
    when jsonb_array_length(f.operators)=1 and weights.people=0 then f.assigned_seconds
    when weights.total>0 and weights.people=jsonb_array_length(f.operators)
     and not exists(select 1 from jsonb_array_elements(f.operators) person
      where coalesce((f.weights->>(person->>'operatorId'))::numeric,0)<=0)
    then f.assigned_seconds*(f.weights->>(o->>'operatorId'))::numeric/weights.total
   end as planned
  from comparable f
  cross join lateral jsonb_array_elements(f.operators) o
  cross join lateral (select count(*) as people,sum(value::numeric) as total
   from jsonb_each_text(f.weights)) weights
  where (o->>'seconds')::numeric>0
 ), totals as (
  select a.operator_id,sum(a.planned) as planned,sum(a.worked) as worked,
   sum(greatest(0,a.planned-a.worked)) as saved,sum(greatest(0,a.worked-a.planned)) as overrun,
   case when p_details is true then jsonb_agg(jsonb_build_object(
    'jobId',a.job_id,'plate',a.plate,'phase',a.label,'group',a.group_key,
    'plannedSeconds',a.planned,'workedSeconds',a.worked) order by a.completed_at desc,a.job_id,a.group_key) end as details
  from allocations a join roster r on r.id=a.operator_id
  where a.planned>0
  group by a.operator_id
 )
 , staff_rows as (
  select coalesce(jsonb_agg(jsonb_build_object('operatorId',r.id,'name',r.name,
   'plannedSeconds',t.planned,'workedSeconds',t.worked)
   || case when p_details is true then jsonb_build_object('details',coalesce(t.details,'[]'),
    'savedSeconds',t.saved,'overrunSeconds',t.overrun) else '{}'::jsonb end order by r.name,r.id),'[]') as rows
  from roster r left join totals t on t.operator_id=r.id
 )
 select case when p_details is true then jsonb_build_object('rows',rows,'teams',(
   select coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'group',group_key,'phase',label,'plate',plate,
    'plannedSeconds',assigned_seconds,'workedSeconds',spent_seconds,'operators',operators) order by completed_at desc),'[]')
   from comparable where jsonb_array_length(operators)>1
  )) else rows end into result from staff_rows;

 return result;
end $$;

revoke all on function public.production_efficiency(uuid,date,date,boolean,boolean) from public,anon;
grant execute on function public.production_efficiency(uuid,date,date,boolean,boolean) to authenticated;

commit;
