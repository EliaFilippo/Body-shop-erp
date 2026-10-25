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
rollback;
