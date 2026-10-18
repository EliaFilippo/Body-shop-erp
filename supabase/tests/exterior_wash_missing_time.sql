\set ON_ERROR_STOP on
-- Isolated test database only. Reconstruct a legacy zero allowance with 10 minutes already worked.
create temporary table wash_snapshot_backup as select company_id,payload from erp_snapshots;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',(payload->'jobs')||'[{
 "id":"wash-legacy","number":"WASH","plate":"WASH","status":"In lavorazione",
 "phases":[{"id":"wash-zero","name":"Lavaggio esterno","status":"Da fare","estimatedMinutes":0},
 {"id":"wash-custom","name":"Lavaggio esterno","status":"Da fare","estimatedMinutes":40},
 {"id":"wash-checked","name":"Lavaggio esterno","status":"Da fare","estimatedMinutes":0}]
}]'::jsonb) where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001','wash-legacy',10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
-- Simulate the original persisted metadata independently of the current preparation function.
update production_live_jobs set phase_time_limits=jsonb_set(jsonb_set(phase_time_limits,'{wash-zero,minutes}','0'),'{wash-checked,minutes}','0') where job_id='wash-legacy';
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 values('10000000-0000-0000-0000-000000000001','wash-legacy','a','00000000-0000-0000-0000-000000000002','A','paused','wash-zero');
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
 values('10000000-0000-0000-0000-000000000001','wash-legacy','a','00000000-0000-0000-0000-000000000002','wash-zero',50,now()-interval '20 minutes',now()-interval '10 minutes');
insert into production_phase_checks(company_id,job_id,phase_id,phase_name,checked_by,operator_id,operator_name,worked_seconds)
 values('10000000-0000-0000-0000-000000000001','wash-legacy','wash-checked','Lavaggio esterno','00000000-0000-0000-0000-000000000002','a','A',1);
create temporary table wash_preserved as select initial_budget,operator_rates,phase_budgets,
 (select jsonb_agg(to_jsonb(s) order by id) from production_live_segments s where job_id='wash-legacy') segments,
 (select jsonb_agg(to_jsonb(s) order by operator_id) from production_live_sessions s where job_id='wash-legacy') sessions
 from production_live_jobs where job_id='wash-legacy';
\ir ../migrations/20261018_exterior_wash_missing_time.sql
\ir ../migrations/20261018_exterior_wash_missing_time.sql
-- Repetition does not reset work or overwrite custom/completed allowances.
do $$declare before_record record; after_record record;begin
 select * into before_record from wash_preserved;
 select initial_budget,operator_rates,phase_budgets,
 (select jsonb_agg(to_jsonb(s) order by id) from production_live_segments s where job_id='wash-legacy') segments,
 (select jsonb_agg(to_jsonb(s) order by operator_id) from production_live_sessions s where job_id='wash-legacy') sessions into after_record
 from production_live_jobs where job_id='wash-legacy';
 if to_jsonb(before_record) is distinct from to_jsonb(after_record) then raise exception 'Historical work or finances changed';end if;
 if (select (phase_time_limits->'wash-zero'->>'minutes')::numeric from production_live_jobs where job_id='wash-legacy')<>25 then raise exception 'Missing wash standard not repaired';end if;
 if (select (phase_time_limits->'wash-custom'->>'minutes')::numeric from production_live_jobs where job_id='wash-legacy')<>40 then raise exception 'Explicit custom duration overwritten';end if;
 if (select (phase_time_limits->'wash-checked'->>'minutes')::numeric from production_live_jobs where job_id='wash-legacy')<>0 then raise exception 'Completed duration overwritten';end if;
 if (select (production_time_limits('10000000-0000-0000-0000-000000000001','wash-legacy')->'wash-zero'->>'minutes')::numeric)<>25 then raise exception 'New preparation still saves zero';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare job jsonb;begin
 select j into job from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') j where j->>'jobId'='wash-legacy';
 if job->>'ownStatus'<>'paused' then raise exception 'Pause lost';end if;
 if abs((job->'phases'->0->'standardClock'->>'ownRemainingSeconds')::numeric-900)>1 then raise exception 'Worked time was reset';end if;
end $$;
reset role;
-- Restore baseline fixtures for the subsequent concurrency check.
update erp_snapshots s set payload=b.payload from wash_snapshot_backup b where b.company_id=s.company_id;
delete from production_phase_checks where job_id='wash-legacy';
delete from production_live_segments where job_id='wash-legacy';
delete from production_live_sessions where job_id='wash-legacy';
delete from production_live_jobs where job_id='wash-legacy';
