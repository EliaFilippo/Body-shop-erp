\set ON_ERROR_STOP on
\ir ../migrations/20261025_read_without_private_password.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"session_id":"read-only-device"}',true);
update erp_snapshots set payload=jsonb_set(payload,'{estimates}','[{"id":"read-e","status":"Approvato","total":100}]') where company_id='10000000-0000-0000-0000-000000000001';
set role authenticated;
select production_report_access('10000000-0000-0000-0000-000000000001');
select production_staff_hours('10000000-0000-0000-0000-000000000001');
do $$begin
 begin update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','200') where company_id='10000000-0000-0000-0000-000000000001';raise exception 'Reading unlocked writes';exception when insufficient_privilege then null;end;
end $$;
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform production_report_access('10000000-0000-0000-0000-000000000001');raise exception 'Worker report access';exception when insufficient_privilege then null;end;
end $$;
rollback;
