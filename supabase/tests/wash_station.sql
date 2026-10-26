\set ON_ERROR_STOP on
\ir ../migrations/20261026_wash_station.sql
\ir ../migrations/20261026_wash_station.sql
begin;
insert into companies(id,name) values('40000000-0000-0000-0000-000000000004','Wash fixture');
insert into erp_snapshots(company_id,payload,updated_by) values('40000000-0000-0000-0000-000000000004',
'{"plannerSettings":{"operators":[]},"jobs":[{"id":"wash-1","status":"In lavorazione","phases":[{"id":"w1","name":"Lavaggio esterno","status":"Da fare"}]},{"id":"wash-2","status":"Pianificata","phases":[{"id":"w2","name":"Lavaggio interni","status":"Da fare"}]}]}',
'00000000-0000-0000-0000-000000000001');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '40000000-0000-0000-0000-000000000004','wash-'||n,'WASH'||n,'WASH-'||n,100,'[]',0,'00000000-0000-0000-0000-000000000001'::uuid from generate_series(1,2)n;
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status) values
('40000000-0000-0000-0000-000000000004','wash-1','wash-a','00000000-0000-0000-0000-000000000002','A','paused'),
('40000000-0000-0000-0000-000000000004','wash-1','wash-b','00000000-0000-0000-0000-000000000003','B','paused'),
('40000000-0000-0000-0000-000000000004','wash-2','wash-b','00000000-0000-0000-0000-000000000003','B','paused');
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate) values
('40000000-0000-0000-0000-000000000004','wash-1','wash-a','00000000-0000-0000-0000-000000000002','w1',20);
do $$begin
 begin
 insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate) values
 ('40000000-0000-0000-0000-000000000004','wash-1','wash-b','00000000-0000-0000-0000-000000000003','w1',20);
 raise exception 'Second operator allowed';
 exception when raise_exception then if sqlerrm not like 'La sola postazione%' then raise;end if;end;
end $$;
update production_live_segments set ended_at=clock_timestamp() where company_id='40000000-0000-0000-0000-000000000004';
do $$begin
 begin
 insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate) values
 ('40000000-0000-0000-0000-000000000004','wash-2','wash-b','00000000-0000-0000-0000-000000000003','w2',20);
 raise exception 'Paused station reused';
 exception when raise_exception then if sqlerrm not like 'La sola postazione%' then raise;end if;end;
end $$;
insert into production_phase_checks(company_id,job_id,phase_id,phase_name,checked_by,operator_id,operator_name,checked_at) values
('40000000-0000-0000-0000-000000000004','wash-1','w1','Lavaggio esterno','00000000-0000-0000-0000-000000000002','wash-a','A',clock_timestamp());
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate) values
('40000000-0000-0000-0000-000000000004','wash-2','wash-b','00000000-0000-0000-0000-000000000003','w2',20);
rollback;
