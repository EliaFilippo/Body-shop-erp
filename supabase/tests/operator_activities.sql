\set ON_ERROR_STOP on
\ir ../migrations/20261025_operator_activities.sql
\ir ../migrations/20261025_operator_activities.sql
begin;
update production_live_segments set ended_at=clock_timestamp() where ended_at is null;
update production_live_sessions set status='paused' where status='running';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','start');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','start');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_activity_action('10000000-0000-0000-0000-000000000001','cleaning');
select production_activity_action('10000000-0000-0000-0000-000000000001','cleaning');
do $$declare feed jsonb;begin
 if (select count(*) from production_operator_activities where ended_at is null)<>1 then raise exception 'Duplicate activity';end if;
 if exists(select 1 from production_live_segments where operator_id='a' and ended_at is null) then raise exception 'Own timer still running';end if;
 if not exists(select 1 from production_live_segments where operator_id='b' and ended_at is null) then raise exception 'Colleague stopped';end if;
 if (select status from production_live_sessions where job_id='j1' and operator_id='a')<>'paused' then raise exception 'Session not paused';end if;
 if exists(select 1 from production_phase_checks where job_id='j1') then raise exception 'Phase unexpectedly completed';end if;
 feed:=production_live_feed('10000000-0000-0000-0000-000000000001');
 if feed->'activity'->>'kind'<>'cleaning' then raise exception 'Activity missing from reload';end if;
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','j1','start');raise exception 'Overlapping vehicle allowed';
 exception when raise_exception then if sqlerrm not like 'Termina prima%' then raise;end if;end;
end $$;
update production_operator_activities set started_at=clock_timestamp()-interval '2 minutes' where ended_at is null;
select production_activity_action('10000000-0000-0000-0000-000000000001','coffee');
do $$begin
 if (select count(*) from production_operator_activities where operator_id='a' and ended_at is null and kind='coffee')<>1
 or not exists(select 1 from production_operator_activities where operator_id='a' and kind='cleaning' and ended_at is not null) then raise exception 'Switch not atomic';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$begin
 if production_live_feed('10000000-0000-0000-0000-000000000001')->'activity'->>'kind' is not null then raise exception 'Colleague sees another activity';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_activity_action('10000000-0000-0000-0000-000000000001','end');
select production_activity_action('10000000-0000-0000-0000-000000000001','end');
select production_timer_action('10000000-0000-0000-0000-000000000001','j1','start');
do $$begin
 if exists(select 1 from production_operator_activities where ended_at is null) then raise exception 'Activity not ended';end if;
 if not exists(select 1 from production_live_segments where operator_id='a' and ended_at is null) then raise exception 'Resume failed';end if;
 if has_table_privilege('authenticated','public.production_operator_activities','SELECT')
 or has_function_privilege('authenticated','public.production_own_activity(uuid,text,timestamptz)','EXECUTE')
 or has_function_privilege('authenticated','public.production_live_feed_before_activities(uuid)','EXECUTE') then raise exception 'Private data exposed';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
do $$begin
 begin perform production_activity_action('10000000-0000-0000-0000-000000000001','coffee');raise exception 'Tenant access allowed';
 exception when raise_exception then if sqlerrm not like 'Accesso aziendale%' then raise;end if;end;
end $$;
insert into production_operator_activities(company_id,operator_id,user_id,operator_name,kind,started_at,ended_at)
 values('10000000-0000-0000-0000-000000000001','dst','00000000-0000-0000-0000-000000000002','DST','cleaning','2026-10-24 21:30+00','2026-10-25 02:30+00');
do $$declare state jsonb;begin
 state:=production_own_activity('10000000-0000-0000-0000-000000000001','dst','2026-10-25 02:30+00');
 if (state->>'cleaningSeconds')::numeric<>16200 then raise exception 'Rome midnight/DST total wrong: %',state;end if;
end $$;
rollback;
