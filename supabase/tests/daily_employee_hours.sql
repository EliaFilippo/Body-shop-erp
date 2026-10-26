\set ON_ERROR_STOP on
\ir ../migrations/20261026_daily_employee_hours.sql
\ir ../migrations/20261026_daily_employee_hours.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"session_id":"hours-owner"}',true);
-- Independent closed intervals, including the 25-hour Rome daylight saving day.
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
 values('10000000-0000-0000-0000-000000000001','j1','a','00000000-0000-0000-0000-000000000002',null,50,'2026-10-25 08:00+00','2026-10-25 09:00+00');
insert into production_operator_activities(company_id,operator_id,user_id,operator_name,kind,started_at,ended_at) values
 ('10000000-0000-0000-0000-000000000001','a','00000000-0000-0000-0000-000000000002','A','cleaning','2026-10-25 09:00+00','2026-10-25 09:30+00'),
 ('10000000-0000-0000-0000-000000000001','a','00000000-0000-0000-0000-000000000002','A','coffee','2026-10-25 09:30+00','2026-10-25 09:40+00'),
 ('10000000-0000-0000-0000-000000000001','dst','00000000-0000-0000-0000-000000000002','DST','cleaning','2026-10-24 21:30+00','2026-10-25 02:30+00');
set role authenticated;
do $$declare r jsonb;e jsonb;begin
 r:=production_daily_hours('10000000-0000-0000-0000-000000000001','2026-10-25');
 select value into e from jsonb_array_elements(r->'operators') where value->>'operatorId'='a';
 if (e->>'vehicleSeconds')::numeric<>3600 or (e->>'cleaningSeconds')::numeric<>1800
 or (e->>'coffeeSeconds')::numeric<>600 or (e->>'totalSeconds')::numeric<>5400 then raise exception 'Day total incorrect: %',e;end if;
 if not exists(select 1 from jsonb_array_elements(e->'entries') x where x->>'jobId'='j1') then raise exception 'Vehicle missing';end if;
 select value into e from jsonb_array_elements(r->'operators') where value->>'operatorId'='dst';
 if (e->>'cleaningSeconds')::numeric<>16200 then raise exception 'Midnight/DST clipping wrong: %',e;end if;
 begin perform production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','cleaning',null,15,'Test correction','30000000-0000-0000-0000-000000000001');raise exception 'No-password write accepted';exception when insufficient_privilege then null;end;
 if has_table_privilege('authenticated','production_hour_adjustments','INSERT') or has_table_privilege('authenticated','production_hour_adjustments','UPDATE') or has_table_privilege('authenticated','production_hour_adjustments','DELETE') or has_table_privilege('authenticated','production_hour_adjustments','SELECT') then raise exception 'Table exposed';end if;
 begin perform production_daily_hours('10000000-0000-0000-0000-000000000099','2026-10-25');raise exception 'Cross tenant report';exception when insufficient_privilege then null;end;
 perform production_private_password('10000000-0000-0000-0000-000000000001','set',null,'daily-hours-test');
 perform production_private_password('10000000-0000-0000-0000-000000000001','unlock','daily-hours-test');
 r:=production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','cleaning',null,15,'Cleaning missed','30000000-0000-0000-0000-000000000001');
 r:=production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','cleaning',null,15,'Cleaning missed','30000000-0000-0000-0000-000000000001');
 r:=production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','vehicle','j1',-30,'Timer left running','30000000-0000-0000-0000-000000000002');
 select value into e from jsonb_array_elements(r->'operators') where value->>'operatorId'='a';
 if (e->>'totalSeconds')::numeric<>4500 or (e->>'cleaningSeconds')::numeric<>2700 or (e->>'vehicleSeconds')::numeric<>1800
 or jsonb_array_length(e->'adjustments')<>2 then raise exception 'Correction/idempotency failed: %',e;end if;
 begin perform production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','vehicle','j1',-31,'Too much removal','30000000-0000-0000-0000-000000000003');raise exception 'Negative vehicle allowed';exception when raise_exception then if sqlerrm not like 'Non puoi togliere%' then raise;end if;end;
 begin perform production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','vehicle','foreign-job',10,'Foreign vehicle','30000000-0000-0000-0000-000000000004');raise exception 'Foreign vehicle accepted';exception when raise_exception then if sqlerrm not like 'Vettura non trovata%' then raise;end if;end;
 begin perform production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','other',null,1440,'Too much daily time','30000000-0000-0000-0000-000000000005');raise exception 'Overlong day accepted';exception when raise_exception then if sqlerrm not like 'Il totale non può%' then raise;end if;end;
 perform set_config('request.jwt.claims','{"session_id":"other-device"}',true);
 begin perform production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','other',null,5,'Wrong session','30000000-0000-0000-0000-000000000006');raise exception 'Grant transferred';exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform production_daily_hours('10000000-0000-0000-0000-000000000001','2026-10-25');raise exception 'Employee sees colleagues';exception when insufficient_privilege then null;end;
 begin perform production_adjust_hours('10000000-0000-0000-0000-000000000001','a','2026-10-25','other',null,5,'Employee edit','30000000-0000-0000-0000-000000000007');raise exception 'Employee edit allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if (select count(*) from production_live_segments where job_id='j1' and operator_id='a' and started_at='2026-10-25 08:00+00' and ended_at='2026-10-25 09:00+00')<>1 then raise exception 'Raw time changed';end if;
 if (select count(*) from production_hour_adjustments where company_id='10000000-0000-0000-0000-000000000001')<>2 then raise exception 'Audit duplicates';end if;
end $$;
rollback;
