begin;

-- A signed phase also counts when no operator started a timer.
do $migration$
declare
  definition text := pg_get_functiondef('public.production_effective_phases(uuid,jsonb)'::regprocedure);
  status_anchor text := $sql$c.checked_at is not null and c.checked_at>=w.last_start$sql$;
  output_anchor text := $sql$case when last_start is null then ph else$sql$;
begin
  if position(status_anchor in definition) = 0 or position(output_anchor in definition) = 0 then
    raise exception 'Production phase signature changed';
  end if;
  definition := replace(definition, status_anchor,
    $sql$c.checked_at is not null and (w.last_start is null or c.checked_at>=w.last_start)$sql$);
  execute replace(definition, output_anchor, $sql$case when last_start is null then
    ph || case when checked_at is not null then jsonb_build_object(
      'status','Completata','completedAt',checked_at,'endedAt',checked_at,
      'completedByName',signer,'tabletWorkedSeconds',worked_seconds,'remainingTimeUnknown',false)
    else '{}'::jsonb end
  else$sql$);
end $migration$;

create or replace function public.production_office_complete_phase(p_company_id uuid, p_job_id text, p_phase_id text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  snapshot jsonb;
  job jsonb;
  vehicle jsonb;
  phases jsonb;
  phase jsonb;
  phase_order bigint;
  signer text;
  stamp timestamptz;
  last_start timestamptz;
  worked numeric;
  previous public.production_phase_checks%rowtype;
begin
  if not public.is_office_company_member(p_company_id) then
    raise exception 'Accesso ufficio richiesto.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  select payload into snapshot from public.erp_snapshots where company_id = p_company_id;
  select item into job from jsonb_array_elements(snapshot->'jobs') item where item->>'id' = p_job_id;
  select item into vehicle from jsonb_array_elements(snapshot->'vehicles') item where item->>'id' = job->>'vehicleId';
  if job is null or job->>'status' in ('Consegnata','Annullata')
    or lower(coalesce(vehicle->>'status','')) in ('consegnata','annullata','delivered','cancelled')
    or exists (select 1 from jsonb_array_elements(snapshot->'plannerSettings'->'vehicleStatuses') item
      where item->>'id' = vehicle->>'status' and item->>'semantic' in ('delivered','cancelled'))
  then raise exception 'La commessa è chiusa o non disponibile.'; end if;

  phases := public.production_effective_phases(p_company_id, job);
  select item, ordinal into phase, phase_order
  from jsonb_array_elements(phases) with ordinality entries(item, ordinal)
  where item->>'id' = p_phase_id;
  if phase is null or phase->>'name' = 'Consegna' or coalesce((phase->>'notRequired')::boolean,false) then
    raise exception 'Questa fase non è completabile.';
  end if;

  select max(started_at) into last_start from public.production_live_segments
  where company_id = p_company_id and job_id = p_job_id and phase_id = p_phase_id;
  select * into previous from public.production_phase_checks
  where company_id = p_company_id and job_id = p_job_id and phase_id = p_phase_id;
  if previous.checked_at is not null and (last_start is null or previous.checked_at >= last_start) then return; end if;
  if phase->>'status' = 'Completata' then return; end if;
  if phase->>'status' = 'Bloccata' or exists (select 1 from jsonb_array_elements(job->'phases') item
      where item->>'id' = p_phase_id and item->>'status' = 'Bloccata') then
    raise exception 'Risolvi il blocco della fase prima di completarla.';
  end if;
  if phase->>'name' = 'Controllo qualità' and exists (
    select 1 from jsonb_array_elements(phases) with ordinality entries(item, ordinal)
    where ordinal < phase_order and not coalesce((item->>'notRequired')::boolean,false)
      and item->>'status' is distinct from 'Completata'
  ) then raise exception 'Completa le fasi precedenti prima del Controllo qualità.'; end if;
  if not exists (select 1 from public.production_live_jobs where company_id = p_company_id and job_id = p_job_id) then
    raise exception 'La commessa è in attesa di pubblicazione in Produzione. Riprova tra poco.';
  end if;

  select coalesce(nullif(trim(display_name),''),'Operatore') into signer from public.company_members
  where company_id = p_company_id and user_id = auth.uid();
  stamp := greatest(clock_timestamp(), last_start);

  update public.production_live_segments set ended_at = stamp
  where company_id = p_company_id and job_id = p_job_id and phase_id = p_phase_id and ended_at is null;
  update public.production_live_sessions set status = 'finished'
  where company_id = p_company_id and job_id = p_job_id and phase_id = p_phase_id and status in ('running','paused');
  select coalesce(sum(extract(epoch from (ended_at-started_at))),0) into worked
  from public.production_live_segments where company_id = p_company_id and job_id = p_job_id and phase_id = p_phase_id;

  if previous.checked_at is not null then
    insert into public.production_phase_check_history(company_id,job_id,phase_id,previous_check,reopened_by)
    values(p_company_id,p_job_id,p_phase_id,to_jsonb(previous),auth.uid());
  end if;
  insert into public.production_phase_checks(company_id,job_id,phase_id,phase_name,checked_by,operator_id,operator_name,checked_at,worked_seconds)
  values(p_company_id,p_job_id,p_phase_id,phase->>'name',auth.uid(),'office:'||auth.uid()::text,'Ufficio · '||signer,stamp,worked)
  on conflict (company_id,job_id,phase_id) do update set phase_name=excluded.phase_name,
    checked_by=excluded.checked_by,operator_id=excluded.operator_id,operator_name=excluded.operator_name,
    checked_at=excluded.checked_at,worked_seconds=excluded.worked_seconds;
end;
$$;

revoke all on function public.production_office_complete_phase(uuid,text,text) from public, anon;
grant execute on function public.production_office_complete_phase(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
