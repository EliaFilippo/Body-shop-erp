\set ON_ERROR_STOP on
\ir ../migrations/20261030071553_immediate_completion_dispatch.sql
begin;
create schema if not exists net;
create table net.test_completion_requests(id bigint generated always as identity,headers jsonb,body jsonb);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
returns bigint language plpgsql as $$declare result bigint;begin
 insert into net.test_completion_requests(headers,body) values(headers,body) returning id into result;return result;
end $$;
insert into companies(id,name) values('97000000-0000-0000-0000-000000000009','Rapid completion fixture');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('97000000-0000-0000-0000-000000000009',10,'{"jobs":[],"vehicles":[],"plannerSettings":{"operators":[]},"operatorPrograms":[]}','00000000-0000-0000-0000-000000000001');
insert into vault.decrypted_secrets values(gen_random_uuid(),'production_completion_worker',repeat('a',64));
insert into production_completion_worker(singleton,endpoint,secret_hash) values(true,'https://example.invalid',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
select production_completion_enqueue('97000000-0000-0000-0000-000000000009');
do $$declare headers jsonb;claim jsonb;plan jsonb;begin
 if (select count(*) from net.test_completion_requests)<>1 then raise exception 'Initial dispatch missing';end if;
 select r.headers into headers from net.test_completion_requests r limit 1;
 if headers->>'x-planning-secret'=repeat('a',64) then raise exception 'Durable token copied to transport';end if;
 claim:=production_completion_claim('97000000-0000-0000-0000-000000000009',headers->>'x-planning-secret',(headers->>'x-planning-expires')::bigint);
 if claim is null then raise exception 'Dispatched signature invalid';end if;
 perform production_completion_enqueue('97000000-0000-0000-0000-000000000009');
 if (select count(*) from net.test_completion_requests)<>1 then raise exception 'Active lease did not coalesce';end if;
 perform production_completion_failed('97000000-0000-0000-0000-000000000009',(claim->>'id')::uuid);
 claim:=production_completion_claim('97000000-0000-0000-0000-000000000009',headers->>'x-planning-secret',(headers->>'x-planning-expires')::bigint);
 plan:=jsonb_build_object('generation',(claim->>'generation')::bigint,'generatedAt',clock_timestamp(),'operatorPrograms','[]'::jsonb,'forecasts','[]'::jsonb);
 if not production_completion_commit('97000000-0000-0000-0000-000000000009',(claim->>'id')::uuid,(claim->>'generation')::bigint,10,plan) then raise exception 'Plan commit failed';end if;
 perform production_completion_enqueue('97000000-0000-0000-0000-000000000009');
 if (select count(*) from net.test_completion_requests)<>2 then raise exception 'Sequential completion throttled';end if;
end $$;
rollback;
