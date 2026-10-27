\set ON_ERROR_STOP on
\ir ../migrations/20261027_unscheduled_work.sql
\ir ../migrations/20261027_unscheduled_work.sql
\ir ../migrations/20261027_free_start.sql
\ir ../migrations/20261027_free_start.sql
begin;
insert into companies(id,name) values('50000000-0000-0000-0000-000000000005','Off-program fixture');
insert into company_members(company_id,user_id,display_name,role) values
('50000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Owner','owner'),
('50000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','A','production'),
('50000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','B','production');
insert into erp_snapshots(company_id,payload,updated_by) values('50000000-0000-0000-0000-000000000005',
'{"plannerSettings":{"operators":[{"id":"a","name":"A","active":true,"dailyHours":8},{"id":"b","name":"B","active":true,"dailyHours":8}]},"jobs":[{"id":"off1","status":"Pianificata","phases":[{"id":"p1","name":"Lattoneria","status":"Da fare"}]},{"id":"off2","status":"Pianificata","phases":[{"id":"p2","name":"Lattoneria","status":"Da fare"}]}]}',
'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('50000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','a');
select production_bind_profile('50000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','b');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '50000000-0000-0000-0000-000000000005','off'||n,'OFF'||n,'COMM-'||n,120,
'[{"id":"a","name":"A","rate":20},{"id":"b","name":"B","rate":20}]',1,'00000000-0000-0000-0000-000000000001'::uuid
from generate_series(1,2)n;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('50000000-0000-0000-0000-000000000005','off1','start','p1');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('50000000-0000-0000-0000-000000000005','off1','start','p1');
select production_start_selected_job('50000000-0000-0000-0000-000000000005','off2','p2');
select production_start_selected_job('50000000-0000-0000-0000-000000000005','off2','p2');
do $$begin
 if (select count(*) from production_live_segments where company_id='50000000-0000-0000-0000-000000000005' and operator_id='a' and ended_at is null)<>1 then raise exception 'Duplicate work';end if;
 if not exists(select 1 from production_live_segments where company_id='50000000-0000-0000-0000-000000000005' and operator_id='b' and ended_at is null) then raise exception 'Colleague stopped';end if;
 if exists(select 1 from production_phase_checks where company_id='50000000-0000-0000-0000-000000000005') then raise exception 'Auto-completed';end if;
 begin
  perform production_start_selected_job('50000000-0000-0000-0000-000000000005','off1','missing');
  raise exception 'Invalid phase allowed';
 exception when raise_exception then if sqlerrm='Invalid phase allowed' then raise;end if;end;
 if not exists(select 1 from production_live_segments where company_id='50000000-0000-0000-0000-000000000005' and operator_id='a' and job_id='off2' and ended_at is null) then raise exception 'Rollback lost current timer';end if;
 begin
  perform production_planning_state('50000000-0000-0000-0000-000000000005');raise exception 'Production read office facts';
 exception when raise_exception then if sqlerrm not like 'Accesso ufficio%' then raise;end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
do $$declare facts jsonb;begin
 facts:=production_planning_state('50000000-0000-0000-0000-000000000005');
 if jsonb_array_length(facts->'entries')<>3 then raise exception 'Missing real work: %',facts;end if;
 if facts::text like '%rate%' or facts::text like '%budget%' then raise exception 'Economic data leak';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_activity_action('50000000-0000-0000-0000-000000000005','cleaning');
do $begin
 begin
  perform production_start_selected_job('50000000-0000-0000-0000-000000000005','off1','missing');
  raise exception 'Invalid target allowed from cleaning';
 exception when raise_exception then if sqlerrm='Invalid target allowed from cleaning' then raise;end if;end;
 if not exists(select 1 from production_operator_activities where company_id='50000000-0000-0000-0000-000000000005' and operator_id='a' and kind='cleaning' and ended_at is null) then raise exception 'Failed Start ended cleaning';end if;
end $;
select production_start_selected_job('50000000-0000-0000-0000-000000000005','off1','p1');
do $begin
 if exists(select 1 from production_operator_activities where company_id='50000000-0000-0000-0000-000000000005' and operator_id='a' and ended_at is null) then raise exception 'Cleaning overlaps work';end if;
 if (select count(*) from production_live_segments where company_id='50000000-0000-0000-0000-000000000005' and operator_id='a' and ended_at is null)<>1 then raise exception 'Missing selected work';end if;
end $;
select production_activity_action('50000000-0000-0000-0000-000000000005','coffee');
select production_start_selected_job('50000000-0000-0000-0000-000000000005','off2','p2');
do $begin
 if exists(select 1 from production_operator_activities where company_id='50000000-0000-0000-0000-000000000005' and operator_id='a' and ended_at is null) then raise exception 'Coffee overlaps work';end if;
 if not exists(select 1 from production_live_segments where company_id='50000000-0000-0000-0000-000000000005' and operator_id='b' and ended_at is null) then raise exception 'Colleague stopped';end if;
 if exists(select 1 from production_phase_checks where company_id='50000000-0000-0000-0000-000000000005') then raise exception 'Phase completed automatically';end if;
end $;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
do $$begin
 begin
  perform production_start_selected_job('50000000-0000-0000-0000-000000000005','off1','p1');raise exception 'Cross tenant allowed';
 exception when raise_exception then if sqlerrm not like 'Accesso aziendale%' then raise;end if;end;
end $$;
rollback;
