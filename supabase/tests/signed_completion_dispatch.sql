\set ON_ERROR_STOP on
create schema if not exists extensions;
create extension if not exists pgcrypto;
do $$begin
 if to_regprocedure('extensions.hmac(text,text,text)') is null then
  execute 'create function extensions.hmac(text,text,text) returns bytea language sql immutable as ''select public.hmac($1,$2,$3)''';
 end if;
end $$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets(id uuid primary key,name text,decrypted_secret text);
\ir ../migrations/20261030065306_signed_completion_dispatch.sql
begin;
insert into companies(id,name) values('94000000-0000-0000-0000-000000000009','Signed dispatch fixture');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('94000000-0000-0000-0000-000000000009',10,'{"jobs":[],"vehicles":[],"plannerSettings":{"operators":[]},"operatorPrograms":[]}','00000000-0000-0000-0000-000000000001');
insert into vault.decrypted_secrets values(gen_random_uuid(),'production_completion_worker',repeat('a',64));
insert into production_completion_worker(singleton,endpoint,secret_hash) values(true,'https://example.invalid',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
select production_completion_enqueue('94000000-0000-0000-0000-000000000009');
do $$declare expires bigint:=extract(epoch from clock_timestamp())::bigint+120;signature text;claim jsonb;begin
 signature:=encode(extensions.hmac('94000000-0000-0000-0000-000000000009:'||expires::text,repeat('a',64),'sha256'),'hex');
 if production_completion_claim('94000000-0000-0000-0000-000000000009',repeat('a',64),expires) is not null then raise exception 'Raw or forged token accepted';end if;
 if production_completion_claim('94000000-0000-0000-0000-000000000008',signature,expires) is not null then raise exception 'Signature accepted for another company';end if;
 if production_completion_claim('94000000-0000-0000-0000-000000000009',signature,1) is not null then raise exception 'Expired signature accepted';end if;
 claim:=production_completion_claim('94000000-0000-0000-0000-000000000009',signature,expires);
 if claim is null then raise exception 'Signed request rejected';end if;
 if production_completion_claim('94000000-0000-0000-0000-000000000009',signature,expires) is not null then raise exception 'Replay bypassed lease';end if;
 if has_function_privilege('service_role','production_completion_claim_before_signed_dispatch(uuid,text)','execute') then raise exception 'Legacy raw token endpoint exposed';end if;
end $$;
rollback;
