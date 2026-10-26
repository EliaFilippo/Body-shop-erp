begin;
create or replace function public.guard_wash_station_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_name text; occupied boolean;
begin
 if new.ended_at is not null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select p->>'name' into phase_name from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(coalesce(j->'phases','[]')) p
 where s.company_id=new.company_id and j->>'id'=new.job_id and p->>'id'=new.phase_id;
 if phase_name is null or phase_name not in ('Lavaggio esterno','Lavaggio interni','Lavaggio') then return new;end if;
 select exists(
  select 1 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(coalesce(j->'phases','[]')) p
  where s.company_id=new.company_id and coalesce(j->>'status','') not in ('Annullata','Consegnata')
  and p->>'name' in ('Lavaggio esterno','Lavaggio interni','Lavaggio') and not coalesce((p->>'notRequired')::boolean,false)
  and (
   (exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id' and seg.operator_id<>new.operator_id and seg.ended_at is null))
   or ((j->>'id'<>new.job_id or p->>'id'<>new.phase_id)
    and p->>'status'<>'Completata'
    and not exists(select 1 from production_phase_checks c where c.company_id=new.company_id and c.job_id=j->>'id' and c.phase_id=p->>'id')
    and exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id'))
  )
 ) into occupied;
 if occupied then raise exception 'La sola postazione di lavaggio è occupata. Attendi il completamento del lavaggio o lavora su un’altra fase abilitata.';end if;
 return new;
end $$;
revoke all on function public.guard_wash_station_capacity() from public,anon,authenticated;
drop trigger if exists wash_station_capacity_start on public.production_live_segments;
create trigger wash_station_capacity_start before insert on public.production_live_segments for each row execute function public.guard_wash_station_capacity();
notify pgrst,'reload schema';
commit;
