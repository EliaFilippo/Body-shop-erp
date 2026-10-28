\set ON_ERROR_STOP on
\ir ../migrations/20261028134614_partial_cloud_save.sql
\ir ../migrations/20261028134614_partial_cloud_save.sql
begin;
insert into companies(id,name) values('93000000-0000-0000-0000-000000000009','Partial save fixture');
insert into company_members(company_id,user_id,display_name,role) values
('93000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','Owner','owner'),
('93000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000002','Office','office'),
('93000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000003','Worker','production');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('93000000-0000-0000-0000-000000000009',1,
'{"vehicles":[{"id":"v","plate":"TEST"}],"estimates":[{"id":"e","status":"Approvato","vehicleId":"v","total":100}],"jobs":[{"id":"j","estimateId":"e","total":100}],"operatorProgramHistory":[{"id":"keep-history"}],"obsolete":true}',
'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$declare receipt jsonb;begin
 select to_jsonb(r) into receipt from erp_update_snapshot_sections('93000000-0000-0000-0000-000000000009',1,'{"vehicles":[{"id":"v","plate":"TEST"},{"id":"morning-car","plate":"NEWCAR"}]}',array['obsolete']) r;
 if receipt->>'revision'<>'2' or receipt ? 'payload' then raise exception 'Invalid compact save acknowledgement';end if;
 if exists(select 1 from erp_update_snapshot_sections('93000000-0000-0000-0000-000000000009',1,'{"vehicles":[]}')) then raise exception 'Stale revision overwrote new records';end if;
 begin perform erp_update_snapshot_sections('93000000-0000-0000-0000-000000000009',2,'{"estimates":[{"id":"e","status":"Approvato","vehicleId":"v","total":101}]}');raise exception 'Quote password bypass';exception when insufficient_privilege then null;end;
 begin perform erp_update_snapshot_sections('94000000-0000-0000-0000-000000000009',1,'{}');raise exception 'Tenant bypass';exception when insufficient_privilege then null;end;
 begin perform erp_update_snapshot_sections('93000000-0000-0000-0000-000000000009',2,'[]');raise exception 'Invalid section accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$begin
 if not exists(select 1 from erp_snapshots where company_id='93000000-0000-0000-0000-000000000009' and revision=2 and jsonb_array_length(payload->'vehicles')=2 and payload->'operatorProgramHistory'->0->>'id'='keep-history' and not(payload ? 'obsolete')) then raise exception 'Partial save lost history or new vehicle';end if;
 if not exists(select 1 from production_read_snapshots where company_id='93000000-0000-0000-0000-000000000009' and revision=2 and jsonb_array_length(payload->'vehicles')=2) then raise exception 'Tablet projection not updated';end if;
 if has_function_privilege('anon','erp_update_snapshot_sections(uuid,bigint,jsonb,text[])','execute') then raise exception 'Anonymous write endpoint';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$begin
 begin perform erp_update_snapshot_sections('93000000-0000-0000-0000-000000000009',2,'{"jobs":[{"id":"j","estimateId":"e","total":101}]}');raise exception 'Economic guard bypass';exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$begin
 begin perform erp_update_snapshot_sections('93000000-0000-0000-0000-000000000009',2,'{}');raise exception 'Production write access';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
