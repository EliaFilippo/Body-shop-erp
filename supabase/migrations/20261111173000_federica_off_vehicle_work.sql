begin;

create or replace function public.production_federica_off_vehicle_work(p_company_id uuid, p_as_of timestamptz)
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  with operators as (
    select distinct op->>'id' as id
    from erp_snapshots snapshot
    cross join lateral jsonb_array_elements(coalesce(snapshot.payload->'plannerSettings'->'operators', '[]')) op
    where snapshot.company_id = p_company_id and lower(btrim(op->>'name')) = 'federica'
  ), bounds as (
    select least(date_trunc('week', local_now), date_trunc('month', local_now))::date first_day,
           local_now::date last_day
    from (select p_as_of at time zone 'Europe/Rome' as local_now) clock
  ), days as (
    select day::date work_day,
           day at time zone 'Europe/Rome' starts_at,
           (day + interval '1 day') at time zone 'Europe/Rome' ends_at
    from bounds
    cross join lateral generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') day
  ), work as (
    select activity.operator_id, days.work_day,
           extract(epoch from (least(coalesce(activity.ended_at, p_as_of), p_as_of, days.ends_at)
             - greatest(activity.started_at, days.starts_at))) as seconds
    from operators
    join production_operator_activities activity on activity.operator_id = operators.id
    join days on activity.started_at < least(days.ends_at, p_as_of)
         and coalesce(activity.ended_at, p_as_of) > days.starts_at
    where activity.company_id = p_company_id and activity.kind = 'cleaning'
    union all
    select adjustment.operator_id, adjustment.work_day, adjustment.delta_seconds
    from operators
    join production_hour_adjustments adjustment on adjustment.operator_id = operators.id
    cross join bounds
    where adjustment.company_id = p_company_id and adjustment.kind in ('cleaning', 'other')
      and adjustment.work_day between bounds.first_day and bounds.last_day
  ), totals as (
    select operator_id, work_day, greatest(0, sum(seconds)) as seconds
    from work
    group by operator_id, work_day
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', work_day, 'operatorId', operator_id, 'seconds', seconds)
                  order by work_day, operator_id), '[]')
  from totals;
$$;

revoke all on function public.production_federica_off_vehicle_work(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.production_planning_state(p_company_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  state jsonb;
begin
  state := production_planning_state_before_manual_progress(p_company_id);
  return state || jsonb_build_object(
    'phaseStates', production_phase_definitions(p_company_id),
    'checks', production_phase_updates(p_company_id),
    'offVehicleWork', production_federica_off_vehicle_work(p_company_id, (state->>'serverNow')::timestamptz)
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
