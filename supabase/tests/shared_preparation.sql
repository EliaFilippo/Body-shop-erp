\set ON_ERROR_STOP on
\ir ../migrations/20261025_shared_preparation.sql
\ir ../migrations/20261025_shared_preparation.sql
begin;
do $$declare original jsonb; revised jsonb; second jsonb; prep jsonb; paint jsonb;begin
 original:='{"id":"v-test","workflowCycle":"elias-v1","status":"Pianificata","taxableAmount":200,"phases":[{"id":"lat","name":"Lattoneria","status":"Da fare","notRequired":false,"estimatedMinutes":20},{"id":"prep","name":"Stuccatura","status":"Completata","notRequired":true,"estimatedMinutes":0,"actualMinutes":0},{"id":"mask","name":"Incartatura","status":"Da fare","notRequired":false,"estimatedMinutes":30},{"id":"paint","name":"Verniciatura","status":"Da fare","notRequired":false,"estimatedMinutes":90,"actualMinutes":0,"technicalWaitMinutes":60},{"id":"unwrap","name":"Scartatura","status":"Da fare","notRequired":false,"estimatedMinutes":0}]}';
 revised:=production_split_preparation(original,false);
 if (select sum((value->>'estimatedMinutes')::numeric) from jsonb_array_elements(revised->'phases'))<>140 then raise exception 'Time duplicated';end if;
 if revised->'phases'->1->>'name'<>'Stuccatura' or revised->'phases'->2->>'name'<>'Incartatura' or revised->'phases'->3->>'name'<>'Verniciatura' then raise exception 'Wrong sequence';end if;
 select value into prep from jsonb_array_elements(revised->'phases') where value->>'name'='Stuccatura';
 select value into paint from jsonb_array_elements(revised->'phases') where value->>'name'='Verniciatura';
 if prep->>'id'<>'prep' or prep->>'status'<>'Da fare' or (prep->>'notRequired')::boolean or (prep->>'sharedTimeMinutes')::numeric<>90 or paint->>'sharedTimeKey'<>'v' or (paint->>'estimatedMinutes')::numeric<>0 then raise exception 'Invalid shared V';end if;
 if production_split_preparation(revised,false)<>revised then raise exception 'Conversion not idempotent';end if;
 second:=production_split_preparation(original,true);
 if not (second->'phases'->1->>'notRequired')::boolean or (second->'phases'->3->>'estimatedMinutes')::numeric<>90 then raise exception 'Advanced work reopened';end if;
 if revised->>'taxableAmount'<>original->>'taxableAmount' then raise exception 'Price changed';end if;
 if has_table_privilege('authenticated','public.preparation_cycle_backups','SELECT') or has_function_privilege('authenticated','public.production_split_preparation(jsonb,boolean)','EXECUTE') then raise exception 'Recovery helpers exposed';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||'[{"id":"v-repair","workflowCycle":"elias-v1","status":"Pianificata","taxableAmount":200,"phases":[{"id":"vp","name":"Stuccatura","status":"Completata","notRequired":true,"estimatedMinutes":0},{"id":"vm","name":"Incartatura","status":"Da fare","estimatedMinutes":30},{"id":"vv","name":"Verniciatura","status":"Da fare","estimatedMinutes":90,"technicalWaitMinutes":60}]}]'::jsonb) where company_id='10000000-0000-0000-0000-000000000001';
select production_apply_shared_preparation();
do $$declare job jsonb; limits jsonb;before_count bigint;begin
 select j into job from erp_snapshots s,jsonb_array_elements(s.payload->'jobs') j where s.company_id='10000000-0000-0000-0000-000000000001' and j->>'id'='v-repair';
 if not (job->>'sharedPreparationCycle')::boolean then raise exception 'Stored job not converted';end if;
 limits:=production_time_limits('10000000-0000-0000-0000-000000000001','v-repair');
 if limits->'vp'->>'key'<>'v' or limits->'vv'->>'key'<>'v' or (limits->'vp'->>'minutes')::numeric<>90 or (limits->'vv'->>'minutes')::numeric<>90 then raise exception 'Live shared timer pool incorrect';end if;
 before_count:=(select count(*) from production_live_segments);
 perform production_apply_shared_preparation();
 if before_count<>(select count(*) from production_live_segments) then raise exception 'Timer history changed';end if;
 if not exists(select 1 from preparation_cycle_backups where company_id='10000000-0000-0000-0000-000000000001') then raise exception 'Recovery snapshot missing';end if;
end $$;
rollback;
