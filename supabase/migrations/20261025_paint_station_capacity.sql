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
