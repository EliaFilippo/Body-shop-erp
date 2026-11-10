create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; source jsonb; plan jsonb; closed_jobs text[]; feed_key text;
begin
 result:=production_live_feed_before_completion(p_company_id);
 select payload into source from production_read_snapshots where company_id=p_company_id;
 select coalesce(array_agg(j->>'id'),'{}'::text[]) into closed_jobs
 from jsonb_array_elements(coalesce(source->'jobs','[]')) j
 left join lateral (select v from jsonb_array_elements(coalesce(source->'vehicles','[]')) v
   where v->>'id'=j->>'vehicleId' limit 1) matched on true
 where lower(coalesce(j->>'status','')) in ('consegnata','annullata','delivered','cancelled')
    or lower(coalesce(v->>'status','')) in ('consegnata','annullata','delivered','cancelled')
    or exists (select 1 from jsonb_array_elements(coalesce(source->'plannerSettings'->'vehicleStatuses','[]')) status
      where status->>'id'=v->>'status' and status->>'semantic' in ('delivered','cancelled'));
 foreach feed_key in array array['jobs','program'] loop
  if jsonb_typeof(result->feed_key)='array' then
   result:=jsonb_set(result,array[feed_key],(
    select coalesce(jsonb_agg(item order by ord),'[]')
    from jsonb_array_elements(result->feed_key) with ordinality items(item,ord)
    where not coalesce((item->>'jobId')=any(closed_jobs),false)
   ));
  end if;
 end loop;
 select q.plan into plan from production_completion_queue q where q.company_id=p_company_id
 and q.plan_input_hash=production_completion_input_hash(source)
 and (q.plan->>'generatedAt')::timestamptz>coalesce((source->'nightlyPlanning'->>'generatedAt')::timestamptz,'-infinity');
 return result||jsonb_build_object('deliveryForecasts',coalesce(plan->'forecasts','[]'),'planningUpdatedAt',plan->>'generatedAt');
end $$;
