begin;
-- Authenticate each dispatch with a company-scoped, expiring MAC. The durable
-- Vault token is never copied into pg_net's extension-managed request tables.
create or replace function public.production_completion_dispatch(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare endpoint text;secret text;expires bigint;signature text;
begin
 if to_regnamespace('net') is null or to_regnamespace('vault') is null then return;end if;
 select w.endpoint into endpoint from production_completion_worker w where singleton;
 if endpoint is null then return;end if;
 update production_completion_queue set last_dispatch_at=clock_timestamp()
 where company_id=p_company_id and generation>applied_generation
 and coalesce(lease_until,'-infinity')<clock_timestamp()
 and coalesce(last_dispatch_at,'-infinity')<clock_timestamp()-interval '3 seconds';
 if not found then return;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='production_completion_worker' limit 1;
 if secret is null then return;end if;
 expires:=extract(epoch from clock_timestamp())::bigint+120;
 signature:=encode(extensions.hmac(p_company_id::text||':'||expires::text,secret,'sha256'),'hex');
 perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-planning-secret',signature,'x-planning-expires',expires::text),body:=jsonb_build_object('companyId',p_company_id),timeout_milliseconds:=60000);
exception when others then return;
end $$;
revoke all on function production_completion_dispatch(uuid) from public,anon,authenticated,service_role;
do $$begin
 if to_regprocedure('public.production_completion_claim_before_signed_dispatch(uuid,text)') is null then
  alter function public.production_completion_claim(uuid,text) rename to production_completion_claim_before_signed_dispatch;
 end if;
end $$;
revoke all on function production_completion_claim_before_signed_dispatch(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.production_completion_claim(p_company_id uuid,p_secret text,p_expires bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare secret text;stamp bigint:=extract(epoch from clock_timestamp())::bigint;
begin
 if p_expires is null or p_expires<stamp or p_expires>stamp+180 then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='production_completion_worker' limit 1;
 if secret is null or p_secret is distinct from encode(extensions.hmac(p_company_id::text||':'||p_expires::text,secret,'sha256'),'hex') then return null;end if;
 return production_completion_claim_before_signed_dispatch(p_company_id,secret);
end $$;
revoke all on function production_completion_claim(uuid,text,bigint) from public,anon,authenticated;
grant execute on function production_completion_claim(uuid,text,bigint) to service_role;
-- Invalidate the bootstrap token used before signed dispatch was installed.
do $$declare key_id uuid;token text;begin
 select id into key_id from vault.decrypted_secrets where name='production_completion_worker' limit 1;
 if key_id is not null then
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  perform vault.update_secret(key_id,token);
  update production_completion_worker set secret_hash=encode(sha256(convert_to(token,'UTF8')),'hex') where singleton;
 end if;
end $$;
notify pgrst,'reload schema';
commit;
