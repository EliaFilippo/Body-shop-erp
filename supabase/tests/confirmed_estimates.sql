\set ON_ERROR_STOP on
-- Run only in the disposable CI database after the existing production fixtures.
\ir ../migrations/20261004_confirmed_estimates.sql
begin;
insert into company_members(company_id,user_id,display_name,role) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','Office','office');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload='{"estimates":[{"id":"e1","status":"Approvato","total":183,"vehicleId":"v1"}],"jobs":[{"id":"job1","estimateId":"e1","total":183,"status":"Da pianificare"}],"vehicles":[{"id":"v1","expectedRevenue":150}]}' where company_id='10000000-0000-0000-0000-000000000001';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
set role authenticated;
do $$begin
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','244'),updated_by=auth.uid();
  raise exception 'Office changed locked price';
 exception when insufficient_privilege then null; end;
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{estimates}','[]'),updated_by=auth.uid();
  raise exception 'Office deleted confirmed quote';
 exception when insufficient_privilege then null; end;
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{jobs,0,total}','244'),updated_by=auth.uid();
  raise exception 'Office bypassed lock through job';
 exception when insufficient_privilege then null; end;
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{vehicles,0,expectedRevenue}','200'),updated_by=auth.uid();
  raise exception 'Office bypassed lock through vehicle';
 exception when insufficient_privilege then null; end;
 update erp_snapshots set payload=jsonb_set(payload,'{jobs,0,status}','"In lavorazione"'),updated_by=auth.uid();
end $$;
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set role authenticated;
update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','244'),updated_by=auth.uid();
do $$begin
 if not exists(select 1 from confirmed_estimate_revisions where document_id='e1' and previous_document->>'total'='183' and revised_document->>'total'='244') then raise exception 'Missing immutable owner audit'; end if;
end $$;
reset role;
rollback;
