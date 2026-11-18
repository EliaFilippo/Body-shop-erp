CREATE OR REPLACE FUNCTION public.production_productive_day_seconds(snapshot jsonb, operator_id text, work_day date)
RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN public.production_day_capacity(public.production_operator_schedule(snapshot,operator_id),work_day)=0 THEN 0
 WHEN (op->>'dailyHours')::numeric > 0 THEN (op->>'dailyHours')::numeric*3600 ELSE NULL END
 FROM jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) op WHERE op->>'id'=operator_id
$$;
REVOKE ALL ON FUNCTION public.production_productive_day_seconds(jsonb,text,date) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.production_daily_hours(p_company_id uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare snapshot jsonb;people jsonb:='[]'; person record;op jsonb;entries jsonb;changes jsonb;
 vehicle numeric;cleaning numeric;coffee numeric;other numeric;total numeric;planned numeric;job_options jsonb;
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto' using errcode='42501';end if;
 if p_day is null or p_day>(statement_timestamp() at time zone 'Europe/Rome')::date then raise exception 'Scegli una giornata fino a oggi.';end if;
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 for person in
  with known as (
   select o->>'id' id,o->>'name' name from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o
    where coalesce((o->>'active')::boolean,false)
   union select e.operator_id,null from production_daily_hour_entries(p_company_id,p_day) e
   union select a.operator_id,null from production_hour_adjustments a where a.company_id=p_company_id and a.work_day=p_day)
  select id,coalesce(max(name),(select max(s.operator_name) from production_live_sessions s where s.company_id=p_company_id and s.operator_id=k.id),
    (select max(a.operator_name) from production_operator_activities a where a.company_id=p_company_id and a.operator_id=k.id),id) name
  from known k group by id order by name
 loop
  select o into op from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o where o->>'id'=person.id;
  select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'jobId',e.job_id,'phaseId',e.phase_id,
    'plate',coalesce(j.plate,p.value->>'plate'),'number',coalesce(j.number,p.value->>'number'),
    'phase',coalesce(ph.value->>'name','Lavorazione'),
    'startedAt',e.started_at,'endedAt',e.ended_at,'seconds',e.seconds,'running',e.running) order by e.started_at),'[]')
   into entries from production_daily_hour_entries(p_company_id,p_day) e
   left join production_live_jobs j on j.company_id=p_company_id and j.job_id=e.job_id
   left join lateral (select value from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) where value->>'id'=e.job_id limit 1) p on true
   left join lateral (select value from jsonb_array_elements(coalesce(p.value->'phases','[]')) where value->>'id'=e.phase_id limit 1) ph on true
   where e.operator_id=person.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'jobId',a.job_id,
   'plate',coalesce(j.plate,p.value->>'plate'),'number',coalesce(j.number,p.value->>'number'),
   'seconds',a.delta_seconds,'reason',a.reason,'actorId',a.actor_id,'createdAt',a.created_at) order by a.created_at),'[]')
   into changes from production_hour_adjustments a
   left join production_live_jobs j on j.company_id=p_company_id and j.job_id=a.job_id
   left join lateral (select value from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) where value->>'id'=a.job_id limit 1) p on true
   where a.company_id=p_company_id and a.work_day=p_day and a.operator_id=person.id;
  with amounts as (
   select x->>'kind' kind,(x->>'seconds')::numeric seconds from jsonb_array_elements(entries) x
   union all select x->>'kind',(x->>'seconds')::numeric from jsonb_array_elements(changes) x)
  select coalesce(sum(seconds) filter(where kind='vehicle'),0),coalesce(sum(seconds) filter(where kind='cleaning'),0),
   coalesce(sum(seconds) filter(where kind='coffee'),0),coalesce(sum(seconds) filter(where kind='other'),0)
   into vehicle,cleaning,coffee,other from amounts;
  total:=vehicle+cleaning+other;
  planned:=production_productive_day_seconds(snapshot,person.id,p_day);
  people:=people||jsonb_build_array(jsonb_build_object('operatorId',person.id,'name',person.name,
   'vehicleSeconds',vehicle,'cleaningSeconds',cleaning,'coffeeSeconds',coffee,'otherSeconds',other,'totalSeconds',total,
   'ordinarySeconds',case when planned is not null then least(total,planned) end,
   'extraSeconds',case when planned is not null then greatest(0,total-planned) end,
   'entries',entries,'adjustments',changes));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','plate',j->>'plate','number',j->>'number') order by j->>'plate'),'[]')
 into job_options from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j;
 return jsonb_build_object('day',p_day,'serverNow',statement_timestamp(),'operators',people,'jobs',job_options,'canAdjust',public.is_company_owner(p_company_id));
end $function$
;
CREATE OR REPLACE FUNCTION public.production_hours_report_before_password(p_company_id uuid, p_operator_id text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare member_role text; own_operator text; operator jsonb; snapshot jsonb; stamp timestamptz:=clock_timestamp();
  rows jsonb; worked numeric; ordinary numeric; extra numeric; unconfigured boolean;
begin
  select role into member_role from company_members where company_id=p_company_id and user_id=auth.uid() and active;
  if member_role is null then raise exception 'Accesso aziendale richiesto'; end if;
  select operator_id into own_operator from production_profiles where company_id=p_company_id and user_id=auth.uid();
  if member_role='production' and own_operator is distinct from p_operator_id then raise exception 'Puoi vedere soltanto il tuo monte ore'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Seleziona un periodo massimo di un anno'; end if;
  select payload into snapshot from production_read_snapshots where company_id=p_company_id;
  select o into operator from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o where o->>'id'=p_operator_id;
  if operator is null then raise exception 'Operatore non trovato'; end if;
  with daily as (
    select d::date work_day,
      coalesce((select sum(greatest(0,extract(epoch from(least(coalesce(s.ended_at,stamp),((d::date+1)::timestamp at time zone 'Europe/Rome'))
        -greatest(s.started_at,(d::date::timestamp at time zone 'Europe/Rome'))))))
        from production_live_segments s where s.company_id=p_company_id and s.operator_id=p_operator_id
          and s.started_at<((d::date+1)::timestamp at time zone 'Europe/Rome') and coalesce(s.ended_at,stamp)>(d::date::timestamp at time zone 'Europe/Rome')),0) seconds,
      production_productive_day_seconds(snapshot,p_operator_id,d::date) planned,
      exists(select 1 from production_live_segments s where s.company_id=p_company_id and s.operator_id=p_operator_id and s.ended_at is null
        and s.started_at<((d::date+1)::timestamp at time zone 'Europe/Rome') and stamp>(d::date::timestamp at time zone 'Europe/Rome')
        and d::date=(stamp at time zone 'Europe/Rome')::date) running
    from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d
  ) select jsonb_agg(jsonb_build_object('date',work_day,'workedSeconds',seconds,'plannedSeconds',planned,
      'ordinarySeconds',case when planned is not null then least(seconds,planned) end,
      'extraSeconds',case when planned is not null then greatest(0,seconds-planned) end,'running',running) order by work_day),
      sum(seconds),sum(least(seconds,planned)) filter(where planned is not null),sum(greatest(0,seconds-planned)) filter(where planned is not null),
      bool_or(planned is null and seconds>0)
    into rows,worked,ordinary,extra,unconfigured from daily;
  return jsonb_build_object('operatorId',p_operator_id,'name',operator->>'name','serverNow',stamp,'from',p_from,'to',p_to,
    'days',coalesce(rows,'[]'),'workedSeconds',coalesce(worked,0),'ordinarySeconds',case when unconfigured then null else coalesce(ordinary,0) end,
    'extraSeconds',case when unconfigured then null else coalesce(extra,0) end,'unconfigured',coalesce(unconfigured,false));
end $function$
;
NOTIFY pgrst, 'reload schema';