\set ON_ERROR_STOP on
\ir ../migrations/20261027_remote_timer_stop.sql
\ir ../migrations/20261027_remote_timer_stop.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"session_id":"remote-stop-owner"}',true);
update production_live_segments set ended_at=clock_timestamp() where ended_at is null;
update production_live_sessions set status='paused' where status='running';
update production_operator_activities set ended_at=clock_timestamp() where ended_at is null;
update production_live_sessions set status='running' where job_id='j1' and operator_id='a';
insert into production_live_segments(company_id,job_id,operator_id,user_id,rate,started_at)
values('10000000-0000-0000-0000-000000000001','j1','a','00000000-0000-0000-0000-000000000002',50,clock_timestamp()-interval '1 hour');
insert into production_operator_activities(company_id,operator_id,user_id,operator_name,kind,started_at) values
('10000000-0000-0000-0000-000000000001','b','00000000-0000-0000-0000-000000000003','B','cleaning',clock_timestamp()-interval '20 minutes'),
('10000000-0000-0000-0000-000000000001','coffee-test','00000000-0000-0000-0000-000000000002','Coffee','coffee',clock_timestamp()-interval '10 minutes');
create temp table remote_stop_snapshot as select payload,revision from erp_snapshots;
set role authenticated;
do $$declare r jsonb;keys jsonb;vkey text;begin
 r:=production_open_timers('10000000-0000-0000-0000-000000000001');
 if jsonb_array_length(r->'timers')<>3 or not (r->>'canStop')::boolean then raise exception 'Missing open work/activities';end if;
 select value->>'key' into vkey from jsonb_array_elements(r->'timers') where value->>'kind'='vehicle';
 begin perform production_stop_timers('10000000-0000-0000-0000-000000000001',jsonb_build_array(vkey));raise exception 'Unprotected stop';exception when insufficient_privilege then null;end;
 begin perform production_open_timers('10000000-0000-0000-0000-000000000099');raise exception 'Cross company read';exception when insufficient_privilege then null;end;
 perform production_private_password('10000000-0000-0000-0000-000000000001','set',null,'remote-stop-test-password');
 perform production_private_password('10000000-0000-0000-0000-000000000001','unlock','remote-stop-test-password');
 r:=production_stop_timers('10000000-0000-0000-0000-000000000001',jsonb_build_array(vkey));
 if (r->>'stoppedCount')::int<>1 or jsonb_array_length(r->'report'->'timers')<>2 then raise exception 'Stop touched colleague';end if;
 r:=production_stop_timers('10000000-0000-0000-0000-000000000001',jsonb_build_array(vkey));
 if (r->>'stoppedCount')::int<>0 then raise exception 'Stop not idempotent';end if;
 select jsonb_agg(value->'key') into keys from jsonb_array_elements(r->'report'->'timers');
 r:=production_stop_timers('10000000-0000-0000-0000-000000000001',keys);
 if (r->>'stoppedCount')::int<>2 or jsonb_array_length(r->'report'->'timers')<>0 then raise exception 'Activities not stopped';end if;
end $$;
reset role;
-- A fresh Start after the reviewed list must survive a retry with old IDs.
update production_live_sessions set status='running' where job_id='j1' and operator_id='a';
insert into production_live_segments(company_id,job_id,operator_id,user_id,rate)
values('10000000-0000-0000-0000-000000000001','j1','a','00000000-0000-0000-0000-000000000002',50);
do $$declare oldkey text;r jsonb;begin
 select 'vehicle:'||id::text into oldkey from production_live_segments where job_id='j1' and operator_id='a' and ended_at is not null order by id desc limit 1;
 r:=production_stop_timers('10000000-0000-0000-0000-000000000001',jsonb_build_array(oldkey));
 if (r->>'stoppedCount')::int<>0 or not exists(select 1 from production_live_segments where operator_id='a' and ended_at is null) then raise exception 'Stale stop killed new work';end if;
 if exists(select 1 from erp_snapshots s join remote_stop_snapshot b on true where s.payload is distinct from b.payload or s.revision<>b.revision) then raise exception 'Snapshot/phase mutated';end if;
 if (select count(*) from production_remote_stops)<>2 then raise exception 'Audit missing or duplicate';end if;
 if has_table_privilege('authenticated','production_remote_stops','SELECT') then raise exception 'Audit table exposed';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$begin
 begin perform production_open_timers('10000000-0000-0000-0000-000000000001');raise exception 'Worker sees other timers';exception when insufficient_privilege then null;end;
 begin perform production_stop_timers('10000000-0000-0000-0000-000000000001','["vehicle:1"]');raise exception 'Worker stopped work';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
