begin;
-- Manual tablet starts bypass station occupancy; automatic planner capacity guards remain unchanged.
create or replace function public.guard_paint_station_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_name text; occupied integer;
begin
 if coalesce(new.manual_start,false) then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select p->>'name' into phase_name
 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
  jsonb_array_elements(production_manual_phases(j)) p
 where s.company_id=new.company_id and j->>'id'=new.job_id and p->>'id'=new.phase_id;
 if phase_name is distinct from 'Verniciatura' then return new;end if;
 with phases as (
  select j->>'id' as job_id,p,
   (select max(c.checked_at) from production_phase_checks c
    where c.company_id=new.company_id and c.job_id=j->>'id' and c.phase_id=p->>'id') checked_at,
   exists(select 1 from production_live_segments seg
    where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id') has_started
  from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
   jsonb_array_elements(production_manual_phases(j)) p
  where s.company_id=new.company_id and j->>'id'<>new.job_id
   and coalesce(j->>'status','') not in ('Annullata','Consegnata')
   and p->>'name'='Verniciatura'
 ), occupied_phases as (
  select job_id from phases where
   case when exists(select 1 from production_live_sessions ss
    where ss.company_id=new.company_id and ss.job_id=phases.job_id and ss.phase_id=p->>'id' and ss.status in ('running','paused')
    and exists(select 1 from production_live_segments seg where seg.company_id=ss.company_id and seg.job_id=ss.job_id and seg.operator_id=ss.operator_id and seg.phase_id=ss.phase_id and seg.manual_start and seg.started_at>coalesce(checked_at,'-infinity'::timestamptz))) then true
   when exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=phases.job_id and seg.phase_id=p->>'id' and seg.manual_start and seg.ended_at+interval '1 hour'>clock_timestamp()) then true
   when coalesce((p->>'notRequired')::boolean,false) then false
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
create or replace function public.guard_wash_station_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_name text; occupied boolean;
begin
 if coalesce(new.manual_start,false) then return new; end if;
 if new.ended_at is not null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select p->>'name' into phase_name from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(production_manual_phases(j)) p
 where s.company_id=new.company_id and j->>'id'=new.job_id and p->>'id'=new.phase_id;
 if phase_name is null or phase_name not in ('Lavaggio esterno','Lavaggio interni','Lavaggio') then return new;end if;
 select exists(
  select 1 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(production_manual_phases(j)) p
  where s.company_id=new.company_id and coalesce(j->>'status','') not in ('Annullata','Consegnata')
  and p->>'name' in ('Lavaggio esterno','Lavaggio interni','Lavaggio')
  and (
   exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id' and seg.operator_id<>new.operator_id and seg.ended_at is null)
   or (
    (j->>'id'<>new.job_id or p->>'id'<>new.phase_id)
    and (
     (not coalesce((p->>'notRequired')::boolean,false) and p->>'status'<>'Completata'
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
notify pgrst,'reload schema';
commit;
