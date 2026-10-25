\set ON_ERROR_STOP on
\ir ../migrations/20261025_paint_station_capacity.sql
begin;
insert into companies(id,name) values('30000000-0000-0000-0000-000000000003','Paint stations fixture');
insert into erp_snapshots(company_id,payload,updated_by) values(
'30000000-0000-0000-0000-000000000003',
'{"plannerSettings":{"operators":[{"id":"paint-a","name":"A","active":true},{"id":"paint-b","name":"B","active":true}]},"jobs":[
{"id":"paint-1","status":"In lavorazione","phases":[{"id":"paint-phase-1","name":"Verniciatura","status":"Da fare","technicalWaitMinutes":60}]},
{"id":"paint-2","status":"In lavorazione","phases":[{"id":"paint-phase-2","name":"Verniciatura","status":"Da fare","technicalWaitMinutes":60}]},
{"id":"paint-3","status":"In lavorazione","phases":[{"id":"paint-phase-3","name":"Verniciatura","status":"Da fare","technicalWaitMinutes":60}]},
{"id":"paint-4","status":"In lavorazione","phases":[{"id":"paint-phase-4","name":"Verniciatura","status":"Da fare","technicalWaitMinutes":60}]}]}',
'00000000-0000-0000-0000-000000000001');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '30000000-0000-0000-0000-000000000003','paint-'||n,'CAR'||n,'COMM-'||n,100,'[]',0,'00000000-0000-0000-0000-000000000001'::uuid from generate_series(1,4) n;
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status)
select '30000000-0000-0000-0000-000000000003','paint-'||n,'paint-a','00000000-0000-0000-0000-000000000002'::uuid,'A','paused' from generate_series(1,4) n;
-- A paused vehicle still occupies its painting bay.
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
select '30000000-0000-0000-0000-000000000003','paint-'||n,'paint-a','00000000-0000-0000-0000-000000000002'::uuid,'paint-phase-'||n,20,now()-interval '10 minutes',now() from generate_series(1,3) n;
do $$begin
 begin
  insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
  values('30000000-0000-0000-0000-000000000003','paint-4','paint-a','00000000-0000-0000-0000-000000000002','paint-phase-4',20,now(),now());
  raise exception 'Fourth vehicle was allowed';
 exception when raise_exception then if sqlerrm not like 'Le 3 postazioni%' then raise;end if;end;
end $$;
-- A colleague on the same car consumes no second bay.
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status)
values('30000000-0000-0000-0000-000000000003','paint-1','paint-b','00000000-0000-0000-0000-000000000003','B','paused');
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
values('30000000-0000-0000-0000-000000000003','paint-1','paint-b','00000000-0000-0000-0000-000000000003','paint-phase-1',20,now(),now());
insert into production_phase_checks(company_id,job_id,phase_id,phase_name,checked_by,operator_id,operator_name,checked_at)
values('30000000-0000-0000-0000-000000000003','paint-1','paint-phase-1','Verniciatura','00000000-0000-0000-0000-000000000002','paint-a','A',now());
do $$begin
 begin
  insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
  values('30000000-0000-0000-0000-000000000003','paint-4','paint-a','00000000-0000-0000-0000-000000000002','paint-phase-4',20,now(),now());
  raise exception 'Drying bay was reused';
 exception when raise_exception then if sqlerrm not like 'Le 3 postazioni%' then raise;end if;end;
end $$;
update production_phase_checks set checked_at=now()-interval '61 minutes' where company_id='30000000-0000-0000-0000-000000000003' and job_id='paint-1';
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
values('30000000-0000-0000-0000-000000000003','paint-4','paint-a','00000000-0000-0000-0000-000000000002','paint-phase-4',20,now(),now());
do $$begin
 if has_function_privilege('authenticated','public.guard_paint_station_capacity()','execute') then raise exception 'Internal guard exposed';end if;
end $$;
rollback;
