\set ON_ERROR_STOP on
-- Isolated Postgres database, never run this fixture on a customer's project.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
\ir ../schema.sql
\ir ../migrations/20261003_live_production.sql
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into companies(id,name) values('10000000-0000-0000-0000-000000000001','Test');
insert into company_members(company_id,user_id,display_name,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Owner','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','A','production'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','B','production');
insert into erp_snapshots(company_id,revision,payload,updated_by) values('10000000-0000-0000-0000-000000000001',10,
 '{"plannerSettings":{"operators":[{"id":"a","name":"A","active":true},{"id":"b","name":"B","active":true}]},"jobs":[{"id":"j1","number":"1","plate":"TEST1","status":"In lavorazione"},{"id":"j2","number":"2","plate":"TEST2","status":"In lavorazione"}]}',
 '00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','a');
select production_bind_profile('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','b');
select production_prepare_job('10000000-0000-0000-0000-000000000001','j1',10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
select production_prepare_job('10000000-0000-0000-0000-000000000001','j2',10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','start');
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','start');
set role authenticated;
do $$begin
  if (select count(*) from erp_snapshots)<>0 then raise exception 'Production role sees financial snapshot'; end if;
  if production_live_feed('10000000-0000-0000-0000-000000000001')->>'operatorName'<>'A' then raise exception 'Production feed not available'; end if;
end $$;
reset role;
do $$begin
  if (select count(*) from production_live_segments)<>1 then raise exception 'Duplicate start'; end if;
  begin
    perform production_timer_action('10000000-0000-0000-0000-000000000001','j2','start');
    raise exception 'Two cars incorrectly allowed';
  exception when raise_exception then
    if sqlerrm not like 'Metti in pausa%' then raise; end if;
  end;
  begin
    perform production_prepare_job('10000000-0000-0000-0000-000000000001','j1',10,999,'[]');
    raise exception 'Worker budget write incorrectly allowed';
  exception when raise_exception then if sqlerrm not like 'Solo il titolare%' then raise; end if; end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','start');
update production_live_segments set started_at=clock_timestamp()-interval '1 hour';
do $$declare feed jsonb; job jsonb; begin
  feed:=production_live_feed('10000000-0000-0000-0000-000000000001');
  select j into job from jsonb_array_elements(feed->'jobs') j where j->>'jobId'='j1';
  if (job->>'activeCount')::int<>2 or abs((job->>'remainingSeconds')::numeric-327.2727)>1 then raise exception 'Wrong parallel countdown: %',job; end if;
  if (job->>'remainingPercent')::numeric>8.34 then raise exception 'Wrong threshold'; end if;
  if feed::text like '%initial_budget%' or feed::text like '%operator_rates%' or feed::text like '%"rate"%' then raise exception 'Financial data in production feed'; end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','pause');
do $$begin
  if (select count(*) from production_live_segments where ended_at is null)<>1 then raise exception 'Pause stopped colleague'; end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','finish');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin
  if (select count(*) from erp_snapshots)<>1 then raise exception 'Owner lost ERP access'; end if;
end $$;
reset role;
do $$begin
  begin
    perform production_prepare_job('10000000-0000-0000-0000-000000000001','j1',10,999,'[{"id":"a","name":"A","rate":1}]');
    raise exception 'Used budget was modified';
  exception when raise_exception then if sqlerrm not like 'Il budget è già in uso%' then raise; end if; end;
  if (select revision from erp_snapshots)<>10 then raise exception 'Timer mutated ERP snapshot'; end if;
  if has_table_privilege('authenticated','public.production_live_segments','UPDATE') then raise exception 'Direct segment write granted'; end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
do $$begin
  begin
    perform production_live_feed('10000000-0000-0000-0000-000000000001');
    raise exception 'Cross company read allowed';
  exception when raise_exception then if sqlerrm not like 'Accesso aziendale%' then raise; end if; end;
end $$;
-- Now the workflow races two start requests from the same employee.
