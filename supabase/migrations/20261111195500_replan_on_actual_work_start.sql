begin;

-- Keep the saved entry date in the archive. Supply actual arrival to the live simulation.
create or replace function public.production_completion_actual_entry(p_claim jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with starts as (
    select entry->>'jobId' as job_id,
           (min((entry->>'firstStartedAt')::timestamptz) at time zone 'Europe/Rome')::date as work_date
    from jsonb_array_elements(p_claim->'state'->'entries') entry
    where entry->>'firstStartedAt' is not null
    group by entry->>'jobId'
  ), jobs as (
    select coalesce(jsonb_agg(
      case when starts.work_date is not null and item.job->>'status' not in ('Consegnata', 'Annullata')
        then jsonb_set(item.job, '{entryDate}', to_jsonb(starts.work_date))
        else item.job end order by item.ordinal), '[]') as value
    from jsonb_array_elements(p_claim->'payload'->'jobs') with ordinality item(job, ordinal)
    left join starts on starts.job_id = item.job->>'id'
  )
  select case when p_claim is null then null else jsonb_set(p_claim, '{payload,jobs}', jobs.value) end
  from jobs;
$$;
revoke all on function public.production_completion_actual_entry(jsonb) from public, anon, authenticated, service_role;

create or replace function public.production_completion_claim(p_company_id uuid, p_secret text, p_expires bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  secret text;
  stamp bigint := extract(epoch from clock_timestamp())::bigint;
begin
  if p_expires is null or p_expires < stamp or p_expires > stamp + 180 then return null; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'production_completion_worker' limit 1;
  if secret is null or p_secret is distinct from encode(extensions.hmac(p_company_id::text || ':' || p_expires::text, secret, 'sha256'), 'hex') then
    return null;
  end if;
  return public.production_completion_actual_entry(public.production_completion_claim_before_signed_dispatch(p_company_id, secret));
end;
$$;

create or replace function public.production_completion_start_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- A resumed timer and a second worker on the same phase do not start a new phase.
  if not exists (
    select 1 from public.production_live_segments segment
    where segment.company_id = new.company_id and segment.job_id = new.job_id
      and segment.phase_id = new.phase_id and segment.id <> new.id
  ) then
    perform public.production_completion_enqueue(new.company_id);
  end if;
  return new;
end;
$$;
revoke all on function public.production_completion_start_trigger() from public, anon, authenticated, service_role;

create trigger production_completion_replan_on_start
  after insert on public.production_live_segments
  for each row when (new.phase_id is not null and new.ended_at is null)
  execute function public.production_completion_start_trigger();

notify pgrst, 'reload schema';
commit;
