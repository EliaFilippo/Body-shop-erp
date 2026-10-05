-- Solo l'Edge Function può leggere/verificare i PIN. Nessun privilegio ufficio.
create table if not exists public.production_pin_accounts (
  company_id uuid not null references public.companies(id),
  operator_id text not null,
  user_id uuid not null references auth.users(id),
  pin_hash text not null,
  pairing_hash text not null,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key(company_id,operator_id), unique(user_id)
);
alter table public.production_pin_accounts enable row level security;
revoke all on public.production_pin_accounts from public,anon,authenticated;
grant select on public.production_pin_accounts to service_role;

create or replace function public.production_pin_configure(p_owner_id uuid,p_company_id uuid,p_operator_id text,p_user_id uuid,p_pin text,p_pairing text)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare op jsonb;
begin
  if not exists(select 1 from company_members where company_id=p_company_id and user_id=p_owner_id and role='owner' and active)
    then raise exception 'Solo il titolare può configurare i PIN'; end if;
  if p_pin !~ '^[0-9]{6}$' or p_pin ~ '^([0-9])\1{5}$' or p_pin in ('123456','654321') then raise exception 'Scegli un PIN di 6 cifre non ripetute o consecutive'; end if;
  if length(p_pairing)<40 then raise exception 'Collegamento tablet non valido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  select o into op from erp_snapshots s,jsonb_array_elements(s.payload->'plannerSettings'->'operators') o
    where s.company_id=p_company_id and o->>'id'=p_operator_id and (o->>'active')::boolean;
  if op is null then raise exception 'Operatore non attivo'; end if;
  if exists(select 1 from company_members where user_id=p_user_id and (company_id<>p_company_id or role<>'production'))
    then raise exception 'Il PIN non può essere collegato a un account ufficio o titolare'; end if;
  if exists(select 1 from production_pin_accounts where company_id=p_company_id and operator_id=p_operator_id and user_id<>p_user_id)
    then raise exception 'Account PIN già configurato'; end if;
  if exists(select 1 from production_profiles where company_id=p_company_id and operator_id=p_operator_id and user_id<>p_user_id)
    then raise exception 'Operatore già collegato a un altro account: scollegalo prima di attivare il PIN'; end if;
  insert into company_members(company_id,user_id,display_name,role,active) values(p_company_id,p_user_id,op->>'name','production',true)
    on conflict(company_id,user_id) do update set display_name=excluded.display_name;
  insert into production_profiles values(p_company_id,p_user_id,p_operator_id)
    on conflict(company_id,user_id) do update set operator_id=excluded.operator_id;
  insert into production_pin_accounts(company_id,operator_id,user_id,pin_hash,pairing_hash)
    values(p_company_id,p_operator_id,p_user_id,crypt(p_pin,gen_salt('bf',10)),encode(digest(p_pairing,'sha256'),'hex'))
    on conflict(company_id,operator_id) do update set pin_hash=excluded.pin_hash,pairing_hash=excluded.pairing_hash,failures=0,locked_until=null,updated_at=now();
end $$;

create or replace function public.production_pin_access(p_company_id uuid,p_operator_id text,p_pairing text,p_pin text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare account production_pin_accounts; op jsonb;
begin
  select * into account from production_pin_accounts where company_id=p_company_id and operator_id=p_operator_id for update;
  if account.user_id is null or encode(digest(coalesce(p_pairing,''),'sha256'),'hex')<>account.pairing_hash then return null; end if;
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
revoke all on function production_pin_configure(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function production_pin_access(uuid,text,text,text) from public,anon,authenticated;
grant execute on function production_pin_configure(uuid,uuid,text,uuid,text,text),production_pin_access(uuid,text,text,text) to service_role;
