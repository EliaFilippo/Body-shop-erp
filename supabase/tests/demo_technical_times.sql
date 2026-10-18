\set ON_ERROR_STOP on
\ir ../migrations/20261018_demo_technical_times.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',(payload->'jobs')||'[{
 "id":"demo-technical","estimateId":"demo-estimate","number":"COMM-00001","plate":"HFIEJI","status":"In lavorazione",
 "taxableAmount":270,"vatAmount":59.4,"total":329.4,"history":[],
 "lines":[{"id":"blend","description":"Sfumatura parafango posteriore SX (lieve) · materiali inclusi","quantity":1,"unitPrice":120,"estimatedMinutes":60,"total":146.4},
 {"id":"wing","description":"Parafango anteriore DX (lieve) · materiali inclusi","quantity":1,"unitPrice":150,"estimatedMinutes":120,"total":183}],
 "phases":[{"id":"demo-wash","name":"Lavaggio esterno","status":"Da fare","estimatedMinutes":0},
 {"id":"demo-prep","name":"Stuccatura","status":"Da fare","estimatedMinutes":0},
 {"id":"demo-mask","name":"Incartatura","status":"Da fare","estimatedMinutes":0},
 {"id":"demo-paint","name":"Verniciatura","status":"Da fare","estimatedMinutes":180},
 {"id":"demo-unmask","name":"Scartatura","status":"Da fare","estimatedMinutes":0},
 {"id":"demo-polish","name":"Lucidatura","status":"Da fare","estimatedMinutes":0},
 {"id":"demo-delivery","name":"Consegna","status":"Da fare","estimatedMinutes":0}]
}]'::jsonb) where company_id='10000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{estimates}',coalesce(payload->'estimates','[]')||'[{"id":"demo-estimate","status":"Approvato","convertedJobId":"demo-technical"}]'::jsonb)
 where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001','demo-technical',10,216,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 values('10000000-0000-0000-0000-000000000001','demo-technical','a','00000000-0000-0000-0000-000000000002','A','paused','demo-wash');
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
 values('10000000-0000-0000-0000-000000000001','demo-technical','a','00000000-0000-0000-0000-000000000002','demo-wash',50,now()-interval '20 minutes',now()-interval '10 minutes'),
 ('10000000-0000-0000-0000-000000000001','demo-technical','a','00000000-0000-0000-0000-000000000002','demo-prep',50,now()-interval '30 minutes',now()-interval '25 minutes');
-- SQL Editor has no application identity; confirmed quote guards must still pass.
set request.jwt.claim.sub='';
-- Running work must be paused before any allowance can be changed.
update production_live_sessions set status='running' where job_id='demo-technical';
do $$begin
 begin perform production_repair_demo_times('10000000-0000-0000-0000-000000000001');raise exception 'Running work was changed';
 exception when raise_exception then if sqlerrm not like 'Metti in pausa%' then raise;end if;end;
end $$;
update production_live_sessions set status='paused' where job_id='demo-technical';
create temporary table demo_before as select initial_budget,operator_rates,phase_budgets,
 (select jsonb_agg(to_jsonb(s) order by id) from production_live_segments s where job_id='demo-technical') segments,
 (select jsonb_agg(to_jsonb(s) order by operator_id) from production_live_sessions s where job_id='demo-technical') sessions
 from production_live_jobs where job_id='demo-technical';
select production_repair_demo_times('10000000-0000-0000-0000-000000000001');
create temporary table demo_after_first as select payload,revision from erp_snapshots where company_id='10000000-0000-0000-0000-000000000001';
select production_repair_demo_times('10000000-0000-0000-0000-000000000001');
do $$declare j jsonb; before_record record; after_record record;begin
 if not exists(select 1 from erp_snapshots s,demo_after_first b where s.company_id='10000000-0000-0000-0000-000000000001' and s.payload=b.payload and s.revision=b.revision) then raise exception 'Repeated repair rewrites job or revision';end if;
 select * into before_record from demo_before;
 select initial_budget,operator_rates,phase_budgets,
 (select jsonb_agg(to_jsonb(s) order by id) from production_live_segments s where job_id='demo-technical') segments,
 (select jsonb_agg(to_jsonb(s) order by operator_id) from production_live_sessions s where job_id='demo-technical') sessions into after_record
 from production_live_jobs where job_id='demo-technical';
 if to_jsonb(before_record) is distinct from to_jsonb(after_record) then raise exception 'Finances or worked records changed';end if;
 select x into j from erp_snapshots s,jsonb_array_elements(s.payload->'jobs') x where s.company_id='10000000-0000-0000-0000-000000000001' and x->>'id'='demo-technical';
 if j->'lines'->1->>'estimatedMinutes'<>'120' then raise exception 'Historical quote/job line time changed';end if;
 if j->>'total'<>'329.4' or j->'lines'->0->>'unitPrice'<>'120' or j->'lines'->1->>'unitPrice'<>'150' then raise exception 'Sale prices changed';end if;
 if (select sum((p->>'estimatedMinutes')::numeric) from jsonb_array_elements(j->'phases') p)<>260 then raise exception 'Technical total is not 4h20';end if;
 if exists(select 1 from jsonb_array_elements(j->'phases') p where p->>'name'='Stuccatura' and not (p->>'notRequired')::boolean) then raise exception 'Prep phase still separate';end if;
 if (select count(*) from jsonb_array_elements(j->'phases') p where p->>'name'='Verniciatura' and (p->>'estimatedMinutes')::numeric=90)<>1 then raise exception 'Painting allowance missing';end if;
 begin perform production_demo_technical_job(j||'{"plate":"OTHER"}');raise exception 'Wrong demo accepted';exception when raise_exception then if sqlerrm not like 'La correzione riguarda%' then raise;end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare j jsonb; p jsonb;begin
 select x into j from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') x where x->>'jobId'='demo-technical';
 if j is null then raise exception 'Demo missing from tablet feed';end if;
 select x into p from jsonb_array_elements(j->'phases') x where x->>'id'='demo-wash';
 if abs((p->'standardClock'->>'ownRemainingSeconds')::numeric-900)>1 then raise exception 'Wash elapsed time lost';end if;
 select x into p from jsonb_array_elements(j->'phases') x where x->>'id'='demo-paint';
 if abs((p->'standardClock'->>'ownRemainingSeconds')::numeric-5100)>1 then raise exception 'Retired prep work no longer consumes painting time';end if;
 select x into p from jsonb_array_elements(j->'phases') x where x->>'id'='demo-unmask';
 if (p->'standardClock'->>'totalMinutes')::numeric<>70 then raise exception 'Shared masking allowance missing';end if;
 select x into p from jsonb_array_elements(j->'phases') x where x->>'name'='Rimontaggio';
 if (p->'standardClock'->>'totalMinutes')::numeric<>60 then raise exception 'Reassembly allowance missing';end if;
 if j->>'ownStatus'<>'paused' then raise exception 'Pause lost';end if;
 begin perform production_repair_demo_times('10000000-0000-0000-0000-000000000001');raise exception 'Worker can change allowance';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
