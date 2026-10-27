\set ON_ERROR_STOP on
\ir ../migrations/20261027213003_manual_vehicle_phase_start.sql
\ir ../migrations/20261027213003_manual_vehicle_phase_start.sql
begin;
insert into companies(id,name) values('60000000-0000-0000-0000-000000000006','Manual fixture');
insert into company_members(company_id,user_id,display_name,role) values
('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','Owner','owner'),
('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','A','production'),
('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','B','production');
insert into erp_snapshots(company_id,payload,updated_by) values('60000000-0000-0000-0000-000000000006',
'{"plannerSettings":{"operators":[{"id":"a","name":"A","active":true,"dailyHours":8,"skillsConfigured":true,"skills":["Lavaggio esterno"]},{"id":"b","name":"B","active":true,"dailyHours":8}]},"jobs":[{"id":"manual1","plate":"MAN1","status":"Pianificata","workflowCycle":"elias-v1","phases":[{"id":"p0","name":"Smontaggio","status":"Da fare"},{"id":"p1","name":"Lattoneria","status":"Bloccata"},{"id":"p2","name":"Lucidatura","status":"Completata"},{"id":"delivery","name":"Consegna","status":"Da fare"}]},{"id":"manual2","plate":"MAN2","status":"Pianificata","phases":[{"id":"p1","name":"Lattoneria","status":"Da fare"}]}]}',
'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','a');
select production_bind_profile('60000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','b');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '60000000-0000-0000-0000-000000000006','manual'||n,'MAN'||n,'COMM-'||n,120,
'[{"id":"a","name":"A","rate":20},{"id":"b","name":"B","rate":20}]',1,'00000000-0000-0000-0000-000000000001'::uuid from generate_series(1,2)n;
insert into production_phase_checks(company_id,job_id,phase_id,phase_name,checked_by,operator_id,operator_name,checked_at,worked_seconds)
values('60000000-0000-0000-0000-000000000006','manual1','p2','Lucidatura','00000000-0000-0000-0000-000000000003','b','B','2026-01-01T10:00:00Z',123);
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('60000000-0000-0000-0000-000000000006','manual2','start','p1');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$declare feed jsonb;begin
 feed:=production_live_feed('60000000-0000-0000-0000-000000000006');
 if jsonb_array_length(feed->'jobs')<>2 or not (feed->>'manualSelection')::boolean then raise exception 'Manual cars hidden';end if;
 if not exists(select 1 from jsonb_array_elements(feed->'jobs') j,jsonb_array_elements(j->'phases') p where p->>'id'='p1' and p->>'automaticAllowed'='false') then raise exception 'Automatic duties changed';end if;
 begin
  perform production_timer_action('60000000-0000-0000-0000-000000000006','manual2','start','p1');raise exception 'Automatic duties bypass';
 exception when insufficient_privilege then null;end;
end $$;
select production_manual_start('60000000-0000-0000-0000-000000000006','manual1','p1');
select production_manual_start('60000000-0000-0000-0000-000000000006','manual1','p1');
select production_manual_start('60000000-0000-0000-0000-000000000006','manual2','p1');
select production_timer_action('60000000-0000-0000-0000-000000000006','manual2','finish');
select production_manual_start('60000000-0000-0000-0000-000000000006','manual1','p2');
do $$begin
 begin
  perform production_manual_start('60000000-0000-0000-0000-000000000006','manual1','delivery');raise exception 'Delivery allowed';
 exception when raise_exception then if sqlerrm<>'La consegna viene registrata dall’ufficio' then raise;end if;end;
 begin
  perform production_manual_start('60000000-0000-0000-0000-000000000006','manual2','missing');raise exception 'Invalid phase allowed';
 exception when raise_exception then if sqlerrm<>'Scegli una fase prevista sulla vettura' then raise;end if;end;
 begin
  perform production_manual_start('10000000-0000-0000-0000-000000000001','manual1','p1');raise exception 'Foreign phase allowed';
 exception when raise_exception then if sqlerrm='Foreign phase allowed' then raise;end if;end;
end $$;
reset role;
do $$begin
 if (select count(*) from production_live_segments where company_id='60000000-0000-0000-0000-000000000006' and operator_id='a')<>3 then raise exception 'Duplicate/lost segment';end if;
 if (select count(*) from production_live_segments where company_id='60000000-0000-0000-0000-000000000006' and operator_id='a' and ended_at is null)<>1 then raise exception 'Duplicate timer';end if;
 if not exists(select 1 from production_live_segments where company_id='60000000-0000-0000-0000-000000000006' and operator_id='b' and ended_at is null) then raise exception 'Colleague stopped';end if;
 if (select count(*) from production_phase_checks where company_id='60000000-0000-0000-0000-000000000006')<>1 or not exists(select 1 from production_phase_checks where company_id='60000000-0000-0000-0000-000000000006' and phase_id='p2' and worked_seconds=123 and checked_at='2026-01-01T10:00:00Z') then raise exception 'Historical signature changed';end if;
 if not exists(select 1 from production_live_sessions where company_id='60000000-0000-0000-0000-000000000006' and operator_id='a' and phase_id='p2' and status='running') then raise exception 'Failed target lost active timer';end if;
end $$;
-- Capacity and rollback must still apply to explicit additional work.
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||(
 select jsonb_agg(jsonb_build_object('id','manual-wash'||n,'status','Pianificata','phases',jsonb_build_array(
 jsonb_build_object('id','wash','name','Lavaggio esterno','status','Completata')))) from generate_series(1,2)n))
where company_id='60000000-0000-0000-0000-000000000006';
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '60000000-0000-0000-0000-000000000006','manual-wash'||n,'WASH'||n,'WASH-'||n,120,
'[{"id":"a","name":"A","rate":20},{"id":"b","name":"B","rate":20}]',1,'00000000-0000-0000-0000-000000000001'::uuid from generate_series(1,2)n;
select production_manual_start('60000000-0000-0000-0000-000000000006','manual-wash1','wash');
select production_timer_action('60000000-0000-0000-0000-000000000006','manual-wash1','pause');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$begin
 begin
  perform production_manual_start('60000000-0000-0000-0000-000000000006','manual-wash2','wash');raise exception 'Wash capacity bypass';
 exception when raise_exception then if sqlerrm not like 'La sola postazione%' then raise;end if;end;
 if not exists(select 1 from production_live_sessions where company_id='60000000-0000-0000-0000-000000000006' and operator_id='b' and job_id='manual2' and status='running') then raise exception 'Capacity failure stopped prior work';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('60000000-0000-0000-0000-000000000006','manual-wash1','finish');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_manual_start('60000000-0000-0000-0000-000000000006','manual-wash2','wash');
-- Three manual paint interventions still occupy three bays after switching/pausing.
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||(
 select jsonb_agg(jsonb_build_object('id','manual-paint'||n,'status','Pianificata','workflowCycle','elias-v1','phases',jsonb_build_array(
 jsonb_build_object('id','paint','name','Verniciatura','status','Completata','completedAt','2026-01-01T10:00:00Z'),
 jsonb_build_object('id','unmask','name','Scartatura','status','Da fare')))) from generate_series(1,4)n))
where company_id='60000000-0000-0000-0000-000000000006';
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '60000000-0000-0000-0000-000000000006','manual-paint'||n,'PAINT'||n,'PAINT-'||n,120,
'[{"id":"a","name":"A","rate":20},{"id":"b","name":"B","rate":20}]',1,'00000000-0000-0000-0000-000000000001'::uuid from generate_series(1,4)n;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_manual_start('60000000-0000-0000-0000-000000000006','manual-paint1','paint');
select production_manual_start('60000000-0000-0000-0000-000000000006','manual-paint2','paint');
select production_manual_start('60000000-0000-0000-0000-000000000006','manual-paint3','paint');
do $$begin
 begin
  perform production_manual_start('60000000-0000-0000-0000-000000000006','manual-paint4','paint');raise exception 'Paint capacity bypass';
 exception when raise_exception then if sqlerrm not like 'Le 3 postazioni%' then raise;end if;end;
end $$;
select production_timer_action('60000000-0000-0000-0000-000000000006','manual-paint3','finish');
do $$begin
 begin
  perform production_manual_start('60000000-0000-0000-0000-000000000006','manual-paint3','unmask');raise exception 'Drying bypass';
 exception when raise_exception then if sqlerrm<>'Attesa asciugatura prima di proseguire' then raise;end if;end;
 begin
  perform production_manual_start('60000000-0000-0000-0000-000000000006','manual-paint4','paint');raise exception 'Drying bay bypass';
 exception when raise_exception then if sqlerrm not like 'Le 3 postazioni%' then raise;end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
set local role authenticated;
do $$begin
 begin
  perform production_manual_start('60000000-0000-0000-0000-000000000006','manual1','p1');raise exception 'Cross tenant allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
