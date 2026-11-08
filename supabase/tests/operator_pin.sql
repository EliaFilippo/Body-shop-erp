\set ON_ERROR_STOP on
create role service_role;
\ir ../migrations/20261005_operator_pin.sql
\ir ../migrations/20261108081236_operator_tablet_qr.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,operators}',payload->'plannerSettings'->'operators'||'[{"id":"pin-test","name":"Stefania","active":true}]');
select production_pin_configure('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pin-test','00000000-0000-0000-0000-000000000004','483927',repeat('a',64));
do $$declare attempt jsonb; begin
  if (select role from company_members where user_id='00000000-0000-0000-0000-000000000004')<>'production' then raise exception 'Office access granted'; end if;
  if production_pin_access('10000000-0000-0000-0000-000000000001','pin-test',repeat('b',64),'483927') is not null then raise exception 'Pairing bypassed'; end if;
  for i in 1..5 loop
    attempt:=production_pin_access('10000000-0000-0000-0000-000000000001','pin-test',repeat('a',64),'000000');
    if attempt ? 'userId' then raise exception 'Wrong PIN accepted'; end if;
  end loop;
  if not (attempt->>'blocked')::boolean then raise exception 'Missing rate limit'; end if;
  if production_pin_access('10000000-0000-0000-0000-000000000001','pin-test',repeat('a',64),'483927') ? 'userId' then raise exception 'Lock bypassed'; end if;
end $$;
update production_pin_accounts set locked_until=now()-interval '1 minute';
do $$begin
  if production_pin_access('10000000-0000-0000-0000-000000000001','pin-test',repeat('a',64),'483927')->>'userId'<>'00000000-0000-0000-0000-000000000004' then raise exception 'Identity lost'; end if;
  if (select pin_hash from production_pin_accounts where operator_id='pin-test')='483927' then raise exception 'Plaintext PIN stored'; end if;
  begin
    perform production_pin_configure('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','pin-test','00000000-0000-0000-0000-000000000004','392784',repeat('c',64));
    raise exception 'Worker configured PIN';
  exception when raise_exception then if sqlerrm not like 'Solo il titolare%' then raise; end if; end;
end $$;
do $$
declare company constant uuid := '10000000-0000-0000-0000-000000000001';
  owner_id constant uuid := '00000000-0000-0000-0000-000000000001';
  worker_id constant uuid := '00000000-0000-0000-0000-000000000004';
  legacy_hash text;
begin
  select pairing_hash into legacy_hash from production_pin_accounts where company_id=company and operator_id='pin-test';
  if production_pin_register_qr(worker_id,company,'pin-test',legacy_hash,repeat('b',64))
    then raise exception 'Worker registered QR'; end if;
  if production_pin_register_qr(owner_id,company,'pin-test',repeat('0',64),repeat('b',64))
    then raise exception 'Stale registration replaced a current QR'; end if;
  if not production_pin_register_qr(owner_id,company,'pin-test',legacy_hash,repeat('b',64))
    then raise exception 'Owner QR not registered'; end if;
  if production_pin_access(company,'pin-test',repeat('b',64),null)->>'name' is distinct from 'Stefania'
    then raise exception 'QR does not identify operator'; end if;
  if production_pin_access(company,'pin-test',repeat('b',64),'000000') ? 'userId'
    then raise exception 'QR bypasses PIN'; end if;
  if production_pin_access(company,'pin-test',repeat('b',64),'483927')->>'userId' is distinct from worker_id::text
    then raise exception 'QR PIN login failed'; end if;
  if production_pin_access(company,'pin-test',repeat('a',64),'483927')->>'userId' is distinct from worker_id::text
    then raise exception 'Legacy pairing lost'; end if;
  if has_function_privilege('authenticated','production_pin_register_qr(uuid,uuid,text,text,text)','execute')
    then raise exception 'Direct QR registration permitted'; end if;
end $$;
set role authenticated;
do $$begin
  begin perform production_pin_access('10000000-0000-0000-0000-000000000001','pin-test',repeat('a',64),'483927');raise exception 'Direct PIN RPC permitted';exception when insufficient_privilege then null;end;
  begin perform pin_hash from production_pin_accounts;raise exception 'PIN hashes visible';exception when insufficient_privilege then null;end;
end $$;
reset role;
select production_pin_configure('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','pin-test','00000000-0000-0000-0000-000000000004','392784',repeat('c',64));
do $$begin
  if production_pin_access('10000000-0000-0000-0000-000000000001','pin-test',repeat('a',64),'483927') is not null then raise exception 'Old tablet link accepted'; end if;
  if production_pin_access('10000000-0000-0000-0000-000000000001','pin-test',repeat('b',64),'392784') is not null
    then raise exception 'Old QR accepted after PIN reset'; end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
set role authenticated;
do $$begin if (select count(*) from erp_snapshots)<>0 then raise exception 'PIN worker sees financial data'; end if;end $$;
reset role;
rollback;
