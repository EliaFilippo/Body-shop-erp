CREATE OR REPLACE FUNCTION public.production_time_facts(p_company_id uuid)
 RETURNS TABLE(job_id text, plate text, number text, group_key text, label text, assigned_seconds numeric, spent_seconds numeric, active_count bigint, operators jsonb, completed boolean, completed_at timestamp with time zone, closed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 with frozen_groups as (
  select j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key) group_key,
   max(e.value->>'label') label,max(coalesce((e.value->>'minutes')::numeric,0))*60 assigned_seconds,
   array_agg(e.key) members
  from production_live_jobs j,jsonb_each(j.phase_time_limits) e where j.company_id=p_company_id
  group by j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key)
 ), payloads as (
  select jsonb_set(j,'{phases}',production_effective_phases(p_company_id,j)) j from production_read_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id
 ), extras as (
  select lj.job_id,lj.plate,lj.number,seg.phase_id group_key,max(ph->>'name') label,0::numeric assigned_seconds,array[seg.phase_id] members
  from production_live_segments seg join production_live_jobs lj using(company_id,job_id)
  join payloads p on p.j->>'id'=seg.job_id
  cross join lateral jsonb_array_elements(production_manual_phases(p.j)) ph
  where seg.company_id=p_company_id and seg.manual_start and ph->>'id'=seg.phase_id
   and not exists(select 1 from jsonb_each(lj.phase_time_limits) e where e.key=seg.phase_id)
  group by lj.job_id,lj.plate,lj.number,seg.phase_id
 ), groups as (select * from frozen_groups union all select * from extras)
 select g.job_id,g.plate,g.number,g.group_key,g.label,g.assigned_seconds,
  coalesce(work.spent,0),coalesce(work.active,0),coalesce(work.people,'[]'),
  coalesce(work.active,0)=0 and coalesce(work.spent,0)>0
   and exists(select 1 from jsonb_array_elements(coalesce(p.j->'phases','[]')) ph
     where ph->>'id'=any(g.members) and not coalesce((ph->>'notRequired')::boolean,false))
   and not exists(select 1 from jsonb_array_elements(coalesce(p.j->'phases','[]')) ph
     where ph->>'id'=any(g.members) and not coalesce((ph->>'notRequired')::boolean,false)
      and ph->>'status' is distinct from 'Completata'
      and not exists(select 1 from production_phase_checks c where c.company_id=p_company_id and c.job_id=g.job_id and c.phase_id=ph->>'id')),
  work.last_end,coalesce(p.j->>'status' in ('Consegnata','Annullata'),true)
 from groups g left join payloads p on p.j->>'id'=g.job_id
 left join lateral (
  with segments as materialized (
   select seg.operator_id, sess.operator_name, seg.started_at, seg.ended_at,
    greatest(seg.started_at,coalesce(seg.ended_at,statement_timestamp())) as stop_at
   from production_live_segments seg join production_live_sessions sess using(company_id,job_id,operator_id)
   where seg.company_id=p_company_id and seg.job_id=g.job_id and seg.phase_id=any(g.members)
  ), events as (
   select stamp,sum(delta) as delta from (
    select started_at as stamp,1 as delta from segments
    union all select stop_at,-1 from segments
   ) boundaries group by stamp
  ), intervals as (
   select stamp,lead(stamp) over(order by stamp) as next_stamp,
    sum(delta) over(order by stamp) as workers from events
  ), elapsed as (
   select *,coalesce(sum(extract(epoch from next_stamp-stamp)*workers)
    over(order by stamp rows between unbounded preceding and 1 preceding),0) as prior_seconds
   from intervals
  ), crossing as (
   select stamp,prior_seconds,workers from elapsed
   where workers>0 and prior_seconds+extract(epoch from next_stamp-stamp)*workers>g.assigned_seconds
   order by stamp limit 1
  ), totals as (
   select s.operator_id as op,max(s.operator_name) as name,
    sum(extract(epoch from s.stop_at-s.started_at)) as seconds,
    sum(case when c.stamp is null then 0 else greatest(0,extract(epoch from s.stop_at-greatest(s.started_at,c.stamp))
     - case when s.started_at<=c.stamp then (g.assigned_seconds-c.prior_seconds)/c.workers else 0 end) end) as overrun_seconds,
    count(*) filter(where s.ended_at is null) as active,max(s.ended_at) as last_end
   from segments s left join crossing c on true group by s.operator_id
  )
  select sum(seconds) spent,sum(active) active,max(last_end) last_end,
   jsonb_agg(jsonb_build_object('operatorId',op,'name',name,'seconds',seconds,'overrunSeconds',overrun_seconds)) people
  from totals
 ) work on true;
$function$
;
