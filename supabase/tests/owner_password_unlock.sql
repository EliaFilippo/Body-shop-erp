\set ON_ERROR_STOP on
-- Disposable CI fixture only.
create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
\ir ../migrations/20261004_owner_password_unlock.sql
begin;
grant usage on schema auth to authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload='{"estimates":[{"id":"e1","status":"Approvato","total":183}]}' where company_id='10000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','244'),updated_by=auth.uid();
  raise exception 'Missing password accepted';
 exception when insufficient_privilege then if sqlerrm not like 'Inserisci nuovamente%' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('iat',extract(epoch from clock_timestamp()),'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())-600)))::text,true);
 begin
  update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','244'),updated_by=auth.uid();
  raise exception 'Fresh refresh token bypassed password';
 exception when insufficient_privilege then if sqlerrm not like 'Inserisci nuovamente%' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp()))))::text,true);
 update erp_snapshots set payload=jsonb_set(payload,'{estimates,0,total}','244'),updated_by=auth.uid();
end $$;
reset role;
rollback;
