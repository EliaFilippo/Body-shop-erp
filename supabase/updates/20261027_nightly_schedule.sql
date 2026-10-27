-- Deploy Edge Function nightly-planner FIRST, with JWT verification disabled.
-- Authentication is a generated private token, checked by the database. Never paste a personal key here.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
begin;
do $setup$
declare token text;company uuid:='aa49d334-492f-4daa-aa7e-5d5c022308b7';
begin
 if not exists(select 1 from public.erp_snapshots where company_id=company) then raise exception 'Archivio aziendale non trovato';end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='elias_nightly_planning_token' limit 1;
 if token is null then token:=encode(gen_random_bytes(32),'hex');perform vault.create_secret(token,'elias_nightly_planning_token');end if;
 insert into public.production_nightly_settings(company_id,run_hour,secret_hash) values(company,3,encode(digest(token,'sha256'),'hex'))
 on conflict(company_id) do update set enabled=true,run_hour=3,secret_hash=excluded.secret_hash;
end $setup$;
create or replace function public.production_dispatch_nightly()
returns void language plpgsql security definer set search_path=public,pg_temp as $dispatch$
declare token text;config record;stamp timestamptz:=clock_timestamp();hour integer;day date;
begin
 hour:=extract(hour from stamp at time zone 'Europe/Rome');day:=(stamp at time zone 'Europe/Rome')::date;
 select decrypted_secret into token from vault.decrypted_secrets where name='elias_nightly_planning_token' limit 1;
 if token is null then return;end if;
 for config in select * from production_nightly_settings where enabled and hour>=run_hour and hour<run_hour+4 loop
  if production_nightly_busy(config.company_id) or exists(select 1 from production_nightly_runs r where r.company_id=config.company_id and r.run_date=day and (r.status='completed' or r.lease_until>stamp)) then continue;end if;
  perform net.http_post(url:='https://uhlfmwkyguilvehavwwf.supabase.co/functions/v1/nightly-planner',
   headers:=jsonb_build_object('Content-Type','application/json','x-planning-secret',token),
   body:=jsonb_build_object('companyId',config.company_id),timeout_milliseconds:=60000);
 end loop;
end $dispatch$;
revoke all on function public.production_dispatch_nightly() from public,anon,authenticated;
select cron.schedule('elias-nightly-planning','*/15 * * * *','select public.production_dispatch_nightly()');
commit;
-- One successful plan per day; retry every 15 minutes from 03:00 to 06:59 Europe/Rome.
-- PC/tablet power state is not a completion signal. Close actual work timers before leaving.
