begin;
alter table public.production_pin_accounts add column if not exists qr_pairing_hash text;

create or replace function public.production_pin_clear_qr()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.pairing_hash is distinct from old.pairing_hash then
    new.qr_pairing_hash := null;
  end if;
  return new;
end $$;
revoke all on function public.production_pin_clear_qr() from public,anon,authenticated,service_role;
create trigger production_pin_clear_qr before update of pairing_hash on public.production_pin_accounts
  for each row execute function public.production_pin_clear_qr();

create or replace function public.production_pin_access(p_company_id uuid,p_operator_id text,p_pairing text,p_pin text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare account production_pin_accounts; op jsonb;
begin
  select * into account from production_pin_accounts where company_id=p_company_id and operator_id=p_operator_id for update;
  if account.user_id is null then return null; end if;
  if encode(digest(coalesce(p_pairing,''),'sha256'),'hex') is distinct from account.pairing_hash
    and encode(digest(coalesce(p_pairing,''),'sha256'),'hex') is distinct from account.qr_pairing_hash
    then return null; end if;
  if not exists(select 1 from company_members where company_id=p_company_id and user_id=account.user_id and active and role='production')
    or not exists(select 1 from production_profiles where company_id=p_company_id and user_id=account.user_id and operator_id=p_operator_id)
    then return null; end if;
  select o into op from erp_snapshots s,jsonb_array_elements(s.payload->'plannerSettings'->'operators') o
    where s.company_id=p_company_id and o->>'id'=p_operator_id and (o->>'active')::boolean;
  if op is null then return null; end if;
  if p_pin is null then return jsonb_build_object('name',op->>'name'); end if;
  if account.locked_until>now() then return jsonb_build_object('blocked',true); end if;
  if account.locked_until is not null then account.failures:=0; end if;
  if p_pin !~ '^[0-9]{6}$' or crypt(p_pin,account.pin_hash)<>account.pin_hash then
    update production_pin_accounts set failures=account.failures+1,
      locked_until=case when account.failures+1>=5 then now()+interval '15 minutes' else null end
      where company_id=p_company_id and operator_id=p_operator_id;
    return jsonb_build_object('blocked',account.failures+1>=5);
  end if;
  update production_pin_accounts set failures=0,locked_until=null where company_id=p_company_id and operator_id=p_operator_id;
  return jsonb_build_object('userId',account.user_id,'name',op->>'name');
end $$;

-- The Edge Function derives the token. Only its hash is persisted.
create or replace function public.production_pin_register_qr(
  p_owner_id uuid,p_company_id uuid,p_operator_id text,p_expected_hash text,p_pairing text
)
returns boolean language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if p_pairing is null or p_pairing !~ '^[0-9a-f]{64}$' then return false; end if;
  if not exists(select 1 from company_members
    where company_id=p_company_id and user_id=p_owner_id and role='owner' and active)
    then return false; end if;

  update production_pin_accounts a
  set qr_pairing_hash=encode(digest(p_pairing,'sha256'),'hex')
  where a.company_id=p_company_id and a.operator_id=p_operator_id and a.pairing_hash=p_expected_hash
    and exists(select 1 from production_profiles p join company_members m using(company_id,user_id)
      where p.company_id=a.company_id and p.operator_id=a.operator_id and p.user_id=a.user_id
        and m.role='production' and m.active)
    and exists(select 1 from erp_snapshots s,
      jsonb_array_elements(s.payload->'plannerSettings'->'operators') o
      where s.company_id=a.company_id and o->>'id'=a.operator_id and (o->>'active')::boolean);
  return found;
end $$;
revoke all on function public.production_pin_register_qr(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.production_pin_register_qr(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
