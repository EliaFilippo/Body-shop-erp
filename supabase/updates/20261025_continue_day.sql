begin;
create table if not exists public.production_day_extensions (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 operator_id text not null, user_id uuid not null references auth.users(id),
 work_date date not null, start_minute integer not null, end_minute integer not null,
 created_at timestamptz not null default clock_timestamp(),
 check(start_minute>=0 and end_minute<=1439 and end_minute>start_minute)
);
create index if not exists production_day_extensions_operator on public.production_day_extensions(company_id,operator_id,work_date);
alter table public.production_day_extensions enable row level security;
revoke all on public.production_day_extensions from public,anon,authenticated;

-- Ordinary shift remains frozen separately from extra availability and productive segments.
create or replace function public.production_ordinary_end(p_snapshot jsonb,p_operator text,p_date date)
returns integer language plpgsql set search_path=public,pg_temp as $$
declare schedule jsonb; day jsonb; piece jsonb; op jsonb; capacity numeric; seconds_left numeric; last_end numeric; start_sec numeric; end_sec numeric; absence_hours numeric;
begin
 select value into op from jsonb_array_elements(coalesce(p_snapshot->'plannerSettings'->'operators','[]')) where value->>'id'=p_operator and coalesce((value->>'active')::boolean,false);
 if op is null then return null;end if;
 schedule:=production_operator_schedule(p_snapshot,p_operator);
 capacity:=production_day_capacity(schedule,p_date);
 if capacity is null or capacity<=0 then return null;end if;
 if jsonb_array_length(coalesce(op->'weeklySchedule','[]'))=0 then capacity:=least(capacity,coalesce((op->>'dailyHours')::numeric,0)*3600);end if;
 select coalesce((value->>'hoursPerDay')::numeric,0) into absence_hours from jsonb_array_elements(coalesce(p_snapshot->'plannerSettings'->'absences','[]'))
 where value->>'operatorId'=p_operator and value->>'startDate'<=p_date::text and value->>'endDate'>=p_date::text limit 1;
 seconds_left:=greatest(0,capacity-coalesce(absence_hours,0)*3600);
 if seconds_left<=0 then return null;end if;
 select value into day from jsonb_array_elements(schedule->'days') where (value->>'dayOfWeek')::integer=extract(dow from p_date);
 for piece in select value from jsonb_array_elements(coalesce(day->'intervals','[]')) order by (value->>'start')::numeric loop
  start_sec:=(piece->>'start')::numeric;end_sec:=(piece->>'end')::numeric;
  last_end:=start_sec+least(seconds_left,end_sec-start_sec);
  seconds_left:=seconds_left-(end_sec-start_sec);
  if seconds_left<=0 then return ceil(last_end/60)::integer;end if;
 end loop;
 return null;
end $$;
revoke all on function public.production_ordinary_end(jsonb,text,date) from public,anon,authenticated;

create or replace function public.production_day_extensions(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'operatorId',operator_id,'date',work_date,'startMinute',start_minute,'endMinute',end_minute) order by id),'[]')
 into result from production_day_extensions where company_id=p_company_id;
 return result;
end $$;
revoke all on function public.production_day_extensions(uuid) from public,anon;
grant execute on function public.production_day_extensions(uuid) to authenticated;

create or replace function public.production_continue_day(p_company_id uuid,p_until text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text; snapshot jsonb; stamp timestamptz; day date; minute_now integer; ordinary_end integer; target integer; active_id uuid;
begin
 if not public.is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto';end if;
 if p_until is null or p_until !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Inserisci un orario valido';end if;
 target:=split_part(p_until,':',1)::integer*60+split_part(p_until,':',2)::integer;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 stamp:=clock_timestamp();day:=(stamp at time zone 'Europe/Rome')::date;
 minute_now:=extract(hour from stamp at time zone 'Europe/Rome')::integer*60+extract(minute from stamp at time zone 'Europe/Rome')::integer;
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if profile is null then raise exception 'Profilo operatore non collegato';end if;
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 ordinary_end:=production_ordinary_end(snapshot,profile,day);
 if ordinary_end is null then raise exception 'Configura un orario giornaliero con inizio e fine per questo operatore';end if;
 if minute_now<ordinary_end then raise exception 'Puoi continuare la giornata al termine dell’orario concordato';end if;
 -- Retrying an already accepted target never adds duplicate capacity.
 if exists(select 1 from production_day_extensions where company_id=p_company_id and operator_id=profile and work_date=day and end_minute>=target) then return;end if;
 if target<=minute_now then raise exception 'La fine della disponibilità deve essere successiva all’orario attuale';end if;
 select id into active_id from production_day_extensions where company_id=p_company_id and operator_id=profile and work_date=day and end_minute>=minute_now order by end_minute desc limit 1;
 if active_id is not null then update production_day_extensions set end_minute=target where id=active_id;
 else insert into production_day_extensions(company_id,operator_id,user_id,work_date,start_minute,end_minute)
 values(p_company_id,profile,auth.uid(),day,greatest(ordinary_end,minute_now),target);end if;
end $$;
revoke all on function public.production_continue_day(uuid,text) from public,anon;
grant execute on function public.production_continue_day(uuid,text) to authenticated;

do $$begin
 if to_regprocedure('public.production_live_feed_before_continue_day(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_continue_day;
 end if;
end $$;
revoke all on function public.production_live_feed_before_continue_day(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; profile text; snapshot jsonb; stamp timestamptz:=clock_timestamp(); day date; ordinary_end integer; minute_now integer; until_minute integer;
begin
 result:=production_live_feed_before_continue_day(p_company_id);
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if profile is null then return result||jsonb_build_object('dayContinuation',null);end if;
 day:=(stamp at time zone 'Europe/Rome')::date;
 minute_now:=extract(hour from stamp at time zone 'Europe/Rome')::integer*60+extract(minute from stamp at time zone 'Europe/Rome')::integer;
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 ordinary_end:=production_ordinary_end(snapshot,profile,day);
 select max(end_minute) into until_minute from production_day_extensions where company_id=p_company_id and operator_id=profile and work_date=day;
 return result||jsonb_build_object('dayContinuation',jsonb_build_object('date',day,'ordinaryEndMinute',ordinary_end,'untilMinute',until_minute,'canContinue',coalesce(minute_now>=ordinary_end,false)));
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
