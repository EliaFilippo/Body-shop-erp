\set ON_ERROR_STOP on
\ir ../migrations/20261028105620_production_read_snapshot.sql
\ir ../migrations/20261028105620_production_read_snapshot.sql
begin;
insert into companies(id,name) values('91000000-0000-0000-0000-000000000009','Synchronous tablet read fixture');
insert into company_members(company_id,user_id,display_name,role) values
('91000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','Owner','owner'),
('91000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','Worker','production');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into erp_snapshots(company_id,revision,payload,updated_by) values(
'91000000-0000-0000-0000-000000000009',1,
'{"plannerSettings":{"operators":[{"id":"worker","name":"Worker","active":true}]},"jobs":[{"id":"new-car","plate":"MORNING","number":"COMM-N","status":"Pianificata","phases":[{"id":"body","name":"Lattoneria","estimatedMinutes":60,"status":"Da fare"},{"id":"polish","name":"Lucidatura","estimatedMinutes":30,"status":"Da fare"}]}],"operatorPrograms":[{"operatorId":"worker","tasks":[{"id":"task","jobId":"new-car","phaseId":"body","phaseName":"Lattoneria","startAt":"2026-10-28T08:00:00Z"}]}],"operatorProgramHistory":[{"id":"audit","reason":"preserve"}]}',
'00000000-0000-0000-0000-000000000001');
select production_bind_profile('91000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','worker');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
values('91000000-0000-0000-0000-000000000009','new-car','MORNING','COMM-N',120,'[{"id":"worker","name":"Worker","rate":20}]',1,'00000000-0000-0000-0000-000000000001');
-- A save is visible in the same transaction, without waiting for the nightly job.
update erp_snapshots set revision=2,payload=jsonb_set(payload,'{jobs,0,phases,0,status}','"Completata"') where company_id='91000000-0000-0000-0000-000000000009';
do $$begin
 if not exists(select 1 from production_read_snapshots r join erp_snapshots s using(company_id) where r.company_id='91000000-0000-0000-0000-000000000009' and r.revision=2 and r.payload=s.payload-'operatorProgramHistory') then raise exception 'Projection is stale';end if;
 if (select payload->'operatorProgramHistory'->0->>'id' from erp_snapshots where company_id='91000000-0000-0000-0000-000000000009') is distinct from 'audit' then raise exception 'Audit history changed';end if;
 if exists(select 1 from production_read_snapshots where payload ? 'operatorProgramHistory') then raise exception 'Production rereads archive';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$declare f jsonb;begin
 begin perform 1 from production_read_snapshots;raise exception 'Private projection readable';exception when insufficient_privilege then null;end;
 f:=production_live_feed('91000000-0000-0000-0000-000000000009');
 if f->'jobs'->0->'phases'->0->>'status' is distinct from 'Completata' then raise exception 'Tablet ignored current save';end if;
 if f->'program'->0->>'phaseId' is distinct from 'polish' then raise exception 'Automatic assignment used obsolete phase';end if;
 begin perform production_live_feed('92000000-0000-0000-0000-000000000009');raise exception 'Cross-company projection leaked';exception when raise_exception then if sqlerrm<>'Accesso aziendale richiesto' then raise;end if;end;
end $$;
select production_manual_start('91000000-0000-0000-0000-000000000009','new-car','polish');
select production_complete_phase('91000000-0000-0000-0000-000000000009','new-car','polish');
do $$declare f jsonb;begin
 f:=production_live_feed('91000000-0000-0000-0000-000000000009');
 if jsonb_array_length(f->'program')<>0 then raise exception 'Manual signature not immediately visible';end if;
end $$;
reset role;
delete from erp_snapshots where company_id='91000000-0000-0000-0000-000000000009';
do $$begin if exists(select 1 from production_read_snapshots where company_id='91000000-0000-0000-0000-000000000009') then raise exception 'Deleted archive left stale tablet data';end if;end $$;
rollback;
