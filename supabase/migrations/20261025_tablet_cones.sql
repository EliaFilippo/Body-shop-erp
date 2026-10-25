begin;
-- Expose only the cone of jobs already authorized by the existing production feed.
create or replace function public.production_job_cone(snapshot jsonb,target_job text)
returns integer language plpgsql set search_path=public,pg_temp as $$
declare job jsonb; vehicle jsonb; raw text;
begin
 select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'id'=target_job;
 if job is null then return null;end if;
 select v into vehicle from jsonb_array_elements(coalesce(snapshot->'vehicles','[]')) v where v->>'id'=job->>'vehicleId';
 raw:=case when vehicle is not null then vehicle->>'coneNumber' else job->>'coneNumber' end;
 if raw~'^[0-9]{1,2}$' and raw::integer between 1 and 30 then return raw::integer;end if;
 return null;
end $$;
revoke all on function public.production_job_cone(jsonb,text) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.production_live_feed_before_cones(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_cones;
 end if;
end $$;
revoke all on function public.production_live_feed_before_cones(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; snapshot jsonb; item jsonb; jobs jsonb:='[]'; program jsonb:='[]';
begin
 result:=production_live_feed_before_cones(p_company_id);
 select s.payload into snapshot from erp_snapshots s where s.company_id=p_company_id;
 for item in select value from jsonb_array_elements(coalesce(result->'jobs','[]')) loop
  jobs:=jobs||jsonb_build_array(item||jsonb_build_object('coneNumber',production_job_cone(snapshot,item->>'jobId')));
 end loop;
 for item in select value from jsonb_array_elements(coalesce(result->'program','[]')) loop
  program:=program||jsonb_build_array(item||jsonb_build_object('coneNumber',production_job_cone(snapshot,item->>'jobId')));
 end loop;
 return result||jsonb_build_object('jobs',jobs,'program',program);
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
commit;
