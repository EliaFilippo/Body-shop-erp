\set ON_ERROR_STOP on
\ir ../migrations/20261030062756_completion_planning.sql
begin;
insert into companies(id,name) values('93000000-0000-0000-0000-000000000009','Completion event fixture');
insert into company_members(company_id,user_id,display_name,role) values
('93000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','Owner','owner'),
('93000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','Worker','production');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('93000000-0000-0000-0000-000000000009',10,
'{"customers":[{"id":"keep"}],"invoices":[{"id":"keep"}],"vehicles":[],"plannerSettings":{"operators":[{"id":"a","name":"A","active":true,"skillsConfigured":true,"skills":["Lattoneria","Lucidatura"]}]},"jobs":[{"id":"completion","plate":"COMPLETE","number":"COMM-C","status":"Pianificata","workflowCycle":"elias-v1","phases":[{"id":"body","name":"Lattoneria","estimatedMinutes":60,"status":"Da fare","cycleOrder":4},{"id":"polish","name":"Lucidatura","estimatedMinutes":30,"status":"Da fare","cycleOrder":11}]}],"operatorPrograms":[{"operatorId":"a","tasks":[]}]}',
'00000000-0000-0000-0000-000000000001');
insert into production_completion_worker(singleton,endpoint,secret_hash) values(true,'https://example.invalid',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
values('93000000-0000-0000-0000-000000000009','completion','COMPLETE','COMM-C',120,'[{"id":"a","name":"A","rate":20}]',10,'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('93000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','a');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
select production_manual_start('93000000-0000-0000-0000-000000000009','completion','body');
select production_timer_action('93000000-0000-0000-0000-000000000009','completion','finish');
reset role;
do $$begin
 if exists(select 1 from production_completion_queue where company_id='93000000-0000-0000-0000-000000000009') then raise exception 'Timer finish triggered planning';end if;
end $$;
set local role authenticated;
select production_complete_phase('93000000-0000-0000-0000-000000000009','completion','body');
reset role;
do $$declare claim jsonb;again jsonb;plan jsonb;ok boolean;gen bigint;begin
 if has_table_privilege('authenticated','production_completion_queue','select') or has_function_privilege('authenticated','production_completion_claim(uuid,text)','execute') then raise exception 'Private planner exposed';end if;
 if production_completion_claim('93000000-0000-0000-0000-000000000009','bad') is not null then raise exception 'Bad scheduler secret accepted';end if;
 claim:=production_completion_claim('93000000-0000-0000-0000-000000000009',repeat('a',64));
 if claim is null then raise exception 'Completion did not enqueue';end if;
 if claim->'payload' ? 'operatorProgramHistory' then raise exception 'Large history returned';end if;
 if production_completion_claim('93000000-0000-0000-0000-000000000009',repeat('a',64)) is not null then raise exception 'Duplicate worker allowed';end if;
 gen:=(claim->>'generation')::bigint;
 plan:=jsonb_build_object('generation',gen,'generatedAt',clock_timestamp(),'operatorPrograms','[]'::jsonb,'plannerAssignments','[]'::jsonb,'forecasts','[]'::jsonb,'warnings','[]'::jsonb);
 -- A second signature/event cannot be acknowledged by the earlier calculation.
 perform production_completion_enqueue('93000000-0000-0000-0000-000000000009');
 ok:=production_completion_commit('93000000-0000-0000-0000-000000000009',(claim->>'id')::uuid,gen,10,plan);
 if ok then raise exception 'Newer generation lost';end if;
 claim:=production_completion_claim('93000000-0000-0000-0000-000000000009',repeat('a',64));
 gen:=(claim->>'generation')::bigint;plan:=jsonb_set(plan,'{generation}',to_jsonb(gen));
 if not production_completion_commit('93000000-0000-0000-0000-000000000009',(claim->>'id')::uuid,gen,10,plan) then raise exception 'Current plan rejected';end if;
 if (select revision from erp_snapshots where company_id='93000000-0000-0000-0000-000000000009')<>10 then raise exception 'Derived plan changed office CAS revision';end if;
 if not exists(select 1 from production_phase_checks where company_id='93000000-0000-0000-0000-000000000009' and phase_id='body') then raise exception 'Signature lost';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$declare result jsonb;begin
 result:=production_completion_plan('93000000-0000-0000-0000-000000000009');
 if result->'plan' is null or (result->>'pending')::boolean then raise exception 'Office cannot read completed plan';end if;
 if production_completion_plan('93000000-0000-0000-0000-000000000009',(result->'plan'->>'generation')::bigint) ? 'plan' then raise exception 'Unchanged plan retransmitted';end if;
 begin
  perform production_completion_plan('93000000-0000-0000-0000-000000000008');raise exception 'Wrong company accepted';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
-- A newer office edit invalidates the forecast without replacing business data.
update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,efficiencyPercent}','75'),revision=revision+1 where company_id='93000000-0000-0000-0000-000000000009';
do $$declare claim jsonb;begin
 if production_completion_overlay('93000000-0000-0000-0000-000000000009',(select payload from production_read_snapshots where company_id='93000000-0000-0000-0000-000000000009'))->'operatorPrograms' <> '[{"operatorId":"a","tasks":[]}]'::jsonb then raise exception 'Stale proposals leaked';end if;
 claim:=production_completion_claim('93000000-0000-0000-0000-000000000009',repeat('a',64));
 if claim is null then raise exception 'Office change lost recalculation';end if;
 perform production_completion_failed('93000000-0000-0000-0000-000000000009',(claim->>'id')::uuid);
 if not exists(select 1 from production_completion_queue where company_id='93000000-0000-0000-0000-000000000009' and lease_until is null and generation>applied_generation) then raise exception 'Failure lost pending work';end if;
end $$;
rollback;
