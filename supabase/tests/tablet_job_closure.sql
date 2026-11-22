\set ON_ERROR_STOP on
\ir ../migrations/20261110074500_finish_timers_on_vehicle_delivery.sql
\ir ../migrations/20261122090000_tablet_job_closure.sql

begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=payload||'{
 "vehicles":[{"id":"cone-car","coneNumber":19},{"id":"waiting-car"}],
 "jobs":[
  {"id":"j1","vehicleId":"cone-car","number":"1","plate":"TEST1","status":"In lavorazione","coneNumber":7,"expectedDeliveryDate":"2000-01-01"},
  {"id":"j2","vehicleId":"waiting-car","number":"2","plate":"TEST2","status":"Chiusa"}
 ],
 "invoices":[{"id":"keep-invoice"}]
}'
where company_id='10000000-0000-0000-0000-000000000001';

do $$
declare
 tenant constant uuid := '10000000-0000-0000-0000-000000000001';
 feed jsonb;
 segment_id bigint;
 ended timestamptz;
 old_history jsonb;
begin
 feed:=production_live_feed(tenant);
 if not exists(select 1 from jsonb_array_elements(feed->'jobs') j
   where j->>'jobId'='j1' and j->>'coneNumber'='19') then raise exception 'Current cone missing or deadline hid active job'; end if;
 if exists(select 1 from jsonb_array_elements(feed->'jobs') j where j->>'jobId'='j2')
  or exists(select 1 from jsonb_array_elements(feed->'program') j where j->>'jobId'='j2') then
  raise exception 'Closed job visible';
 end if;
 if production_job_closure('{"status":"Pronta consegna"}',null,null) is distinct from 'closed'
  or production_job_closure('{"status":"Consegnata"}',null,null) is distinct from 'delivered'
  or production_job_closure('{"status":"Annullata"}',null,null) is distinct from 'cancelled'
  or production_job_closure('{"status":"Completata"}',null,null) is distinct from 'closed'
  or production_job_closure('{}','{"status":"custom-ready"}','{"vehicleStatuses":[{"id":"custom-ready","semantic":"ready"}]}') is distinct from 'closed'
 then raise exception 'Known closure states were not detected'; end if;
 if not production_job_work_completed(tenant,'{"id":"fixture","phases":[{"id":"p","name":"Lattoneria","status":"Completata"},{"id":"d","name":"Consegna","status":"Da fare"}]}')
  or production_job_work_completed(tenant,'{"id":"fixture","phases":[{"id":"p","name":"Lattoneria","status":"In lavorazione","estimatedMinutes":1,"actualMinutes":300}]}')
 then raise exception 'Completion confused with time or pending delivery'; end if;

 select jsonb_agg(to_jsonb(s) order by s.id) into old_history from production_live_segments s where company_id=tenant and ended_at is not null;
 update production_live_sessions set status='running' where company_id=tenant and job_id='j1' and operator_id='a';
 select id into segment_id from production_live_segments
 where company_id=tenant and job_id='j1' and operator_id='a' and ended_at is null;
 if segment_id is null then
  insert into production_live_segments(user_id,company_id,job_id,operator_id,ordinary_schedule,rate,started_at)
  values('00000000-0000-0000-0000-000000000002',tenant,'j1','a','{}',50,clock_timestamp()-interval '10 minutes') returning id into segment_id;
 end if;
 update erp_snapshots set revision=revision+1,payload=jsonb_set(payload,'{jobs,0,status}','"Pronta consegna"') where company_id=tenant;
 select ended_at into ended from production_live_segments where id=segment_id;
 if ended is null or exists (select 1 from production_live_sessions where company_id=tenant and job_id='j1' and status in ('running','paused'))
 then raise exception 'Office closure did not stop timer'; end if;
 update erp_snapshots set revision=revision+1,payload=jsonb_set(payload,'{jobs,0,status}','"Consegnata"') where company_id=tenant;
 if (select ended_at from production_live_segments where id=segment_id) is distinct from ended
  or (select jsonb_agg(to_jsonb(s) order by s.id) from production_live_segments s where company_id=tenant and id<>segment_id and ended_at is not null) is distinct from old_history
  or (select payload->'invoices' from erp_snapshots where company_id=tenant) is distinct from '[{"id":"keep-invoice"}]'::jsonb
 then raise exception 'Closure altered recorded history or accounting'; end if;
 begin
  insert into production_live_segments(user_id,company_id,job_id,operator_id,ordinary_schedule,rate,started_at)
  values('00000000-0000-0000-0000-000000000002',tenant,'j1','a','{}',50,clock_timestamp());
  raise exception 'Stale tablet restarted delivered job';
 exception when raise_exception then
  if sqlerrm<>'La commessa è chiusa o non disponibile.' then raise; end if;
 end;
 feed:=production_live_feed(tenant);
 if exists(select 1 from jsonb_array_elements(feed->'jobs') j where j->>'jobId'='j1')
  or exists(select 1 from jsonb_array_elements(feed->'program') j where j->>'jobId'='j1')
 then raise exception 'Delivered job reappeared after synchronization'; end if;
end $$;
rollback;
