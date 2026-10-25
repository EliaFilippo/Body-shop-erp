\set ON_ERROR_STOP on
\ir ../migrations/20261025_tablet_cones.sql
\ir ../migrations/20261025_tablet_cones.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(jsonb_set(payload,'{vehicles}','[{"id":"cone-car","coneNumber":19}]'),
 '{jobs}',(select jsonb_agg(case when j->>'id'='j1' then j||'{"vehicleId":"cone-car","coneNumber":7}' else j end)
 from jsonb_array_elements(payload->'jobs') j))
 where company_id='10000000-0000-0000-0000-000000000001';
do $$declare feed jsonb; cone integer;begin
 feed:=production_live_feed('10000000-0000-0000-0000-000000000001');
 select (j->>'coneNumber')::integer into cone from jsonb_array_elements(feed->'jobs') j where j->>'jobId'='j1';
 if cone is distinct from 19 then raise exception 'Live feed did not use current vehicle cone: %',feed;end if;
 if has_function_privilege('authenticated','public.production_live_feed_before_cones(uuid)','execute')
 or has_function_privilege('authenticated','public.production_job_cone(jsonb,text)','execute') then raise exception 'Internal snapshot helpers exposed';end if;
 if production_job_cone('{"jobs":[{"id":"a","coneNumber":7}]}','a')<>7 then raise exception 'Orphan fallback lost';end if;
 if production_job_cone('{"jobs":[{"id":"a","coneNumber":70}]}','a') is not null then raise exception 'Invalid cone exposed';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
do $$begin
 begin perform production_live_feed('10000000-0000-0000-0000-000000000001');raise exception 'Unauthorized company access';exception when raise_exception then if sqlerrm='Unauthorized company access' then raise;end if;end;
end $$;
rollback;
