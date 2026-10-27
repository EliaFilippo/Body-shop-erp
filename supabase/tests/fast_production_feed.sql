\set ON_ERROR_STOP on
\ir ../migrations/20261027_fast_production_feed.sql
\ir ../migrations/20261027_fast_production_feed.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
-- Compare the optimized pure predicate against the authoritative Start permission check.
do $$declare op jsonb;ph jsonb;want boolean;got boolean;job jsonb;
begin
 for op in select value from jsonb_array_elements('[
 {"id":"matrix","active":true},
 {"id":"matrix","active":true,"skillsConfigured":true,"skills":[]},
 {"id":"matrix","active":true,"skillsConfigured":true,"skills":["Preparazione","Lavaggio","Meccanica / gommista","Controllo"]},
 {"id":"matrix","active":true,"skillsConfigured":true,"skills":["Incartatura","Scartatura","Lavaggio esterno","Lavaggio interni"]},
 {"id":"matrix","active":false,"skills":["Preparazione"]}]') loop
  update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,operators}',jsonb_build_array(op)) where company_id='10000000-0000-0000-0000-000000000001';
  for ph in select value from jsonb_array_elements('[
   {"id":"p","name":"Incartatura"},{"id":"p","name":"Scartatura"},{"id":"p","name":"Preparazione"},
   {"id":"p","name":"Lavaggio esterno"},{"id":"p","name":"Lavaggio interni"},{"id":"p","name":"Lavaggio"},
   {"id":"p","name":"Meccanica"},{"id":"p","name":"Gommista"},{"id":"p","name":"Controllo qualità"},
   {"id":"p","name":"Trasporto"},{"id":"p","name":"Consegna"},{"id":"p","name":"Incartatura","notRequired":true},
   {"id":"p","name":"Incartatura","requiredSkill":"Trasporto"}]') loop
   job:=jsonb_build_object('id','matrix-job','phases',jsonb_build_array(ph));
   update erp_snapshots set payload=jsonb_set(payload,'{jobs}',jsonb_build_array(job)) where company_id='10000000-0000-0000-0000-000000000001';
   want:=production_operator_can_phase('10000000-0000-0000-0000-000000000001','matrix-job','matrix','p');
   got:=production_phase_matches_operator(op,ph);
   if want is distinct from got then raise exception 'Permission mismatch %, %',op,ph;end if;
  end loop;
 end loop;
 job:='{"id":"matrix-job","workflowCycle":"elias-v1","phases":[
 {"id":"s","name":"Smontaggio","status":"Completata"},
 {"id":"i","name":"Incartatura","status":"Da fare"},
 {"id":"v","name":"Verniciatura","status":"Da fare"},
 {"id":"u","name":"Scartatura","status":"Da fare"}]}';
 update erp_snapshots set payload=jsonb_set(payload,'{jobs}',jsonb_build_array(job)) where company_id='10000000-0000-0000-0000-000000000001';
 for ph in select value from jsonb_array_elements(job->'phases') loop
  if production_cycle_gate('10000000-0000-0000-0000-000000000001','matrix-job',ph->>'id')
   is distinct from production_cycle_gate_for_job('10000000-0000-0000-0000-000000000001',job,ph->>'id')
   then raise exception 'Cycle changed';end if;
 end loop;
end $$;
rollback;
-- Existing duties fixture now runs through the optimized wrapper.
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(jsonb_set(payload,'{plannerSettings,operators,0,skillsConfigured}','true'),'{plannerSettings,operators,0,skills}','["Lavaggio esterno"]');
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||'[{"id":"fast-feed","plate":"FAST","number":"FAST","status":"In lavorazione","phases":[{"id":"wash","name":"Lavaggio esterno","estimatedMinutes":25,"status":"Da fare"},{"id":"strip","name":"Smontaggio","estimatedMinutes":20,"status":"Da fare"}]}]'::jsonb)
 where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001','fast-feed',10,120,'[{"id":"a","name":"A","rate":50}]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare j jsonb;begin
 select value into j from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') where value->>'jobId'='fast-feed';
 if j is null or jsonb_array_length(j->'phases')<>1 or j->'phases'->0->>'id'<>'wash' then raise exception 'Duty leak or missing feed: %',j;end if;
 begin perform production_live_feed('10000000-0000-0000-0000-000000000099');raise exception 'Tenant bypass';exception when raise_exception then if sqlerrm not like 'Accesso aziendale%' then raise;end if;end;
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','fast-feed','start','strip');raise exception 'Unauthorized Start';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
