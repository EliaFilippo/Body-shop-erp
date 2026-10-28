\set ON_ERROR_STOP on
\ir ../migrations/20261028080641_nightly_economics.sql
\ir ../migrations/20261028080641_nightly_economics.sql
begin;
insert into companies(id,name) values('80000000-0000-0000-0000-000000000008','Night economics fixture');
insert into company_members(company_id,user_id,display_name,role) values
('80000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001','Owner','owner'),
('80000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000002','A','production');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('80000000-0000-0000-0000-000000000008',10,
'{"customers":[{"id":"keep"}],"invoices":[{"id":"keep-invoice"}],"plannerSettings":{"monthlyRevenueGoal":10000,"operators":[{"id":"a","name":"A","active":true,"dailyHours":8}]},"jobs":[{"id":"econ","status":"Pianificata"}],"operatorPrograms":[]}',
'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('80000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000002','a');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
values('80000000-0000-0000-0000-000000000008','econ','ECON','ECON',120,'[{"id":"a","name":"A","rate":20}]',10,'00000000-0000-0000-0000-000000000001');
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status)
values('80000000-0000-0000-0000-000000000008','econ','a','00000000-0000-0000-0000-000000000002','A','finished');
insert into production_live_segments(company_id,job_id,operator_id,user_id,rate,started_at,ended_at) values
('80000000-0000-0000-0000-000000000008','econ','a','00000000-0000-0000-0000-000000000002',20,'2026-01-31T22:30:00Z','2026-02-01T00:30:00Z'),
('80000000-0000-0000-0000-000000000008','econ','a','00000000-0000-0000-0000-000000000002',20,'2026-10-24T22:00:00Z','2026-10-25T23:00:00Z');
insert into production_operator_activities(company_id,operator_id,user_id,operator_name,kind,started_at,ended_at)
values('80000000-0000-0000-0000-000000000008','a','00000000-0000-0000-0000-000000000002','A','cleaning','2026-02-01T00:30:00Z','2026-02-01T01:00:00Z');
do $$declare facts jsonb;begin
 facts:=production_nightly_workdays('80000000-0000-0000-0000-000000000008','2026-02-01T03:00:00Z');
 if facts<> '[{"date":"2026-02-01","operatorId":"a","productiveSeconds":5400,"paidSeconds":7200}]'::jsonb then raise exception 'Month boundary/paid hours incorrect: %',facts;end if;
 facts:=production_nightly_workdays('80000000-0000-0000-0000-000000000008','2026-10-26T03:00:00Z');
 if facts<> '[{"date":"2026-10-25","operatorId":"a","productiveSeconds":90000,"paidSeconds":90000}]'::jsonb then raise exception 'Rome DST day incorrect: %',facts;end if;
 if has_function_privilege('authenticated','production_nightly_workdays(uuid,timestamptz)','execute')
  or has_function_privilege('service_role','production_nightly_claim_before_economics(uuid,text)','execute') then raise exception 'Internal hourly facts exposed';end if;
end $$;
insert into production_nightly_settings(company_id,run_hour,secret_hash) values('80000000-0000-0000-0000-000000000008',least(20,extract(hour from clock_timestamp() at time zone 'Europe/Rome')::int),encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex'));
set local role service_role;
do $$declare claim jsonb;ok boolean;begin
 if production_nightly_claim('80000000-0000-0000-0000-000000000008','wrong') is not null then raise exception 'Secret bypass';end if;
 claim:=production_nightly_claim('80000000-0000-0000-0000-000000000008',repeat('c',64));
 if jsonb_typeof(claim->'state'->'dailyWork') is distinct from 'array' then raise exception 'Hours missing from authenticated claim';end if;
 ok:=production_nightly_commit('80000000-0000-0000-0000-000000000008',(claim->>'id')::uuid,10,
 '{"operatorPrograms":[],"nightlyPlanning":{"enabled":true,"economics":{"realHourlyCost":40,"targetHourlyRate":60,"dailyGoal":1000}},"invoices":[],"plannerSettings":{}}');
 if not ok then raise exception 'Economic snapshot not committed';end if;
end $$;
reset role;
do $$begin
 if (select payload->'invoices' from erp_snapshots where company_id='80000000-0000-0000-0000-000000000008')<>'[{"id":"keep-invoice"}]'::jsonb then raise exception 'Financial documents rewritten';end if;
 if (select payload->'plannerSettings'->>'monthlyRevenueGoal' from erp_snapshots where company_id='80000000-0000-0000-0000-000000000008')<>'10000' then raise exception 'Goal rewritten';end if;
 if (select payload->'nightlyPlanning'->'economics'->>'dailyGoal' from erp_snapshots where company_id='80000000-0000-0000-0000-000000000008')<>'1000' then raise exception 'Economic indicators not persisted';end if;
 if exists(select 1 from production_phase_checks where company_id='80000000-0000-0000-0000-000000000008') then raise exception 'Invented completion';end if;
end $$;
rollback;
