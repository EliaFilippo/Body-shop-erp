begin;

create or replace function public.production_finish_delivered_timers(p_company_id uuid,p_payload jsonb,p_fallback timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare delivery record;
begin
 if not exists(select 1 from production_live_sessions where company_id=p_company_id and status in ('running','paused'))
    and not exists(select 1 from production_live_segments where company_id=p_company_id and ended_at is null) then return; end if;
 for delivery in
  select j->>'id' job_id,
   case when pg_input_is_valid(j->>'deliveredAt','timestamp with time zone') then (j->>'deliveredAt')::timestamptz
        when pg_input_is_valid(v->>'deliveredAt','timestamp with time zone') then (v->>'deliveredAt')::timestamptz
        else p_fallback end delivered_at
  from jsonb_array_elements(coalesce(p_payload->'jobs','[]')) j
  left join lateral (select vehicle v from jsonb_array_elements(coalesce(p_payload->'vehicles','[]')) vehicle
    where vehicle->>'id'=j->>'vehicleId' limit 1) matched on true
  where (lower(coalesce(j->>'status','')) in ('consegnata','delivered')
      or lower(coalesce(v->>'status','')) in ('consegnata','delivered')
      or exists(select 1 from jsonb_array_elements(coalesce(p_payload->'plannerSettings'->'vehicleStatuses','[]')) status
         where status->>'id'=v->>'status' and status->>'semantic'='delivered'))
    and (exists(select 1 from production_live_sessions l where l.company_id=p_company_id and l.job_id=j->>'id' and l.status in ('running','paused'))
      or exists(select 1 from production_live_segments s where s.company_id=p_company_id and s.job_id=j->>'id' and s.ended_at is null))
 loop
  update production_live_segments s set ended_at=greatest(s.started_at,least(delivery.delivered_at,p_fallback))
  where s.company_id=p_company_id and s.job_id=delivery.job_id and s.ended_at is null;
  update production_live_sessions l set status='finished'
  where l.company_id=p_company_id and l.job_id=delivery.job_id and l.status in ('running','paused');
 end loop;
end $$;
revoke all on function public.production_finish_delivered_timers(uuid,jsonb,timestamptz) from public,anon,authenticated;

create or replace function public.production_finish_timers_after_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform production_finish_delivered_timers(new.company_id,new.payload,clock_timestamp());
 return new;
end $$;
revoke all on function public.production_finish_timers_after_delivery() from public,anon,authenticated;
create trigger production_finish_timers_after_delivery after insert or update of payload on public.erp_snapshots
 for each row execute function public.production_finish_timers_after_delivery();

commit;
