\set ON_ERROR_STOP on
\ir ../migrations/20261025_continue_day.sql
\ir ../migrations/20261025_continue_day.sql
begin;
do $$declare snap jsonb;begin
 snap:='{"plannerSettings":{"operators":[{"id":"a","active":true,"dailyHours":8,"weeklySchedule":[{"dayOfWeek":1,"active":true,"intervals":[{"startTime":"08:00","endTime":"12:00"},{"startTime":"13:00","endTime":"17:00"}]}]}]}}'::jsonb;
 if production_ordinary_end(snap,'a','2026-10-26')<>1020 then raise exception 'Wrong ordinary shift end';end if;
 if production_ordinary_end(snap,'a','2026-10-25') is not null then raise exception 'Closed Sunday available';end if;
 snap:=jsonb_set(snap,'{plannerSettings,companyClosures}','[{"startDate":"2026-10-26","endDate":"2026-10-26","startTime":"08:00","endTime":"12:00"}]');
 if production_ordinary_end(snap,'a','2026-10-26')<>1020 then raise exception 'Partial closure shift end wrong';end if;
 if production_ordinary_end(snap,'other','2026-10-26') is not null then raise exception 'Unknown operator';end if;
 if has_table_privilege('authenticated','production_day_extensions','SELECT') or has_function_privilege('authenticated','production_live_feed_before_continue_day(uuid)','EXECUTE') then raise exception 'Private data exposed';end if;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
do $$begin
 begin perform production_continue_day('10000000-0000-0000-0000-000000000001','23:59');raise exception 'Tenant write allowed';
 exception when raise_exception then if sqlerrm not like 'Accesso aziendale%' then raise;end if;end;
 begin perform production_day_extensions('10000000-0000-0000-0000-000000000001');raise exception 'Tenant read allowed';
 exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform production_day_extensions('10000000-0000-0000-0000-000000000001');raise exception 'Production reads staff schedules';
 exception when insufficient_privilege then null;end;
 begin perform production_continue_day('10000000-0000-0000-0000-000000000001','99:99');raise exception 'Invalid time accepted';
 exception when raise_exception then if sqlerrm not like 'Inserisci un orario%' then raise;end if;end;
end $$;

-- End-to-end own-profile continuation, retry, feed reload and preserved productive time.
update erp_snapshots s set payload=jsonb_set(payload,'{plannerSettings,operators}',(
 select jsonb_agg(case when o->>'id'='a' then o||jsonb_build_object('active',true,'dailyHours',8,'weeklySchedule',(
  select jsonb_agg(jsonb_build_object('dayOfWeek',d,'active',true,'intervals','[{"startTime":"00:00","endTime":"00:01"}]'::jsonb)) from generate_series(0,6)d)) else o end)
 from jsonb_array_elements(payload->'plannerSettings'->'operators')o
)) where company_id='10000000-0000-0000-0000-000000000001';
do $declare target text; total_before bigint; feed jsonb; minute_now integer;begin
 minute_now:=extract(hour from clock_timestamp() at time zone 'Europe/Rome')::integer*60+extract(minute from clock_timestamp() at time zone 'Europe/Rome')::integer;
 if minute_now<1 or minute_now>=1438 then return;end if;
 target:=to_char(((clock_timestamp() at time zone 'Europe/Rome')::date + make_interval(mins=>least(1439,minute_now+10)))::timestamp,'HH24:MI');
 select count(*) into total_before from production_live_segments;
 perform production_continue_day('10000000-0000-0000-0000-000000000001',target);
 perform production_continue_day('10000000-0000-0000-0000-000000000001',target);
 if (select count(*) from production_day_extensions where operator_id='a')<>1 then raise exception 'Retry duplicated availability';end if;
 if (select count(*) from production_live_segments)<>total_before then raise exception 'Continuation created worked time';end if;
 feed:=production_live_feed('10000000-0000-0000-0000-000000000001');
 if feed->'dayContinuation'->>'untilMinute' is null then raise exception 'Extension missing after reload';end if;
 if exists(select 1 from production_day_extensions where operator_id='b') then raise exception 'Colleague changed';end if;
end $;
rollback;
