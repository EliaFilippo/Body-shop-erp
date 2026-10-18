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
update production_live_jobs set initial_budget=120 where job_id='phase-budget-job';
do $$begin if (select (phase_budgets->>'phase-a')::numeric from production_live_jobs where job_id='phase-budget-job')<>40 then raise exception 'Frozen shares changed';end if;end $$;
rollback;
