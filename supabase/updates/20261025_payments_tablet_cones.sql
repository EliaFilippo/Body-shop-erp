begin;
-- Three distinct vehicles, not three people. Pause/Finish do not move the vehicle out of its bay.
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
   case when checked_at is not null or p->>'status'='Completata' then
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
drop trigger if exists paint_station_capacity_start on public.production_live_segments;
create trigger paint_station_capacity_start before insert on public.production_live_segments
 for each row execute function public.guard_paint_station_capacity();
commit;

begin;
-- Expose only the cone of jobs already authorized by the existing production feed.
create or replace function public.production_job_cone(snapshot jsonb,target_job text)
returns integer language plpgsql set search_path=public,pg_temp as $$
declare job jsonb; vehicle jsonb; raw text;
begin
 select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'id'=target_job;
 if job is null then return null;end if;
 select v into vehicle from jsonb_array_elements(coalesce(snapshot->'vehicles','[]')) v where v->>'id'=job->>'vehicleId';
 raw:=case when vehicle is not null then vehicle->>'coneNumber' else job->>'coneNumber' end;
 if raw~'^[0-9]{1,2}$' and raw::integer between 1 and 30 then return raw::integer;end if;
 return null;
end $$;
revoke all on function public.production_job_cone(jsonb,text) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.production_live_feed_before_cones(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_cones;
 end if;
end $$;
revoke all on function public.production_live_feed_before_cones(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; snapshot jsonb; item jsonb; jobs jsonb:='[]'; program jsonb:='[]';
begin
 result:=production_live_feed_before_cones(p_company_id);
 select s.payload into snapshot from erp_snapshots s where s.company_id=p_company_id;
 for item in select value from jsonb_array_elements(coalesce(result->'jobs','[]')) loop
  jobs:=jobs||jsonb_build_array(item||jsonb_build_object('coneNumber',production_job_cone(snapshot,item->>'jobId')));
 end loop;
 for item in select value from jsonb_array_elements(coalesce(result->'program','[]')) loop
  program:=program||jsonb_build_array(item||jsonb_build_object('coneNumber',production_job_cone(snapshot,item->>'jobId')));
 end loop;
 return result||jsonb_build_object('jobs',jobs,'program',program);
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
commit;
