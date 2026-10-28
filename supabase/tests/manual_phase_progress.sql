\set ON_ERROR_STOP on
\ir ../migrations/20261028083902_manual_phase_progress.sql
\ir ../migrations/20261028083902_manual_phase_progress.sql
begin;
insert into companies(id,name) values('90000000-0000-0000-0000-000000000009','Manual/automatic progress fixture');
insert into company_members(company_id,user_id,display_name,role) values
('90000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','Owner','owner'),
('90000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','A','production'),
('90000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000003','B','production');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('90000000-0000-0000-0000-000000000009',10,
'{"estimates":[{"id":"quote","status":"Approvato","total":122}],"plannerSettings":{"operators":[{"id":"a","name":"A","active":true,"skillsConfigured":true,"skills":["Lavaggio esterno"]},{"id":"b","name":"B","active":true,"skillsConfigured":true,"skills":["Lucidatura","Lattoneria","Lavaggio esterno"]}]},"jobs":[
{"id":"progress","plate":"PROGRESS","number":"COMM-P","status":"Pianificata","workflowCycle":"elias-v1","phases":[{"id":"body","name":"Lattoneria","estimatedMinutes":60,"status":"Da fare","cycleOrder":4},{"id":"wash","name":"Lavaggio esterno","estimatedMinutes":0,"status":"Completata","notRequired":true,"cycleOrder":5},{"id":"polish","name":"Lucidatura","estimatedMinutes":30,"status":"Da fare","cycleOrder":11}]},
{"id":"legacy-extra","plate":"LEGACY","number":"COMM-E","status":"Pianificata","phases":[]}],
"operatorPrograms":[{"operatorId":"b","date":"2026-10-28","tasks":[{"id":"task","jobId":"progress","plate":"PROGRESS","phaseId":"body","phaseName":"Lattoneria","startAt":"2026-10-28T08:00:00Z","endAt":"2026-10-28T09:00:00Z","operatorId":"b","plannedMinutes":60}]}]}',
'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('90000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','a');
select production_bind_profile('90000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000003','b');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '90000000-0000-0000-0000-000000000009',id,id,id,120,'[{"id":"a","name":"A","rate":20},{"id":"b","name":"B","rate":20}]',10,
'00000000-0000-0000-0000-000000000001'::uuid from unnest(array['progress','legacy-extra']) id;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
select production_manual_start('90000000-0000-0000-0000-000000000009','progress','body');
select production_timer_action('90000000-0000-0000-0000-000000000009','progress','finish');
reset role;
do $$begin
 if exists(select 1 from production_phase_checks where company_id='90000000-0000-0000-0000-000000000009') then raise exception 'Timer finish fabricated completion';end if;
end $$;
set local role authenticated;
select production_complete_phase('90000000-0000-0000-0000-000000000009','progress','body');
select production_complete_phase('90000000-0000-0000-0000-000000000009','progress','body');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$declare feed jsonb;begin
 feed:=production_live_feed('90000000-0000-0000-0000-000000000009');
 if feed->'program'->0->>'phaseId' is distinct from 'polish' or feed->'program'->0->>'updatedFromManual'<>'true' then raise exception 'Automatic proposal replayed completed manual phase: %',feed->'program';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_manual_start('90000000-0000-0000-0000-000000000009','progress','wash');
reset role;
do $$begin
 if not exists(select 1 from jsonb_array_elements(production_effective_phases('90000000-0000-0000-0000-000000000009',(select j from erp_snapshots s,jsonb_array_elements(s.payload->'jobs')j where s.company_id='90000000-0000-0000-0000-000000000009' and j->>'id'='progress'))) ph where ph->>'id'='wash' and ph->>'notRequired'='false' and ph->>'remainingTimeUnknown'='true') then raise exception 'Manual extra still skipped';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
set local role authenticated;
do $$declare feed jsonb;begin
 feed:=production_live_feed('90000000-0000-0000-0000-000000000009');
 if jsonb_array_length(feed->'program')<>0 then raise exception 'Automatic work skipped an unfinished extra or invented its duration';end if;
 begin
  perform production_timer_action('90000000-0000-0000-0000-000000000009','progress','start','polish');raise exception 'Unfinished manual predecessor bypass';
 exception when raise_exception then if sqlerrm<>'Completa le fasi precedenti prima di iniziare questa fase' then raise;end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_complete_phase('90000000-0000-0000-0000-000000000009','progress','wash');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('90000000-0000-0000-0000-000000000009','progress','start','polish');
select production_complete_phase('90000000-0000-0000-0000-000000000009','progress','polish');
reset role;
do $$begin
 if (select count(*) from production_phase_checks where company_id='90000000-0000-0000-0000-000000000009')<>3 then raise exception 'Signatures missing';end if;
 if exists(select 1 from production_live_segments where company_id='90000000-0000-0000-0000-000000000009' and ended_at is null) then raise exception 'Completion left a running timer';end if;
end $$;
-- Reopening preserves the old signature and blocks obsolete automatic successors.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
select production_manual_start('90000000-0000-0000-0000-000000000009','progress','body');
select production_manual_start('90000000-0000-0000-0000-000000000009','progress','body');
reset role;
do $$begin
 if (select count(*) from production_phase_check_history where company_id='90000000-0000-0000-0000-000000000009')<>1 then raise exception 'Previous signature lost or duplicated';end if;
 if exists(select 1 from production_phase_checks where company_id='90000000-0000-0000-0000-000000000009' and phase_id='body') then raise exception 'Obsolete signature still current';end if;
end $$;
set local role authenticated;
select production_complete_phase('90000000-0000-0000-0000-000000000009','progress','body');
-- Synthetic phases absent from a legacy quote can be explicitly signed and imported by the planner.
select production_manual_start('90000000-0000-0000-0000-000000000009','legacy-extra','manual-phase:polishing');
select production_complete_phase('90000000-0000-0000-0000-000000000009','legacy-extra','manual-phase:polishing');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$declare state jsonb;begin
 state:=production_planning_state('90000000-0000-0000-0000-000000000009');
 if not exists(select 1 from jsonb_array_elements(state->'phaseStates') e where e->>'jobId'='legacy-extra' and e->'phase'->>'id'='manual-phase:polishing' and e->'phase'->>'status'='Completata' and e->'phase'->>'notRequired'='false') then raise exception 'Nightly/office state omitted signed extra';end if;
 if jsonb_array_length(state->'checks')<>4 then raise exception 'Canonical checks missing';end if;
end $$;
reset role;
do $$begin
 if (select payload->'estimates'->0->>'total' from erp_snapshots where company_id='90000000-0000-0000-0000-000000000009')<>'122' then raise exception 'Estimate changed';end if;
 if exists(select 1 from production_live_jobs where company_id='90000000-0000-0000-0000-000000000009' and initial_budget<>120) then raise exception 'Frozen budget changed';end if;
 if has_table_privilege('authenticated','production_phase_check_history','select') or has_function_privilege('authenticated','production_phase_definitions(uuid)','execute') then raise exception 'Internal state exposed';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
set local role authenticated;
do $$begin
 begin
  perform production_complete_phase('90000000-0000-0000-0000-000000000009','progress','body');raise exception 'Foreign signature allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
