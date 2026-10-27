\set ON_ERROR_STOP on
\ir ../migrations/20261027_cloud_save_arrays.sql
\ir ../migrations/20261027_cloud_save_arrays.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"session_id":"save-arrays-test"}',true);
update erp_snapshots set payload=payload||'{
 "estimates":[{"id":"safe-est","status":"Approvato","vehicleId":"safe-v","total":100}],
 "jobs":[{"id":"safe-j","estimateId":"safe-est","total":100,"status":"In lavorazione"}],
 "vehicles":[{"id":"safe-v","expectedRevenue":100}]
}'::jsonb where company_id='10000000-0000-0000-0000-000000000001';
do $$declare before_count int;begin
 select count(*) into before_count from confirmed_estimate_revisions;
 update erp_snapshots set payload=jsonb_set(payload,'{operationalTest}','true') where company_id='10000000-0000-0000-0000-000000000001';
 if (select count(*) from confirmed_estimate_revisions)<>before_count then raise exception 'Operational save created audit';end if;
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','101') where company_id='10000000-0000-0000-0000-000000000001';
  raise exception 'Password bypass';
 exception when insufficient_privilege then null;end;
 perform production_private_password('10000000-0000-0000-0000-000000000001','set',null,'save-arrays-password');
 perform production_private_password('10000000-0000-0000-0000-000000000001','unlock','save-arrays-password');
 update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','101') where company_id='10000000-0000-0000-0000-000000000001';
 if (select count(*) from confirmed_estimate_revisions)<>before_count+1 then raise exception 'Owner edit audit missing';end if;
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{estimates}',(payload->'estimates')||(payload->'estimates')) where company_id='10000000-0000-0000-0000-000000000001';
  raise exception 'Duplicate bypass';
 exception when raise_exception then if sqlerrm<>'Identificativo preventivo duplicato.' then raise;end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{jobs,0,total}','500') where company_id='10000000-0000-0000-0000-000000000001';
  raise exception 'Linked economic fields unprotected';
 exception when insufficient_privilege then null;end;
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{vehicles,0,expectedRevenue}','500') where company_id='10000000-0000-0000-0000-000000000001';
  raise exception 'Vehicle value unprotected';
 exception when insufficient_privilege then null;end;
 update erp_snapshots set payload=jsonb_set(payload,'{jobs,0,status}','"Da fare"') where company_id='10000000-0000-0000-0000-000000000001';
end $$;
rollback;
