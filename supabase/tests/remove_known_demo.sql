\set ON_ERROR_STOP on
\ir ../updates/20261025_remove_known_demo.sql
begin;
insert into companies(id,name) values('aa49d334-492f-4daa-aa7e-5d5c022308b7','Isolated demo cleanup fixture');
insert into erp_snapshots(company_id,payload,updated_by,revision) values(
'aa49d334-492f-4daa-aa7e-5d5c022308b7',
'{"jobs":[{"id":"cleanup-demo","vehicleId":"missing-demo-vehicle","estimateId":"cleanup-estimate","number":"COMM-00001","plate":"HFIEJI","status":"In lavorazione"},{"id":"real-job","vehicleId":"real-car","number":"COMM-00002","plate":"AB123CD"}],
"estimates":[{"id":"cleanup-estimate","convertedJobId":"cleanup-demo","status":"Approvato"},{"id":"real-estimate"}],
"quotes":[{"id":"cleanup-quote","estimateId":"cleanup-estimate"},{"id":"real-quote"}],
"customers":[{"id":"keep-customer"}],"vehicles":[{"id":"real-car","plate":"AB123CD"}],
"plannerSettings":{"operators":[{"id":"a","name":"A"}],"eliasExteriorWashMinutes":25},
"operatorPrograms":[{"date":"2026-10-25","operatorId":"a","summary":{"plannedMinutes":100},"tasks":[{"jobId":"cleanup-demo"},{"jobId":"real-job"}]}],
"production":{"jobs":[{"vehicleId":"missing-demo-vehicle"},{"vehicleId":"real-car"}],"workLogs":[{"vehicleId":"missing-demo-vehicle"}],"identities":[{"operatorId":"a"}]},
"workflowCounters":{"job":2},"invoices":[]}',
'00000000-0000-0000-0000-000000000001',7);
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
values('aa49d334-492f-4daa-aa7e-5d5c022308b7','cleanup-demo','HFIEJI','COMM-00001',270,'[]',7,'00000000-0000-0000-0000-000000000001');
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status)
values('aa49d334-492f-4daa-aa7e-5d5c022308b7','cleanup-demo','a','00000000-0000-0000-0000-000000000002','A','paused');
insert into production_live_segments(company_id,job_id,operator_id,user_id,rate,started_at,ended_at)
values('aa49d334-492f-4daa-aa7e-5d5c022308b7','cleanup-demo','a','00000000-0000-0000-0000-000000000002',20,now()-interval '5 minutes',now());
-- An invoice blocks cleanup atomically.
update erp_snapshots set payload=jsonb_set(payload,'{invoices}','[{"id":"do-not-delete","quoteId":"cleanup-quote"}]') where company_id='aa49d334-492f-4daa-aa7e-5d5c022308b7';
do $$begin
 begin
  perform remove_elias_known_demo();
  raise exception 'Expected financial guard';
 exception when raise_exception then
  if sqlerrm not like 'La prova ha fatture collegate:%' then raise;end if;
 end;
 if not exists(select 1 from production_live_sessions where job_id='cleanup-demo') then raise exception 'Guard deleted timer';end if;
end $$;
update erp_snapshots set payload=jsonb_set(payload,'{invoices}','[]') where company_id='aa49d334-492f-4daa-aa7e-5d5c022308b7';
select remove_elias_known_demo();
do $$declare s jsonb; rev bigint;begin
 select payload,revision into s,rev from erp_snapshots where company_id='aa49d334-492f-4daa-aa7e-5d5c022308b7';
 if jsonb_array_length(s->'jobs')<>1 or s->'jobs'->0->>'id'<>'real-job' then raise exception 'Real job damaged';end if;
 if jsonb_array_length(s->'quotes')<>1 or jsonb_array_length(s->'estimates')<>1 then raise exception 'Related quote remains';end if;
 if s->'plannerSettings'->>'eliasExteriorWashMinutes'<>'25' or jsonb_array_length(s->'customers')<>1 or s->'workflowCounters'->>'job'<>'2' then raise exception 'Settings or customers changed';end if;
 if jsonb_array_length(s->'operatorPrograms'->0->'tasks')<>1 or jsonb_array_length(s->'production'->'workLogs')<>0 then raise exception 'Demo assignments remain';end if;
 if exists(select 1 from production_live_jobs where job_id='cleanup-demo') or exists(select 1 from production_live_segments where job_id='cleanup-demo') then raise exception 'Demo timers remain';end if;
 if not exists(select 1 from demo_cleanup_backups where snapshot->'jobs'->0->>'id'='cleanup-demo' and jsonb_array_length(live_records->'production_live_segments')=1) then raise exception 'Recovery copy missing';end if;
 perform remove_elias_known_demo();
 if (select revision from erp_snapshots where company_id='aa49d334-492f-4daa-aa7e-5d5c022308b7')<>rev then raise exception 'Not idempotent';end if;
 if has_function_privilege('authenticated','public.remove_elias_known_demo()','execute') or has_table_privilege('authenticated','public.demo_cleanup_backups','select') then raise exception 'Maintenance exposed';end if;
end $$;
rollback;
