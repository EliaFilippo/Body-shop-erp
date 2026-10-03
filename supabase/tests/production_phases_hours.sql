\set ON_ERROR_STOP on
-- Continues the disposable fixtures from live_production.sql.
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||
  '[{"id":"j3","number":"3","plate":"TEST3","status":"In lavorazione","lines":[{"id":"l1","description":"Porta da verniciare","quantity":1}],"phases":[{"id":"p1","name":"Preparazione","status":"Da fare","cycleOrder":1},{"id":"p2","name":"Verniciatura","status":"Da fare","cycleOrder":2}]}]');
select production_prepare_job('10000000-0000-0000-0000-000000000001','j3',10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
update erp_snapshots set payload=jsonb_set(payload,'{operatorPrograms}',
  '[{"operatorId":"a","tasks":[{"id":"a1","jobId":"j3","plate":"TEST3","phaseId":"p1","phaseName":"Preparazione","startAt":"2026-10-03T08:00:00+02:00"},{"id":"a2","jobId":"j3","plate":"TEST3","phaseId":"p2","phaseName":"Verniciatura","startAt":"2026-10-03T09:00:00+02:00"}]},{"operatorId":"b","tasks":[{"id":"b1","jobId":"j3","plate":"TEST3","phaseId":"p1","phaseName":"Preparazione","startAt":"2026-10-03T08:00:00+02:00"}]}]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
  if production_live_feed('10000000-0000-0000-0000-000000000001')->'program'->0->>'id'<>'a1' then raise exception 'Wrong personal work list'; end if;
  begin
    perform production_complete_phase('10000000-0000-0000-0000-000000000001','j3','p1');
    raise exception 'Unsigned unworked phase allowed';
  exception when raise_exception then if sqlerrm not like 'Puoi mettere il visto%' then raise; end if; end;
end $$;
select production_timer_action('10000000-0000-0000-0000-000000000001','j3','start','p1');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('10000000-0000-0000-0000-000000000001','j3','start','p1');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
  begin
    perform production_complete_phase('10000000-0000-0000-0000-000000000001','j3','p1');
    raise exception 'Running colleague was ignored';
  exception when raise_exception then if sqlerrm not like 'Un collega sta ancora%' then raise; end if; end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('10000000-0000-0000-0000-000000000001','j3','finish');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_complete_phase('10000000-0000-0000-0000-000000000001','j3','p1');
do $$declare feed jsonb; job jsonb; begin
  if (select count(*) from production_live_segments where ended_at is null)<>0 then raise exception 'Completion did not close own timer'; end if;
  if not exists(select 1 from production_phase_checks where operator_name='A' and checked_by=auth.uid() and phase_id='p1') then raise exception 'Wrong check provenance'; end if;
  feed:=production_live_feed('10000000-0000-0000-0000-000000000001');
  select j into job from jsonb_array_elements(feed->'jobs') j where j->>'jobId'='j3';
  if job->'phases'->0->>'checkedBy'<>'A' or job->'phases'->0->>'status'<>'Completata' or job->'tasks'->0->>'description'<>'Porta da verniciare'
    then raise exception 'Phase/task not visible'; end if;
  if jsonb_array_length(feed->'program')<>1 or feed->'program'->0->>'id'<>'a2' then raise exception 'Completed task not removed from personal list'; end if;
  begin
    perform production_timer_action('10000000-0000-0000-0000-000000000001','j3','start','p1');
    raise exception 'Completed phase restarted';
  exception when raise_exception then if sqlerrm not like 'La fase è completata%' then raise; end if; end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_complete_phase('10000000-0000-0000-0000-000000000001','j3','p1');
do $$begin
  if (select operator_name from production_phase_checks where phase_id='p1')<>'A' then raise exception 'Signature overwritten'; end if;
  begin
    perform production_hours_report('10000000-0000-0000-0000-000000000001','a','2026-09-01','2026-09-30');
    raise exception 'Worker saw colleague hours';
  exception when raise_exception then if sqlerrm not like 'Puoi vedere soltanto%' then raise; end if; end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into production_live_segments(company_id,job_id,operator_id,user_id,rate,started_at,ended_at,ordinary_schedule)
  select '10000000-0000-0000-0000-000000000001','j1','a','00000000-0000-0000-0000-000000000002',50,'2026-09-28 06:00+00','2026-09-28 16:00+00',production_operator_schedule(payload,'a') from erp_snapshots;
insert into production_live_segments(company_id,job_id,operator_id,user_id,rate,started_at,ended_at,ordinary_schedule)
  select '10000000-0000-0000-0000-000000000001','j1','a','00000000-0000-0000-0000-000000000002',50,'2026-03-28 22:30+00','2026-03-29 02:30+00',production_operator_schedule(payload,'a') from erp_snapshots;
-- Change future working hours; recorded days retain their original eight-hour threshold.
update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,operators,0,dailyHours}','12');
do $$declare report jsonb; begin
  report:=production_hours_report('10000000-0000-0000-0000-000000000001','a','2026-09-28','2026-09-28');
  if (report->>'workedSeconds')::numeric<>36000 or (report->>'ordinarySeconds')::numeric<>28800 or (report->>'extraSeconds')::numeric<>7200
    then raise exception 'Wrong ordinary/overtime or history changed: %',report; end if;
  report:=production_hours_report('10000000-0000-0000-0000-000000000001','a','2026-03-28','2026-03-29');
  if (report->'days'->0->>'workedSeconds')::numeric<>1800 or (report->'days'->1->>'workedSeconds')::numeric<>12600
    then raise exception 'Rome midnight/DST split wrong: %',report; end if;
  if has_function_privilege('authenticated','public.production_job_details(uuid,text)','EXECUTE') then raise exception 'Private helper exposed'; end if;
end $$;
