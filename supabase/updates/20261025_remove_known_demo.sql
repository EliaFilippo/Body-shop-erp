begin;
-- One-off removal of the explicitly identified demo. Run in the Supabase SQL editor.
-- A private recovery copy is kept; no operator, PIN, tariff or catalogue is reset.
create table if not exists public.demo_cleanup_backups (
 company_id uuid not null, cleanup_key text not null, created_at timestamptz not null default now(),
 snapshot jsonb not null, live_records jsonb not null, primary key(company_id,cleanup_key)
);
alter table public.demo_cleanup_backups enable row level security;
revoke all on public.demo_cleanup_backups from public,anon,authenticated;

create or replace function public.demo_cleanup_filter(node jsonb, ids text[])
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare result jsonb; item jsonb; filtered jsonb; k text; v jsonb;
begin
 if jsonb_typeof(node)='object' then
  if exists(select 1 from jsonb_each(node) e where e.key=any(array['id','jobId','vehicleId','estimateId','acceptanceId','documentId','quoteId','convertedJobId'])
     and e.value #>> '{}' = any(ids)) then return null; end if;
  result:='{}';
  for k,v in select * from jsonb_each(node) loop
   -- Program totals are recalculated by the planner after reload.
   if k='summary' and node ? 'tasks' then continue;end if;
   filtered:=public.demo_cleanup_filter(v,ids);
   if filtered is not null then result:=result||jsonb_build_object(k,filtered);end if;
  end loop;
  return result;
 elsif jsonb_typeof(node)='array' then
  result:='[]';
  for item in select value from jsonb_array_elements(node) loop
   filtered:=public.demo_cleanup_filter(item,ids);
   if filtered is not null then result:=result||jsonb_build_array(filtered);end if;
  end loop;
  return result;
 end if;
 return node;
end $$;
revoke all on function public.demo_cleanup_filter(jsonb,text[]) from public,anon,authenticated;

create or replace function public.remove_elias_known_demo()
returns text language plpgsql set search_path=public,pg_temp as $$
declare
 target uuid:='aa49d334-492f-4daa-aa7e-5d5c022308b7';
 snapshot jsonb; job jsonb; job_id_value text; vehicle_id text; estimate_id text;
 guard record; disabled_guards jsonb:='[]';
 ids text[]; quote_ids text[]; backups jsonb:='{}'; rows jsonb; tab text; changed jsonb;
begin
 -- Same lock as Start/Pause/Finish, so cleanup cannot race a tablet write.
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 select s.payload into snapshot from erp_snapshots s where s.company_id=target for update;
 if snapshot is null then return 'Nessun dato aziendale trovato: nessuna cancellazione.';end if;
 if (select count(*) from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j
     where j->>'number'='COMM-00001' and j->>'plate'='HFIEJI')>1 then
  raise exception 'Prova duplicata: nessun dato cancellato';
 end if;
 select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j
  where j->>'number'='COMM-00001' and j->>'plate'='HFIEJI';
 if job is null then return 'Prova COMM-00001 / HFIEJI assente o gia rimossa.';end if;
 job_id_value:=nullif(job->>'id',''); vehicle_id:=nullif(job->>'vehicleId',''); estimate_id:=nullif(job->>'estimateId','');
 if job_id_value is null then raise exception 'ID della prova mancante';end if;
 -- Refuse to touch a vehicle or estimate shared with another repair.
 if exists(select 1 from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j
  where j->>'id'<>job_id_value and
   ((vehicle_id is not null and j->>'vehicleId'=vehicle_id) or (estimate_id is not null and j->>'estimateId'=estimate_id))) then
  raise exception 'Vettura o preventivo condiviso con altre commesse: verifica necessaria';
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(snapshot->'vehicles','[]')) v
  where v->>'id'=vehicle_id and upper(v->>'plate')<>'HFIEJI') then
  raise exception 'La vettura collegata ha una targa diversa: pulizia interrotta';
 end if;
 select array_agg(distinct value) into ids from (
  select job_id_value as value union all select vehicle_id union all select estimate_id
  union all select e->>'id' from jsonb_array_elements(coalesce(snapshot->'estimates','[]')) e where e->>'convertedJobId'=job_id_value
  union all select a->>'id' from jsonb_array_elements(coalesce(snapshot->'acceptances','[]')) a where vehicle_id is not null and a->>'vehicleId'=vehicle_id
 ) x where value is not null and value<>'';
 -- Quotes may carry only the old vehicle or estimate reference.
 select coalesce(array_agg(q->>'id'),array[]::text[]) into quote_ids
 from jsonb_array_elements(coalesce(snapshot->'quotes','[]')) q
 where q->>'vehicleId'=vehicle_id or q->>'estimateId'=any(ids) or q->>'acceptanceId'=any(ids);
 ids:=ids||quote_ids;
 if nullif(job->>'invoiceId','') is not null
  or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'vehicles','[]')) v where v->>'id'=vehicle_id and nullif(v->>'invoiceId','') is not null)
  or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'quotes','[]')) q where q->>'id'=any(ids) and nullif(q->>'invoiceId','') is not null)
  or exists(select 1 from jsonb_array_elements(coalesce(snapshot->'invoices','[]')) i
   where i->>'vehicleId'=any(ids) or i->>'quoteId'=any(ids) or i->>'acceptanceId'=any(ids)
    or exists(select 1 from jsonb_array_elements(coalesce(i->'lines','[]')) l where l->>'vehicleId'=any(ids))) then
  raise exception 'La prova ha fatture collegate: documenti contabili conservati, nessuna cancellazione';
 end if;
 if exists(select 1 from jsonb_array_elements(coalesce(snapshot->'estimates','[]')) e
   where e->>'vehicleId'=vehicle_id and not(e->>'id'=any(ids))) then
  raise exception 'La vettura ha altri preventivi: pulizia interrotta';
 end if;
 foreach tab in array array['production_live_segments','production_live_sessions','production_phase_checks',
   'production_phase_notices','production_time_assignments','production_overrun_alerts','production_live_jobs'] loop
  if to_regclass('public.'||tab) is not null then
   execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t where company_id=$1 and job_id=$2',tab)
    into rows using target,job_id_value;
   backups:=backups||jsonb_build_object(tab,rows);
  end if;
 end loop;
 insert into demo_cleanup_backups(company_id,cleanup_key,snapshot,live_records)
 values(target,'COMM-00001-HFIEJI-20261025',snapshot,backups)
 on conflict(company_id,cleanup_key) do nothing;
 -- Never expose backups or this maintenance operation as a browser RPC.
 foreach tab in array array['production_live_segments','production_phase_checks','production_phase_notices',
   'production_time_assignments','production_overrun_alerts','production_live_sessions','production_live_jobs'] loop
  if to_regclass('public.'||tab) is not null then
   execute format('delete from public.%I where company_id=$1 and job_id=$2',tab) using target,job_id_value;
  end if;
 end loop;
 changed:=public.demo_cleanup_filter(snapshot,ids);
 if changed is null then raise exception 'Snapshot non valido: operazione annullata';end if;
 -- This SQL-console-only maintenance has its own exact target, invoice guards and backup.
 -- Disable only the two confirmed-document editing guards inside this transaction.
 -- ALTER TABLE holds the table lock until commit; other sessions cannot bypass them.
 for guard in select tgname,tgenabled from pg_trigger
  where tgrelid='public.erp_snapshots'::regclass
   and tgname in ('protect_confirmed_estimates','require_password_for_confirmed_estimates')
   and tgenabled<>'D' loop
  disabled_guards:=disabled_guards||jsonb_build_array(jsonb_build_object('name',guard.tgname,'mode',guard.tgenabled));
  execute format('alter table public.erp_snapshots disable trigger %I',guard.tgname);
 end loop;
 update erp_snapshots set payload=changed,revision=revision+1,updated_at=clock_timestamp() where company_id=target;
 for guard in select value->>'name' as name,value->>'mode' as mode from jsonb_array_elements(disabled_guards) loop
  execute format('alter table public.erp_snapshots enable %s trigger %I',
   case guard.mode when 'A' then 'always' when 'R' then 'replica' else '' end,guard.name);
 end loop;
 return 'Prova COMM-00001 / HFIEJI rimossa con tempi, timer e assegnazioni. Copia di recupero privata salvata.';
end $$;
revoke all on function public.remove_elias_known_demo() from public,anon,authenticated;
select public.remove_elias_known_demo() as esito_pulizia;
commit;
