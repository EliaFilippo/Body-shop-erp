begin;

-- Work closure is explicit. Planned deadlines never enter this decision.
create or replace function public.production_job_closure(job jsonb, vehicle jsonb, settings jsonb)
returns text language sql stable set search_path = '' as $$
 with states as (
  select lower(btrim(coalesce(job->>'status',''))) as job_state,
         lower(btrim(coalesce(vehicle->>'status',''))) as vehicle_state,
         (select s->>'semantic' from jsonb_array_elements(coalesce(settings->'vehicleStatuses','[]')) s
          where s->>'id'=vehicle->>'status' limit 1) as semantic
 )
 select case
  when job_state in ('annullata','annullato','cancelled','canceled')
    or vehicle_state in ('annullata','annullato','cancelled','canceled') or semantic='cancelled' then 'cancelled'
  when job_state in ('consegnata','consegnato','delivered')
    or vehicle_state in ('consegnata','consegnato','delivered') or semantic='delivered' then 'delivered'
  when job_state in ('pronta','pronta consegna','pronta per consegna','completata','completato','completed','chiusa','chiuso','closed','ready')
    or vehicle_state in ('pronta','pronta consegna','pronta per consegna','completata','completato','completed','chiusa','chiuso','closed','ready')
    or semantic='ready' then 'closed'
 end from states
$$;
revoke all on function public.production_job_closure(jsonb,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.production_job_work_completed(p_company_id uuid, job jsonb)
returns boolean language sql stable set search_path = '' as $$
 select coalesce(bool_and(phase->>'status' = 'Completata'),false)
 from jsonb_array_elements(public.production_effective_phases(p_company_id,job)) phase
 where phase->>'name' is distinct from 'Consegna'
   and not coalesce((phase->>'notRequired')::boolean,false)
$$;
revoke all on function public.production_job_work_completed(uuid,jsonb) from public,anon,authenticated;

create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; source jsonb; plan jsonb; allowed_jobs jsonb; feed_key text;
begin
 -- Reuse the authorized feed, then apply the same allowlist to every vehicle list.
 result:=production_live_feed_before_completion(p_company_id);
 select payload into source from production_read_snapshots where company_id=p_company_id;
 select coalesce(jsonb_object_agg(j->>'id',to_jsonb(production_job_cone(source,j->>'id'))),'{}')
 into allowed_jobs
 from jsonb_array_elements(coalesce(source->'jobs','[]')) j
 join jsonb_array_elements(coalesce(source->'vehicles','[]')) v on v->>'id'=j->>'vehicleId'
 where j->>'id' is not null and production_job_closure(j,v,source->'plannerSettings') is null
   and not production_job_work_completed(p_company_id,j);

 foreach feed_key in array array['jobs','program'] loop
  if jsonb_typeof(result->feed_key)='array' then
   result:=jsonb_set(result,array[feed_key],(
    select coalesce(jsonb_agg(item || jsonb_build_object('coneNumber',allowed_jobs->(item->>'jobId')) order by ord),'[]')
    from jsonb_array_elements(result->feed_key) with ordinality items(item,ord)
    where allowed_jobs ? (item->>'jobId')
   ));
  end if;
 end loop;
 select q.plan into plan from production_completion_queue q where q.company_id=p_company_id
 and q.plan_input_hash=production_completion_input_hash(source)
 and (q.plan->>'generatedAt')::timestamptz>coalesce((source->'nightlyPlanning'->>'generatedAt')::timestamptz,'-infinity');
 return result||jsonb_build_object('deliveryForecasts',(
  select coalesce(jsonb_agg(item order by ord),'[]')
  from jsonb_array_elements(coalesce(plan->'forecasts','[]')) with ordinality items(item,ord)
  where allowed_jobs ? (item->>'jobId')
 ),'planningUpdatedAt',plan->>'generatedAt');
end $$;

-- Reuse the existing snapshot write hook and retain all closed segments.
create or replace function public.production_finish_delivered_timers(p_company_id uuid,p_payload jsonb,p_fallback timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare closure record;
begin
 if not exists(select 1 from production_live_sessions where company_id=p_company_id and status in ('running','paused'))
    and not exists(select 1 from production_live_segments where company_id=p_company_id and ended_at is null) then return; end if;
 for closure in
  select j->>'id' job_id,
   case when state.kind='delivered' and pg_input_is_valid(j->>'deliveredAt','timestamp with time zone') then (j->>'deliveredAt')::timestamptz
        when state.kind='delivered' and pg_input_is_valid(v->>'deliveredAt','timestamp with time zone') then (v->>'deliveredAt')::timestamptz
        else p_fallback end as closed_at
  from jsonb_array_elements(coalesce(p_payload->'jobs','[]')) j
  left join lateral (select vehicle v from jsonb_array_elements(coalesce(p_payload->'vehicles','[]')) vehicle
    where vehicle->>'id'=j->>'vehicleId' limit 1) matched on true
  cross join lateral (select production_job_closure(j,v,p_payload->'plannerSettings') kind) state
  where state.kind is not null
    and (exists(select 1 from production_live_sessions l where l.company_id=p_company_id and l.job_id=j->>'id' and l.status in ('running','paused'))
      or exists(select 1 from production_live_segments s where s.company_id=p_company_id and s.job_id=j->>'id' and s.ended_at is null))
 loop
  update production_live_segments s set ended_at=greatest(s.started_at,least(closure.closed_at,p_fallback))
  where s.company_id=p_company_id and s.job_id=closure.job_id and s.ended_at is null;
  update production_live_sessions l set status='finished'
  where l.company_id=p_company_id and l.job_id=closure.job_id and l.status in ('running','paused');
 end loop;
end $$;

-- Reject start/resume from a tablet that has not received the latest feed.
create or replace function public.production_guard_closed_job_timer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare snapshot jsonb; job jsonb; vehicle jsonb;
begin
 if new.ended_at is not null then return new; end if;
 select payload into snapshot from public.erp_snapshots where company_id=new.company_id;
 select item into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) item where item->>'id'=new.job_id;
 select item into vehicle from jsonb_array_elements(coalesce(snapshot->'vehicles','[]')) item where item->>'id'=job->>'vehicleId';
 if public.production_job_closure(job,vehicle,snapshot->'plannerSettings') is not null
   or (job is not null and public.production_job_work_completed(new.company_id,job)) then
  raise exception 'La commessa è chiusa o non disponibile.';
 end if;
 return new;
end $$;
revoke all on function public.production_guard_closed_job_timer() from public,anon,authenticated;
drop trigger if exists production_guard_closed_job_timer on public.production_live_segments;
create trigger production_guard_closed_job_timer before insert on public.production_live_segments
 for each row execute function public.production_guard_closed_job_timer();

-- Serialize an office save with concurrent tablet starts for the same company.
create or replace function public.erp_update_snapshot_sections(
 p_company_id uuid,p_expected_revision bigint,p_changes jsonb,p_remove_keys text[] default '{}'
) returns table(company_id uuid,revision bigint,updated_at timestamptz)
language plpgsql security invoker set search_path=public,pg_temp set statement_timeout = '45s' as $$
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ai dati cloud negato.' using errcode='42501';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'Salvataggio cloud non valido.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 return query update public.erp_snapshots s
 set payload=(s.payload-coalesce(p_remove_keys,'{}'::text[]))||p_changes,
 revision=s.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
 where s.company_id=p_company_id and s.revision=p_expected_revision
 returning s.company_id,s.revision,s.updated_at;
end $$;
revoke all on function public.erp_update_snapshot_sections(uuid,bigint,jsonb,text[]) from public,anon;
grant execute on function public.erp_update_snapshot_sections(uuid,bigint,jsonb,text[]) to authenticated;

notify pgrst,'reload schema';
commit;
