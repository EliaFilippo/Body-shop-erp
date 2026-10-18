begin;
create extension if not exists pgcrypto;
create table if not exists public.production_private_passwords(
 company_id uuid primary key references companies(id), password_hash text not null,
 failures integer not null default 0, locked_until timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.production_private_grants(
 company_id uuid not null references companies(id), user_id uuid not null references auth.users(id),
 session_key text not null, expires_at timestamptz not null,
 primary key(company_id,user_id,session_key)
);
alter table public.production_private_passwords enable row level security;
alter table public.production_private_grants enable row level security;
revoke all on public.production_private_passwords,public.production_private_grants from public,anon,authenticated;
create or replace function public.production_private_hash(p_password text,p_hash text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare ns text; result text;
begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
 if p_hash is null then execute format('select %I.crypt($1,%I.gen_salt(''bf'',10))',ns,ns) into result using p_password;
 else execute format('select %I.crypt($1,$2)',ns) into result using p_password,p_hash;end if;
 return result;
end $$;
revoke all on function public.production_private_hash(text,text) from public,anon,authenticated;
create or replace function public.production_private_password(p_company_id uuid,p_action text default 'status',p_password text default null,p_new_password text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare saved production_private_passwords%rowtype; sid text:=nullif(auth.jwt()->>'session_id',''); stamp timestamptz:=clock_timestamp();
begin
 if not is_company_owner(p_company_id) then raise exception 'Accesso riservato al titolare' using errcode='42501';end if;
 if p_action not in ('status','set','unlock') then raise exception 'Operazione non valida';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select * into saved from production_private_passwords where company_id=p_company_id for update;
 if p_action='status' then return jsonb_build_object('configured',saved.company_id is not null);end if;
 if sid is null then raise exception 'Esci e accedi nuovamente al gestionale prima di usare la password dei blocchi.';end if;
 if saved.locked_until>stamp then return jsonb_build_object('ok',false,'message','Troppi tentativi. Riprova tra 15 minuti.');end if;
 if p_action='unlock' or saved.company_id is not null then
  if saved.company_id is null or p_password is null or octet_length(p_password)>72 or production_private_hash(p_password,saved.password_hash) is distinct from saved.password_hash then
   if saved.company_id is not null then update production_private_passwords set failures=case when failures>=4 then 0 else failures+1 end,
    locked_until=case when failures>=4 then stamp+interval '15 minutes' else null end where company_id=p_company_id;end if;
   return jsonb_build_object('ok',false,'message','Password dei blocchi non corretta.');
  end if;
 end if;
 if p_action='set' then
  if p_new_password is null or char_length(p_new_password)<8 or octet_length(p_new_password)>72 then raise exception 'Scegli una password di almeno 8 caratteri e massimo 72 byte.';end if;
  insert into production_private_passwords(company_id,password_hash) values(p_company_id,production_private_hash(p_new_password))
   on conflict(company_id) do update set password_hash=excluded.password_hash,failures=0,locked_until=null,updated_at=stamp;
  delete from production_private_grants where company_id=p_company_id;
 else
  update production_private_passwords set failures=0,locked_until=null where company_id=p_company_id;
  insert into production_private_grants(company_id,user_id,session_key,expires_at) values(p_company_id,auth.uid(),sid,stamp+interval '5 minutes')
   on conflict(company_id,user_id,session_key) do update set expires_at=excluded.expires_at;
 end if;
 return jsonb_build_object('ok',true,'configured',true);
end $$;
revoke all on function public.production_private_password(uuid,text,text,text) from public,anon;
grant execute on function public.production_private_password(uuid,text,text,text) to authenticated;
-- Account login or password refresh cannot unlock private reports; only this specific signed-in session has a grant.
create or replace function public.production_owner_password_recent(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select is_company_owner(p_company_id) and exists(select 1 from production_private_grants
  where company_id=p_company_id and user_id=auth.uid() and session_key=auth.jwt()->>'session_id' and expires_at>statement_timestamp());
$$;
revoke all on function public.production_owner_password_recent(uuid) from public,anon,authenticated;
create or replace function public.production_report_access(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not production_owner_password_recent(p_company_id) then raise exception 'Inserisci la password dei blocchi per accedere a preventivi confermati e report riservati.' using errcode='42501';end if;
end $$;
revoke all on function public.production_report_access(uuid) from public,anon;
grant execute on function public.production_report_access(uuid) to authenticated;
create or replace function public.require_recent_owner_password()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; previous jsonb; revised jsonb;
begin
 if not is_company_owner(old.company_id) then return new;end if;
 foreach kind in array array['estimates','quotes'] loop
  for previous in select value from jsonb_array_elements(coalesce(old.payload->kind,'[]')) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null)) or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(coalesce(new.payload->kind,'[]')) where value->>'id'=previous->>'id';
    if (case when kind='quotes' then revised-'invoiceId'-'updatedAt' else revised end) is distinct from (case when kind='quotes' then previous-'invoiceId'-'updatedAt' else previous end)
     and not production_owner_password_recent(old.company_id) then raise exception 'Inserisci la password dei blocchi per modificare il preventivo confermato.' using errcode='42501';end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.require_recent_owner_password() from public,anon,authenticated;
commit;
