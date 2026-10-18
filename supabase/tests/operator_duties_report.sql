\set ON_ERROR_STOP on
\ir ../migrations/20261018_operator_duties_report.sql
\ir ../migrations/20261018_operator_duties_report.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(jsonb_set(payload,'{plannerSettings,operators,0,skillsConfigured}','true'),'{plannerSettings,operators,0,skills}','["Lavaggio esterno"]');
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||'[
 {"id":"duty-job","plate":"DUTIES","number":"DUTY","status":"In lavorazione","phases":[{"id":"wash","name":"Lavaggio esterno","estimatedMinutes":25,"status":"Da fare"},{"id":"s","name":"Smontaggio","estimatedMinutes":60,"status":"Da fare"}]}
]'::jsonb) where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001','duty-job',10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare j jsonb;begin
 select value into j from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') where value->>'jobId'='duty-job';
 if jsonb_array_length(j->'phases')<>1 or j->'phases'->0->>'id'<>'wash' then raise exception 'Unauthorized phase visible: %',j;end if;
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','duty-job','start','s');raise exception 'Legacy duty start allowed';exception when insufficient_privilege then null;end;
 begin perform production_complete_phase('10000000-0000-0000-0000-000000000001','duty-job','s');raise exception 'Legacy signature allowed';exception when insufficient_privilege then null;end;
 begin perform production_operator_can_phase('10000000-0000-0000-0000-000000000001','duty-job','a','s');raise exception 'Private duty check exposed';exception when insufficient_privilege then null;end;
end $$;
select production_timer_action('10000000-0000-0000-0000-000000000001','duty-job','start','wash');
reset role;
-- Revoking permission retains only the card needed to stop existing work; cannot start again.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,operators,0,skills}','[]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare j jsonb;begin
 select value into j from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') where value->>'jobId'='duty-job';
 if jsonb_array_length(j->'phases')<>0 or j->>'ownStatus'<>'running' then raise exception 'Revoked timer not stoppable: %',j;end if;
end $$;
select production_timer_action('10000000-0000-0000-0000-000000000001','duty-job','pause');
do $$begin
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','duty-job','start','wash');raise exception 'Revoked resume allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
-- Six comparable completed allowances, each 25 minutes planned / 30 worked: review at +20%.
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||jsonb_build_array(jsonb_build_object(
 'id','review-job','plate','REVIEW','number','REVIEW','status','In lavorazione','phases',
 (select jsonb_agg(jsonb_build_object('id','w'||i,'name','Lavaggio esterno','estimatedMinutes',25,'status','Completata')) from generate_series(1,6) i))))
 where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001','review-job',10,120,'[{"id":"a","name":"A","rate":50}]');
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 values('10000000-0000-0000-0000-000000000001','review-job','a','00000000-0000-0000-0000-000000000002','A','finished','w6');
-- Restore authorization before inserting the historical test segments.
update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,operators,0,skills}','["Lavaggio esterno"]');
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at)
 select '10000000-0000-0000-0000-000000000001','review-job','a','00000000-0000-0000-0000-000000000002','w'||i,50,
 now()-i*interval '30 minutes',now()-(i-1)*interval '30 minutes' from generate_series(1,6) i;
-- Office sees full cycle; reports expose all frozen phases, and do not invent observations for empty work.
set role authenticated;
do $$declare report jsonb; j jsonb;begin
 report:=production_control_report('10000000-0000-0000-0000-000000000001',current_date-1,current_date+1);
 if jsonb_array_length(report->'phaseReview')<2 then raise exception 'All-phase report missing: %',report;end if;
 if not exists(select 1 from jsonb_array_elements(report->'phaseReview') x where x->>'phase'='Lavaggio esterno' and (x->>'samples')::int=6 and (x->>'deviationPercent')::numeric=20 and (x->>'workedSeconds')::numeric=10800 and x->>'review'='Verificare tempi o difficoltà delle lavorazioni') then raise exception 'Phase review comparison incorrect: %',report;end if;
 if not exists(select 1 from jsonb_array_elements(report->'phaseReview') x where x->>'phase'='Smontaggio' and (x->>'samples')::int=0 and x->>'review'='Pochi dati: osservare ancora') then raise exception 'Unworked phase falsely evaluated';end if;
 select value into j from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') where value->>'jobId'='duty-job';
 if jsonb_array_length(j->'phases')<>2 then raise exception 'Office lost cycle';end if;
end $$;
reset role;
rollback;
