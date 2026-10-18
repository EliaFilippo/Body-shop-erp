\set ON_ERROR_STOP on
\ir ../migrations/20261018_phase_budgets.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',(payload->'jobs')||'[{
 "id":"phase-budget-job","number":"PHASE","plate":"PHASE","status":"In lavorazione",
 "phases":[{"id":"phase-a","name":"Smontaggio","status":"Da fare","estimatedMinutes":60},{"id":"phase-b","name":"Verniciatura","status":"Da fare","estimatedMinutes":120},{"id":"delivery","name":"Consegna","status":"Da fare","estimatedMinutes":60}]
}]'::jsonb) where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001','phase-budget-job',10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
do $$declare shares jsonb;begin
 select phase_budgets into shares from production_live_jobs where job_id='phase-budget-job';
 if (shares->>'phase-a')::numeric<>40 or (shares->>'phase-b')::numeric<>80 or shares ? 'delivery' then raise exception 'Phase allocation incorrect';end if;
 if (select sum(value::numeric) from jsonb_each_text(shares))<>120 then raise exception 'Budget multiplied';end if;
end $$;
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 values('10000000-0000-0000-0000-000000000001','phase-budget-job','a','00000000-0000-0000-0000-000000000002','A','paused','phase-a');
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
 values('10000000-0000-0000-0000-000000000001','phase-budget-job','a','00000000-0000-0000-0000-000000000002','phase-a',50,now()-interval '1 hour',now()-interval '30 minutes');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare job jsonb;begin
 select j into job from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') j where j->>'jobId'='phase-budget-job';
 if abs((job->'phases'->0->'clock'->>'ownRemainingSeconds')::numeric-1080)>1 then raise exception 'Phase consumption incorrect';end if;
 if abs((job->'phases'->1->'clock'->>'ownRemainingSeconds')::numeric-5760)>1 then raise exception 'Other phase consumed prematurely';end if;
 begin perform production_live_feed('10000000-0000-0000-0000-000000000099');raise exception 'Cross tenant phase clocks';
 exception when raise_exception then if sqlerrm not like 'Accesso aziendale%' then raise;end if;end;
 begin perform production_budget_shares('10000000-0000-0000-0000-000000000001','phase-budget-job',120);raise exception 'Private budget leaked';exception when insufficient_privilege then null;end;
 begin perform production_prepare_job('10000000-0000-0000-0000-000000000001','j2',10,120,'[{"id":"a","name":"A","rate":50}]');raise exception 'Worker published budget';exception when raise_exception then if sqlerrm not like 'Solo il titolare%' then raise;end if;end;
end $$;
reset role;
-- Trigger cannot redistribute an already-started job after a stale office edit.
update erp_snapshots set payload=jsonb_set(payload,'{jobs,2,phases,0,estimatedMinutes}','120') where company_id='10000000-0000-0000-0000-000000000001';
update production_live_jobs set initial_budget=120 where job_id='phase-budget-job';
do $$begin if (select (phase_budgets->>'phase-a')::numeric from production_live_jobs where job_id='phase-budget-job')<>40 then raise exception 'Frozen shares changed';end if;end $$;
-- One S/R allowance spans dismantling and reassembly; parallel operators consume person-minutes.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',(payload->'jobs')||'[{
 "id":"shared-job","number":"SHARED","plate":"SHARED","status":"In lavorazione",
 "phases":[{"id":"s","name":"Smontaggio","status":"Da fare","estimatedMinutes":120,"sharedTimeKey":"sr","sharedTimeMinutes":120},
 {"id":"v","name":"Verniciatura","status":"Da fare","estimatedMinutes":60},
 {"id":"r","name":"Rimontaggio","status":"Da fare","estimatedMinutes":0,"sharedTimeKey":"sr","sharedTimeMinutes":120}]
}]'::jsonb) where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001','shared-job',10,180,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('10000000-0000-0000-0000-000000000001','shared-job','start','s');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('10000000-0000-0000-0000-000000000001','shared-job','start','s');
update production_live_segments set started_at=clock_timestamp()-interval '10 minutes' where job_id='shared-job' and ended_at is null;
set role authenticated;
do $$declare job jsonb; begin
 select j into job from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') j where j->>'jobId'='shared-job';
 if (job->'phases'->0->'standardClock'->>'activeCount')::int<>2 then raise exception 'Second operator missing';end if;
 if abs((job->'phases'->0->'standardClock'->>'ownRemainingSeconds')::numeric-6000)>2 then raise exception 'Parallel work not counted twice';end if;
 if abs((job->'phases'->2->'standardClock'->>'ownRemainingSeconds')::numeric-6000)>2 then raise exception 'Reassembly allowance duplicated';end if;
 if abs((job->'phases'->0->'standardClock'->>'remainingSeconds')::numeric-3000)>2 then raise exception 'Shared team time incorrect';end if;
 if abs((job->'phases'->1->'standardClock'->>'ownRemainingSeconds')::numeric-3600)>2 then raise exception 'Painting consumed prematurely';end if;
 if (job->'phases'->0->'clock'->>'ownRemainingSeconds')::numeric<>(job->'phases'->2->'clock'->>'ownRemainingSeconds')::numeric then raise exception 'Financial allowance not shared';end if;
 if job::text like '%"rate"%' then raise exception 'Rate leaked';end if;
end $$;
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('10000000-0000-0000-0000-000000000001','shared-job','pause');
select production_timer_action('10000000-0000-0000-0000-000000000001','shared-job','finish');
do $$begin
 if not exists(select 1 from production_live_segments where job_id='shared-job' and operator_id='b' and ended_at is null) then raise exception 'Finish stopped colleague';end if;
 begin perform production_complete_phase('10000000-0000-0000-0000-000000000001','shared-job','s');raise exception 'Completed while colleague working';
 exception when raise_exception then if sqlerrm not like 'Un collega sta ancora%' then raise;end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('10000000-0000-0000-0000-000000000001','shared-job','finish');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_complete_phase('10000000-0000-0000-0000-000000000001','shared-job','s');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs,3,phases,0,sharedTimeMinutes}','999') where company_id='10000000-0000-0000-0000-000000000001';
update production_live_jobs set initial_budget=180 where job_id='shared-job';
do $$begin
 if (select (phase_time_limits->'s'->>'minutes')::numeric from production_live_jobs where job_id='shared-job')<>120 then raise exception 'Started allowance rewritten';end if;
 if (select sum(value::numeric) from production_live_jobs,jsonb_each_text(phase_budgets) where job_id='shared-job')<>180 then raise exception 'Shared budget multiplied';end if;
end $$;
rollback;
