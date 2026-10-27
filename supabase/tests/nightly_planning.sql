\set ON_ERROR_STOP on
do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;
\ir ../migrations/20261027_nightly_planning.sql
\ir ../migrations/20261027_nightly_planning.sql
begin;
insert into companies(id,name) values('60000000-0000-0000-0000-000000000006','Night fixture');
insert into company_members(company_id,user_id,display_name,role) values
('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','Owner','owner'),
('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','A','production');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('60000000-0000-0000-0000-000000000006',10,
'{"customers":[{"id":"keep"}],"invoices":[{"id":"keep-finance"}],"plannerSettings":{"operators":[{"id":"a","name":"A","active":true,"dailyHours":8}]},"jobs":[{"id":"n1","status":"Pianificata"}],"operatorPrograms":[]}',
'00000000-0000-0000-0000-000000000001');
insert into production_nightly_settings(company_id,run_hour,secret_hash) values('60000000-0000-0000-0000-000000000006',least(20,extract(hour from clock_timestamp() at time zone 'Europe/Rome')::int),encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
values('60000000-0000-0000-0000-000000000006','n1','NIGHT1','N1',120,'[{"id":"a","name":"A","rate":20}]',10,'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','a');
do $$declare claim jsonb;again jsonb;ok boolean;begin
 if has_function_privilege('authenticated','production_nightly_claim(uuid,text)','execute') then raise exception 'Client can read nightly source';end if;
 if production_nightly_claim('60000000-0000-0000-0000-000000000006','bad') is not null then raise exception 'Invalid token allowed';end if;
 claim:=production_nightly_claim('60000000-0000-0000-0000-000000000006',repeat('a',64));
 if claim is null then raise exception 'Claim missing';end if;
 if production_nightly_claim('60000000-0000-0000-0000-000000000006',repeat('a',64)) is not null then raise exception 'Concurrent claim allowed';end if;
 -- Snapshot changed after computation: reject instead of overwriting a colleague.
 update erp_snapshots set revision=revision+1 where company_id='60000000-0000-0000-0000-000000000006';
 ok:=production_nightly_commit('60000000-0000-0000-0000-000000000006',(claim->>'id')::uuid,10,'{"operatorPrograms":[],"nightlyPlanning":{"enabled":true}}');
 if ok then raise exception 'Stale revision accepted';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('60000000-0000-0000-0000-000000000006','n1','start');
do $$begin
 if production_nightly_claim('60000000-0000-0000-0000-000000000006',repeat('a',64)) is not null then raise exception 'Running shift ignored';end if;
end $$;
select production_timer_action('60000000-0000-0000-0000-000000000006','n1','pause');
do $$declare claim jsonb;ok boolean;begin
 claim:=production_nightly_claim('60000000-0000-0000-0000-000000000006',repeat('a',64));
 perform production_timer_action('60000000-0000-0000-0000-000000000006','n1','start');
 perform production_timer_action('60000000-0000-0000-0000-000000000006','n1','pause');
 ok:=production_nightly_commit('60000000-0000-0000-0000-000000000006',(claim->>'id')::uuid,11,'{"operatorPrograms":[],"nightlyPlanning":{"enabled":true}}');
 if ok then raise exception 'Timer race accepted';end if;
 claim:=production_nightly_claim('60000000-0000-0000-0000-000000000006',repeat('a',64));
 ok:=production_nightly_commit('60000000-0000-0000-0000-000000000006',(claim->>'id')::uuid,11,'{"operatorPrograms":[],"customers":[],"invoices":[],"nightlyPlanning":{"enabled":true}}');
 if not ok then raise exception 'Commit missing';end if;
 if (select payload->'customers' from erp_snapshots where company_id='60000000-0000-0000-0000-000000000006')<>'[{"id":"keep"}]'::jsonb then raise exception 'Customer data replaced';end if;
 if (select payload->'invoices' from erp_snapshots where company_id='60000000-0000-0000-0000-000000000006')<>'[{"id":"keep-finance"}]'::jsonb then raise exception 'Finance replaced';end if;
 if production_nightly_claim('60000000-0000-0000-0000-000000000006',repeat('a',64)) is not null then raise exception 'Second daily plan allowed';end if;
 if exists(select 1 from production_phase_checks where company_id='60000000-0000-0000-0000-000000000006') then raise exception 'Automatic signature';end if;
end $$;
rollback;
