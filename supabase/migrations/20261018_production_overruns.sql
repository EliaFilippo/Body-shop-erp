begin;
-- All times are productive person-seconds. Existing financial budgets and segments are untouched.
create table if not exists public.production_time_assignments (
 company_id uuid not null, job_id text not null, group_key text not null,
 weights jsonb not null default '{}', captured_at timestamptz not null default now(),
 primary key(company_id,job_id,group_key),
 foreign key(company_id,job_id) references production_live_jobs(company_id,job_id)
);
create table if not exists public.production_overrun_alerts (
 id bigint generated always as identity primary key, company_id uuid not null,
 job_id text not null, group_key text not null, phase_label text not null,
 detected_at timestamptz not null default now(), acknowledged_at timestamptz,
 acknowledged_by uuid references auth.users(id),
 unique(company_id,job_id,group_key),
 foreign key(company_id,job_id) references production_live_jobs(company_id,job_id)
);
alter table public.production_time_assignments enable row level security;
alter table public.production_overrun_alerts enable row level security;
revoke all on public.production_time_assignments,public.production_overrun_alerts from public,anon,authenticated;
-- A historical shared group has no reliable personal plan: do not invent one retrospectively.
insert into production_time_assignments(company_id,job_id,group_key)
 select distinct s.company_id,s.job_id,coalesce(j.phase_time_limits->s.phase_id->>'key',s.phase_id)
 from production_live_segments s join production_live_jobs j using(company_id,job_id)
 where s.phase_id is not null on conflict do nothing;
create or replace function public.production_capture_time_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare limits jsonb; g text; weights jsonb;
begin
 if new.phase_id is null then return new;end if;
 select phase_time_limits into limits from production_live_jobs where company_id=new.company_id and job_id=new.job_id;
 g:=coalesce(limits->new.phase_id->>'key',new.phase_id);
 -- Frozen at first actual Start, never rewritten by a later reassignment or snapshot refresh.
 select coalesce(jsonb_object_agg(op,to_jsonb(minutes)),'{}') into weights from (
  select t->>'operatorId' op,sum(greatest(0,coalesce((t->>'plannedMinutes')::numeric,0))) minutes
  from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'operatorPrograms','[]')) p,
   jsonb_array_elements(coalesce(p->'tasks','[]')) t
  where s.company_id=new.company_id and t->>'jobId'=new.job_id
   and coalesce(limits->(t->>'phaseId')->>'key',t->>'phaseId')=g
   and nullif(t->>'operatorId','') is not null
  group by t->>'operatorId' having sum(greatest(0,coalesce((t->>'plannedMinutes')::numeric,0)))>0
 ) q;
 insert into production_time_assignments(company_id,job_id,group_key,weights)
  values(new.company_id,new.job_id,g,weights) on conflict do nothing;
 return new;
end $$;
revoke all on function public.production_capture_time_assignment() from public,anon,authenticated;
drop trigger if exists production_capture_time_assignment on public.production_live_segments;
create trigger production_capture_time_assignment after insert on public.production_live_segments
 for each row execute function public.production_capture_time_assignment();
-- One fact per allowance, including retired legacy members for worked time, without multiplying S/R or I/S.
create or replace function public.production_time_facts(p_company_id uuid)
returns table(job_id text,plate text,number text,group_key text,label text,assigned_seconds numeric,
 spent_seconds numeric,active_count bigint,operators jsonb,completed boolean,completed_at timestamptz,closed boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 with groups as (
  select j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key) group_key,
   max(e.value->>'label') label,max(coalesce((e.value->>'minutes')::numeric,0))*60 assigned_seconds,
   array_agg(e.key) members
  from production_live_jobs j,jsonb_each(j.phase_time_limits) e where j.company_id=p_company_id
  group by j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key)
 ), payloads as (
  select j from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id
 )
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
  select sum(seconds) spent,sum(active) active,max(last_end) last_end,
   jsonb_agg(jsonb_build_object('operatorId',op,'name',name,'seconds',seconds)) people
  from (
   select seg.operator_id op,max(sess.operator_name) name,
    sum(greatest(0,extract(epoch from(coalesce(seg.ended_at,statement_timestamp())-seg.started_at)))) seconds,
    count(*) filter(where seg.ended_at is null) active,max(seg.ended_at) last_end
   from production_live_segments seg join production_live_sessions sess using(company_id,job_id,operator_id)
   where seg.company_id=p_company_id and seg.job_id=g.job_id and seg.phase_id=any(g.members)
   group by seg.operator_id
  ) q
 ) work on true;
$$;
revoke all on function public.production_time_facts(uuid) from public,anon,authenticated;
create or replace function public.production_scan_overruns(p_company_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
 insert into production_overrun_alerts(company_id,job_id,group_key,phase_label)
 select p_company_id,f.job_id,f.group_key,coalesce(f.label,'Lavorazione') from production_time_facts(p_company_id) f
 where not f.closed and f.assigned_seconds>0 and f.spent_seconds>f.assigned_seconds
 on conflict(company_id,job_id,group_key) do nothing;
$$;
revoke all on function public.production_scan_overruns(uuid) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.production_live_feed_before_overruns(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_overruns;
 end if;
end $$;
revoke all on function public.production_live_feed_before_overruns(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; item jsonb; ph jsonb; jobs jsonb:='[]'; phases jsonb; limits jsonb; facts jsonb; g text; extra numeric;
begin
 result:=production_live_feed_before_overruns(p_company_id); -- original tenant and role checks
 perform production_scan_overruns(p_company_id);
 for item in select value from jsonb_array_elements(result->'jobs') loop
  phases:='[]';
  select phase_time_limits into limits from production_live_jobs where company_id=p_company_id and job_id=item->>'jobId';
  select coalesce(jsonb_object_agg(f.group_key,to_jsonb(greatest(0,f.spent_seconds-f.assigned_seconds))),'{}') into facts
   from production_time_facts(p_company_id) f where f.job_id=item->>'jobId' and f.assigned_seconds>0;
  for ph in select value from jsonb_array_elements(coalesce(item->'phases','[]')) loop
   g:=coalesce(limits->(ph->>'id')->>'key',ph->>'id'); extra:=coalesce((facts->>g)::numeric,0);
   if jsonb_typeof(ph->'standardClock')='object' then
    ph:=jsonb_set(ph,'{standardClock}',(ph->'standardClock')||jsonb_build_object('overrunSeconds',extra));
   end if;
   phases:=phases||jsonb_build_array(ph);
  end loop;
  jobs:=jobs||jsonb_build_array(item||jsonb_build_object('phases',phases));
 end loop;
 return result||jsonb_build_object('jobs',jobs);
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
-- Office only: durable alerts and a weighted productivity score for completed comparable groups.
create or replace function public.production_control_report(p_company_id uuid,p_from date,p_to date,p_ack_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare alerts jsonb; people jsonb; teams jsonb;
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Periodo non valido';end if;
 perform production_scan_overruns(p_company_id);
 if p_ack_id is not null then
  update production_overrun_alerts set acknowledged_at=coalesce(acknowledged_at,now()),acknowledged_by=coalesce(acknowledged_by,auth.uid())
   where id=p_ack_id and company_id=p_company_id;
  if not found then raise exception 'Avviso non disponibile';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'jobId',a.job_id,'plate',j.plate,'number',j.number,
  'phase',a.phase_label,'detectedAt',a.detected_at,'acknowledgedAt',a.acknowledged_at,
  'overrunSeconds',greatest(0,coalesce(f.spent_seconds,0)-coalesce(f.assigned_seconds,0)),
  'operators',coalesce(f.operators,'[]'),'active',coalesce(f.active_count,0)>0) order by a.detected_at desc),'[]') into alerts
 from production_overrun_alerts a join production_live_jobs j using(company_id,job_id)
 left join production_time_facts(p_company_id) f on f.job_id=a.job_id and f.group_key=a.group_key
 where a.company_id=p_company_id and (a.acknowledged_at is null or (a.detected_at at time zone 'Europe/Rome')::date between p_from and p_to);
 with done as (
  select f.*,coalesce(a.weights,'{}') weights from production_time_facts(p_company_id) f
   left join production_time_assignments a on a.company_id=p_company_id and a.job_id=f.job_id and a.group_key=f.group_key
  where f.completed and f.assigned_seconds>0 and (f.completed_at at time zone 'Europe/Rome')::date between p_from and p_to
 ), comparable as (
  select d.*,
   (jsonb_array_length(operators)=1 or (
    (select count(*) from jsonb_object_keys(weights))=jsonb_array_length(operators)
    and not exists(select 1 from jsonb_array_elements(operators) o where not weights ? (o->>'operatorId'))
   )) reliable
  from done d
 ), scores as (
  select o->>'operatorId' op,max(o->>'name') name,
   sum(case when reliable then assigned_seconds * case when jsonb_array_length(operators)=1 then 1
    else (weights->>(o->>'operatorId'))::numeric/(select sum(value::numeric) from jsonb_each_text(weights)) end else 0 end) assigned,
   sum(case when reliable then (o->>'seconds')::numeric else 0 end) worked,
   count(*) filter(where reliable) groups,
   sum(case when not reliable then (o->>'seconds')::numeric else 0 end) shared
  from comparable,jsonb_array_elements(operators) o group by o->>'operatorId'
 ) select coalesce(jsonb_agg(jsonb_build_object('operatorId',op,'name',name,'assignedSeconds',assigned,
  'workedSeconds',worked,'score',case when worked>0 then round(100*assigned/worked,1) else null end,
  'completedGroups',groups,'unscoredSharedSeconds',shared) order by name),'[]') into people from scores;
 select coalesce(jsonb_agg(jsonb_build_object('jobId',f.job_id,'plate',f.plate,'phase',f.label,
  'assignedSeconds',f.assigned_seconds,'workedSeconds',f.spent_seconds,
  'score',round(100*f.assigned_seconds/f.spent_seconds,1),'operators',f.operators) order by f.completed_at desc),'[]') into teams
 from production_time_facts(p_company_id) f where f.completed and f.assigned_seconds>0 and f.spent_seconds>0
  and jsonb_array_length(f.operators)>1 and (f.completed_at at time zone 'Europe/Rome')::date between p_from and p_to;
 return jsonb_build_object('alerts',alerts,'operators',people,'teams',teams,'serverNow',statement_timestamp());
end $$;
revoke all on function public.production_control_report(uuid,date,date,bigint) from public,anon;
grant execute on function public.production_control_report(uuid,date,date,bigint) to authenticated;
commit;
