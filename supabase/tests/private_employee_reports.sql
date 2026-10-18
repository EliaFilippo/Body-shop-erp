\set ON_ERROR_STOP on
\ir ../updates/20261018_private_employee_reports.sql
\ir ../migrations/20261018_private_employee_reports.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set request.jwt.claims='{}';
set role authenticated;
do $$declare feed jsonb; report jsonb;begin
 feed:=production_live_feed('10000000-0000-0000-0000-000000000001');
 if jsonb_array_length(feed->'staff')<>0 then raise exception 'Staff hours preloaded without password';end if;
 report:=production_control_report('10000000-0000-0000-0000-000000000001',current_date-1,current_date+1);
 if jsonb_array_length(report->'operators')<>0 or jsonb_array_length(report->'teams')<>0 then raise exception 'Productivity leaked in ordinary report';end if;
 begin perform production_staff_hours('10000000-0000-0000-0000-000000000001');raise exception 'Staff hours without password';exception when insufficient_privilege then null;end;
 begin perform production_hours_report('10000000-0000-0000-0000-000000000001','a',current_date,current_date);raise exception 'Employee monthly hours without password';exception when insufficient_privilege then null;end;
 begin perform production_productivity_report('10000000-0000-0000-0000-000000000001',current_date,current_date);raise exception 'Score without password';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('iat',extract(epoch from clock_timestamp()),'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())-600)))::text,true);
 begin perform production_report_access('10000000-0000-0000-0000-000000000001');raise exception 'Refresh bypassed password';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp()))))::text,true);
 perform production_report_access('10000000-0000-0000-0000-000000000001');
 perform production_staff_hours('10000000-0000-0000-0000-000000000001');
 perform production_hours_report('10000000-0000-0000-0000-000000000001','a',current_date,current_date);
 perform production_productivity_report('10000000-0000-0000-0000-000000000001',current_date,current_date);
 begin perform production_report_access('10000000-0000-0000-0000-000000000099');raise exception 'Cross tenant report access';exception when insufficient_privilege then null;end;
 begin perform production_hours_report_before_password('10000000-0000-0000-0000-000000000001','a',current_date,current_date);raise exception 'Private bypass exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$begin
 -- Production employees keep their own personal daily/monthly hours.
 perform production_hours_report('10000000-0000-0000-0000-000000000001','a',current_date,current_date);
 perform production_live_feed('10000000-0000-0000-0000-000000000001');
 begin perform production_report_access('10000000-0000-0000-0000-000000000001');raise exception 'Worker unlocked staff';exception when insufficient_privilege then null;end;
end $$;
reset role;
update company_members set role='office' where user_id='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$begin
 begin perform production_hours_report('10000000-0000-0000-0000-000000000001','b',current_date,current_date);raise exception 'Office used own password to read staff';exception when insufficient_privilege then null;end;
 perform production_control_report('10000000-0000-0000-0000-000000000001',current_date,current_date);
end $$;
reset role;
rollback;
