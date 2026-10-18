\set ON_ERROR_STOP on
\ir ../updates/20261018_separate_private_password.sql
\ir ../migrations/20261018_separate_private_password.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims',jsonb_build_object('session_id','owner-device','amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp()))))::text,true);
update erp_snapshots set payload=jsonb_set(payload,'{estimates}',coalesce(payload->'estimates','[]')||'[{"id":"private-e","status":"Approvato","total":100}]') where company_id='10000000-0000-0000-0000-000000000001';
set role authenticated;
do $$declare r jsonb;begin
 -- A fresh shared account login alone grants no private access.
 begin update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','200') where company_id='10000000-0000-0000-0000-000000000001';raise exception 'Shared login edited confirmed quote';exception when insufficient_privilege then null;end;
 begin perform production_report_access('10000000-0000-0000-0000-000000000001');raise exception 'Shared login unlocked private reports';exception when insufficient_privilege then null;end;
 r:=production_private_password('10000000-0000-0000-0000-000000000001','set',null,'private-test-123');
 if not (r->>'ok')::boolean then raise exception 'Initial configuration failed';end if;
 r:=production_private_password('10000000-0000-0000-0000-000000000001','unlock','wrong-test');
 if (r->>'ok')::boolean then raise exception 'Wrong private password accepted';end if;
 r:=production_private_password('10000000-0000-0000-0000-000000000001','unlock','private-test-123');
 perform production_report_access('10000000-0000-0000-0000-000000000001');
 perform production_staff_hours('10000000-0000-0000-0000-000000000001');
 update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','200') where company_id='10000000-0000-0000-0000-000000000001';
 -- Same shared account, separate login session: no unlock inheritance.
 perform set_config('request.jwt.claims','{"session_id":"office-device"}',true);
 begin perform production_report_access('10000000-0000-0000-0000-000000000001');raise exception 'Shared account inherited another device grant';exception when insufficient_privilege then null;end;
 r:=production_private_password('10000000-0000-0000-0000-000000000001','set','wrong-test','new-private-456');
 if (r->>'ok')::boolean then raise exception 'Office reset secret using shared account';end if;
 perform set_config('request.jwt.claims','{"session_id":"owner-device"}',true);
 r:=production_private_password('10000000-0000-0000-0000-000000000001','set','private-test-123','new-private-456');
 begin perform production_report_access('10000000-0000-0000-0000-000000000001');raise exception 'Rotation retained old grant';exception when insufficient_privilege then null;end;
 r:=production_private_password('10000000-0000-0000-0000-000000000001','unlock','new-private-456');
 perform production_report_access('10000000-0000-0000-0000-000000000001');
 begin perform password_hash from production_private_passwords;raise exception 'Hash exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if (select password_hash='new-private-456' from production_private_passwords where company_id='10000000-0000-0000-0000-000000000001') then raise exception 'Plaintext password stored';end if;
end $$;
update production_private_grants set expires_at=now()-interval '1 second';
set role authenticated;
do $$declare r jsonb;begin
 begin perform production_report_access('10000000-0000-0000-0000-000000000001');raise exception 'Expired private grant accepted';exception when insufficient_privilege then null;end;
 for i in 1..5 loop r:=production_private_password('10000000-0000-0000-0000-000000000001','unlock','wrong-test');end loop;
 r:=production_private_password('10000000-0000-0000-0000-000000000001','unlock','new-private-456');
 if (r->>'ok')::boolean then raise exception 'Lockout bypassed';end if;
end $$;
reset role;
rollback;
