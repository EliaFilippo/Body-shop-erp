\set ON_ERROR_STOP on
\ir ../migrations/20261025_continue_day.sql
\ir ../migrations/20261025_continue_day.sql
begin;
do $$declare snap jsonb;begin
 snap:=jsonb_build_object('plannerSettings',jsonb_build_object('operators',jsonb_build_array(jsonb_build_object('id','a','active',true,'dailyHours',8,'weeklySchedule',jsonb_build_array(jsonb_build_object('dayOfWeek',1,'active',true,'intervals',jsonb_build_array(jsonb_build_object('startTime','08:00','endTime','12:00'),jsonb_build_object('startTime','13:00','endTime','17:00')))))))));
 if production_ordinary_end(snap,'a','2026-10-26')<>1020 then raise exception 'Wrong ordinary shift end';end if;
 if production_ordinary_end(snap,'a','2026-10-25') is not null then raise exception 'Closed Sunday available';end if;
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
rollback;
