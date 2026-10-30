begin;
-- Deployment configuration. The plaintext worker token never leaves Vault.
do $$declare token text;begin
 select decrypted_secret into token from vault.decrypted_secrets where name='production_completion_worker' limit 1;
 if token is null then
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  perform vault.create_secret(token,'production_completion_worker','Internal phase-completion planning worker');
 end if;
 insert into public.production_completion_worker(singleton,endpoint,secret_hash)
 values(true,'https://uhlfmwkyguilvehavwwf.supabase.co/functions/v1/completion-planner',encode(sha256(convert_to(token,'UTF8')),'hex'))
 on conflict(singleton) do update set endpoint=excluded.endpoint,secret_hash=excluded.secret_hash;
end $$;
select cron.schedule('elias-completion-planning-retry','* * * * *','select public.production_completion_dispatch_pending()');
-- Initialize the derived view for existing enabled companies without fabricating signatures.
do $$declare entry record;begin
 for entry in select s.company_id from public.erp_snapshots s join public.production_nightly_settings n using(company_id) where n.enabled
 and exists(select 1 from jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where coalesce(j->>'status','') not in ('Consegnata','Annullata')) loop
  perform public.production_completion_enqueue(entry.company_id);
 end loop;
end $$;
commit;
