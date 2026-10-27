begin;
create table if not exists public.production_remote_stops (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 actor_id uuid not null references auth.users(id),
 stopped_at timestamptz not null,
 timers jsonb not null
);
alter table public.production_remote_stops enable row level security;
revoke all on public.production_remote_stops from public,anon,authenticated;

create or replace function public.production_open_timers(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare entries jsonb;
begin
 perform production_report_access(p_company_id);
 select coalesce(jsonb_agg(item order by item->>'name',item->>'startedAt'),'[]'::jsonb) into entries from (
  select jsonb_build_object('key','vehicle:'||s.id::text,'operatorId',s.operator_id,'name',l.operator_name,
   'kind','vehicle','jobId',s.job_id,'phaseId',s.phase_id,'plate',j.plate,'startedAt',s.started_at) item
  from production_live_segments s join production_live_sessions l using(company_id,job_id,operator_id)
   join production_live_jobs j using(company_id,job_id)
  where s.company_id=p_company_id and s.ended_at is null
  union all
  select jsonb_build_object('key','activity:'||a.id::text,'operatorId',a.operator_id,'name',a.operator_name,
   'kind',a.kind,'startedAt',a.started_at) from production_operator_activities a
  where a.company_id=p_company_id and a.ended_at is null
 ) facts;
 return jsonb_build_object('serverNow',clock_timestamp(),'canStop',is_company_owner(p_company_id),'timers',entries);
end $$;
revoke all on function public.production_open_timers(uuid) from public,anon;
grant execute on function public.production_open_timers(uuid) to authenticated;

create or replace function public.production_stop_timers(p_company_id uuid,p_keys jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare stamp timestamptz; selected jsonb; affected integer;
begin
 if not production_owner_password_recent(p_company_id) then
  raise exception 'Inserisci la password dei blocchi come titolare per fermare i timer.' using errcode='42501';
 end if;
 if p_keys is null or jsonb_typeof(p_keys)<>'array' then raise exception 'Seleziona i timer da fermare.';end if;
 if jsonb_array_length(p_keys)=0 or jsonb_array_length(p_keys)>1000 then raise exception 'Selezione timer non valida.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 stamp:=clock_timestamp();
 selected:=production_open_timers(p_company_id)->'timers';
 select coalesce(jsonb_agg(value),'[]'::jsonb) into selected from jsonb_array_elements(selected)
 where p_keys ? (value->>'key');
 -- IDs from the reviewed list only: a later Start is never stopped by a stale click.
 update production_live_segments s set ended_at=greatest(stamp,s.started_at)
 where s.company_id=p_company_id and s.ended_at is null and p_keys ? ('vehicle:'||s.id::text);
 update production_live_sessions l set status='paused'
 where l.company_id=p_company_id and l.status='running'
 and exists(select 1 from jsonb_array_elements(selected) e where e->>'kind'='vehicle' and e->>'operatorId'=l.operator_id and e->>'jobId'=l.job_id)
 and not exists(select 1 from production_live_segments s where s.company_id=l.company_id and s.operator_id=l.operator_id and s.ended_at is null);
 update production_operator_activities a set ended_at=greatest(stamp,a.started_at)
 where a.company_id=p_company_id and a.ended_at is null and p_keys ? ('activity:'||a.id::text);
 affected:=jsonb_array_length(selected);
 if affected>0 then
  insert into production_remote_stops(company_id,actor_id,stopped_at,timers) values(p_company_id,auth.uid(),stamp,selected);
 end if;
 -- No snapshot, phase signature or completed-state write.
 return jsonb_build_object('stoppedCount',affected,'report',production_open_timers(p_company_id));
end $$;
revoke all on function public.production_stop_timers(uuid,jsonb) from public,anon;
grant execute on function public.production_stop_timers(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
