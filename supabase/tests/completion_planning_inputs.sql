\set ON_ERROR_STOP on
\ir ../migrations/20261030071151_completion_planning_inputs.sql
begin;
do $$declare base jsonb;progress jsonb;begin
 base:='{"plannerSettings":{},"vehicles":[{"id":"v","status":"Accettata","workedHours":0}],"jobs":[{"id":"j","status":"Pianificata","phases":[{"id":"p","name":"Lattoneria","estimatedMinutes":60,"status":"Da fare","operatorAssignments":[]}]}]}';
 progress:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(base,'{vehicles,0,workedHours}','1'),'{vehicles,0,status}','"In lavorazione"'),'{jobs,0,status}','"In lavorazione"'),'{jobs,0,phases,0,operatorAssignments}','[{"id":"tablet:a","operatorName":"A","activityStatus":"Concluso","workedMinutes":50}]');
 if production_completion_input_hash(base)<>production_completion_input_hash(progress) then raise exception 'Timer polling would replan';end if;
 if production_completion_input_hash(base)=production_completion_input_hash(jsonb_set(base,'{jobs,0,phases,0,estimatedMinutes}','120')) then raise exception 'Changed allowance ignored';end if;
 if production_completion_input_hash(base)=production_completion_input_hash(jsonb_set(base,'{jobs,0,status}','"Consegnata"')) then raise exception 'Delivery ignored';end if;
end $$;
insert into companies(id,name) values('95000000-0000-0000-0000-000000000009','Input isolation fixture');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('95000000-0000-0000-0000-000000000009',10,'{"customers":[],"jobs":[],"vehicles":[],"plannerSettings":{"operators":[]},"operatorPrograms":[]}','00000000-0000-0000-0000-000000000001');
insert into production_completion_worker(singleton,endpoint,secret_hash) values(true,'https://example.invalid',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
select production_completion_enqueue('95000000-0000-0000-0000-000000000009');
do $$declare claim jsonb;plan jsonb;begin
 claim:=production_completion_claim('95000000-0000-0000-0000-000000000009',repeat('a',64));
 update erp_snapshots set revision=revision+1,payload=jsonb_set(payload,'{customers}','[{"id":"new-customer"}]') where company_id='95000000-0000-0000-0000-000000000009';
 plan:=jsonb_build_object('generation',(claim->>'generation')::bigint,'generatedAt',clock_timestamp(),'operatorPrograms','[]'::jsonb,'plannerAssignments','[]'::jsonb,'forecasts','[]'::jsonb);
 if not production_completion_commit('95000000-0000-0000-0000-000000000009',(claim->>'id')::uuid,(claim->>'generation')::bigint,10,plan) then raise exception 'Unrelated office save discarded plan';end if;
 if (select revision from erp_snapshots where company_id='95000000-0000-0000-0000-000000000009')<>11 then raise exception 'Office revision changed';end if;
 if (select payload->'customers' from erp_snapshots where company_id='95000000-0000-0000-0000-000000000009')<>'[{"id":"new-customer"}]'::jsonb then raise exception 'Office save lost';end if;
end $$;
rollback;
