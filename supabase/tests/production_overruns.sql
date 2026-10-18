\set ON_ERROR_STOP on
\ir ../migrations/20261018_production_overruns.sql
-- Migration can be run twice without resetting assignments or acknowledgement history.
\ir ../migrations/20261018_production_overruns.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(jsonb_set(payload,'{jobs}',(payload->'jobs')||'[
 {"id":"score-solo","number":"SCORE","plate":"SOLO","status":"In lavorazione","phases":[{"id":"wash","name":"Lavaggio esterno","estimatedMinutes":60,"status":"Completata"}]},
 {"id":"score-shared","number":"TEAM","plate":"TEAM","status":"In lavorazione","phases":[{"id":"s","name":"Smontaggio","estimatedMinutes":60,"sharedTimeKey":"sr","sharedTimeMinutes":60,"status":"Completata"},{"id":"r","name":"Rimontaggio","estimatedMinutes":0,"sharedTimeKey":"sr","sharedTimeMinutes":60,"status":"Completata"}]},
 {"id":"score-open","number":"OPEN","plate":"OPEN","status":"In lavorazione","phases":[{"id":"wash","name":"Lavaggio esterno","estimatedMinutes":25,"status":"Da fare"}]},
 {"id":"score-missing","number":"NONE","plate":"NONE","status":"In lavorazione","phases":[{"id":"v","name":"Verniciatura","estimatedMinutes":0,"status":"Completata"}]}
]'::jsonb),'{operatorPrograms}','[{"operatorId":"a","tasks":[{"operatorId":"a","jobId":"score-shared","phaseId":"s","plannedMinutes":30}]},{"operatorId":"b","tasks":[{"operatorId":"b","jobId":"score-shared","phaseId":"r","plannedMinutes":30}]}]'::jsonb)
 where company_id='10000000-0000-0000-0000-000000000001';
select production_prepare_job('10000000-0000-0000-0000-000000000001',j,10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]') from unnest(array['score-solo','score-shared','score-open','score-missing']) j;
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 select '10000000-0000-0000-0000-000000000001',j,'a','00000000-0000-0000-0000-000000000002','A','paused',case when j='score-shared' then 's' when j='score-missing' then 'v' else 'wash' end
 from unnest(array['score-solo','score-shared','score-open','score-missing']) j;
insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 values('10000000-0000-0000-0000-000000000001','score-shared','b','00000000-0000-0000-0000-000000000003','B','paused','r');
-- Seventy-five minutes of work, not the two hours since it started: pauses excluded.
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at,ended_at) values
 ('10000000-0000-0000-0000-000000000001','score-solo','a','00000000-0000-0000-0000-000000000002','wash',50,now()-interval '2 hours',now()-interval '45 minutes'),
 ('10000000-0000-0000-0000-000000000001','score-shared','a','00000000-0000-0000-0000-000000000002','s',50,now()-interval '60 minutes',now()-interval '30 minutes'),
 ('10000000-0000-0000-0000-000000000001','score-shared','b','00000000-0000-0000-0000-000000000003','r',60,now()-interval '60 minutes',now()-interval '15 minutes'),
 ('10000000-0000-0000-0000-000000000001','score-missing','a','00000000-0000-0000-0000-000000000002','v',50,now()-interval '10 minutes',now());
-- Open phase must show +5 minutes and keep counting, never appear in completed scores.
insert into production_live_segments(company_id,job_id,operator_id,user_id,phase_id,rate,started_at)
 values('10000000-0000-0000-0000-000000000001','score-open','a','00000000-0000-0000-0000-000000000002','wash',50,now()-interval '30 minutes');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare j jsonb;begin
 select value into j from jsonb_array_elements(production_live_feed('10000000-0000-0000-0000-000000000001')->'jobs') where value->>'jobId'='score-open';
 if abs((j->'phases'->0->'standardClock'->>'overrunSeconds')::numeric-300)>5 then raise exception 'Overrun not shown: %',j;end if;
 if j::text like '%"rate"%' then raise exception 'Rate leaked';end if;
 begin perform production_control_report('10000000-0000-0000-0000-000000000001',current_date-1,current_date);raise exception 'Production read office report';exception when raise_exception then if sqlerrm not like 'Accesso ufficio%' then raise;end if;end;
 begin perform production_time_facts('10000000-0000-0000-0000-000000000001');raise exception 'Private facts public';exception when insufficient_privilege then null;end;
 begin perform production_scan_overruns('10000000-0000-0000-0000-000000000099');raise exception 'Private scan public';exception when insufficient_privilege then null;end;
end $$;
reset role;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$declare report jsonb; a jsonb; b jsonb; alert_id bigint;begin
 report:=production_control_report('10000000-0000-0000-0000-000000000001',current_date-1,current_date+1);
 select value into a from jsonb_array_elements(report->'operators') where value->>'operatorId'='a';
 select value into b from jsonb_array_elements(report->'operators') where value->>'operatorId'='b';
 -- A: (60+30)/(75+30)=85.7, B:30/45=66.7. Not average of percentages.
 if (a->>'score')::numeric<>85.7 or (a->>'assignedSeconds')::numeric<>5400 or (a->>'workedSeconds')::numeric<>6300 then raise exception 'Weighted solo/shared score incorrect: %',a;end if;
 if (b->>'score')::numeric<>66.7 then raise exception 'Shared share duplicated: %',b;end if;
 if (report->'teams'->0->>'score')::numeric<>80 then raise exception 'Team score incorrect';end if;
 if jsonb_array_length(report->'alerts')<>3 then raise exception 'Missing or duplicate alert: %',report->'alerts';end if;
 report:=production_control_report('10000000-0000-0000-0000-000000000001',current_date-1,current_date+1);
 if jsonb_array_length(report->'alerts')<>3 then raise exception 'Polling duplicated alerts';end if;
 select (value->>'id')::bigint into alert_id from jsonb_array_elements(report->'alerts') where value->>'jobId'='score-open';
 report:=production_control_report('10000000-0000-0000-0000-000000000001',current_date-1,current_date+1,alert_id);
 if exists(select 1 from jsonb_array_elements(report->'alerts') x where (x->>'id')::bigint=alert_id and x->>'acknowledgedAt' is null) then raise exception 'Ack missing';end if;
 begin perform production_control_report('10000000-0000-0000-0000-000000000099',current_date-1,current_date);raise exception 'Cross tenant report';exception when raise_exception then if sqlerrm not like 'Accesso ufficio%' then raise;end if;end;
end $$;
reset role;
-- Reassignment cannot rewrite captured personal allowances. Unplanned collaboration is team-only.
update production_time_assignments set weights='{}' where job_id='score-shared';
do $$declare report jsonb; a jsonb;begin
 report:=production_control_report('10000000-0000-0000-0000-000000000001',current_date-1,current_date+1);
 select value into a from jsonb_array_elements(report->'operators') where value->>'operatorId'='a';
 if (a->>'score')::numeric<>80 or (a->>'unscoredSharedSeconds')::numeric<>1800 then raise exception 'Unplanned shared work distorted individual score: %',a;end if;
 if (select count(*) from production_live_segments where job_id='score-open' and ended_at is null)<>1 then raise exception 'Limit stopped timer';end if;
end $$;
rollback;
