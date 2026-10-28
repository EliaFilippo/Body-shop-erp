begin;
-- Tablet polling must not decompress the complete planning audit on every read.
-- The authoritative snapshot and its history remain unchanged.
create table if not exists public.production_read_snapshots(
 company_id uuid primary key references public.erp_snapshots(company_id) on delete cascade,
 revision bigint not null,payload jsonb not null
);
alter table public.production_read_snapshots enable row level security;
revoke all on public.production_read_snapshots from public,anon,authenticated,service_role;
create or replace function public.refresh_production_read_snapshot()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.production_read_snapshots(company_id,revision,payload)
 values(new.company_id,new.revision,new.payload-'operatorProgramHistory')
 on conflict(company_id) do update set revision=excluded.revision,payload=excluded.payload;
 return new;
end $$;
revoke all on function public.refresh_production_read_snapshot() from public,anon,authenticated,service_role;
drop trigger if exists refresh_production_read_snapshot on public.erp_snapshots;
create trigger refresh_production_read_snapshot after insert or update of payload,revision on public.erp_snapshots
 for each row execute function public.refresh_production_read_snapshot();
insert into public.production_read_snapshots(company_id,revision,payload)
 select company_id,revision,payload-'operatorProgramHistory' from public.erp_snapshots
 on conflict(company_id) do update set revision=excluded.revision,payload=excluded.payload;
-- Keep all existing membership checks, clock calculations, signatures and locks.
-- Only these read routines use the synchronous projection. Writes and nightly
-- claims continue to lock and validate the full authoritative snapshot.
do $$declare signature text;definition text;begin
 foreach signature in array array[
 'production_live_feed_before_phase_budgets(uuid)',
 'production_live_feed_before_cones(uuid)',
 'production_live_feed_before_activities(uuid)',
 'production_live_feed(uuid)',
 'production_job_details(uuid,text)',
 'production_time_facts(uuid)',
 'production_hours_report_before_password(uuid,text,date,date)'
 ] loop
  if to_regprocedure('public.'||signature) is null then raise exception 'Missing prerequisite: %',signature;end if;
  definition:=pg_get_functiondef(to_regprocedure('public.'||signature));
  definition:=replace(definition,'erp_snapshots','production_read_snapshots');
  execute definition;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
