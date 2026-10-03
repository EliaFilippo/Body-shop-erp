-- Apply after 20261003_live_production.sql. No ERP snapshot rewrites.
begin;
create table if not exists public.production_phase_checks (
  company_id uuid not null,job_id text not null,phase_id text not null,phase_name text not null,
  checked_by uuid not null references auth.users(id),operator_id text not null,operator_name text not null,
  checked_at timestamptz not null default clock_timestamp(),
  worked_seconds numeric not null default 0,
  primary key(company_id,job_id,phase_id),
  foreign key(company_id,job_id) references public.production_live_jobs(company_id,job_id)
);
alter table public.production_phase_checks enable row level security;
revoke all on public.production_phase_checks from anon,authenticated;
create index if not exists production_segments_hours on public.production_live_segments(company_id,operator_id,started_at);

create or replace function public.production_clock_seconds(value text)
returns numeric language sql immutable set search_path=public as $$
  select case when value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then split_part(value,':',1)::numeric*3600+split_part(value,':',2)::numeric*60 else null end;
$$;

-- Freeze the working calendar alongside every segment, separately from financial rates.
create or replace function public.production_operator_schedule(snapshot jsonb,p_operator_id text)
returns jsonb language plpgsql set search_path=public as $$
declare settings jsonb:=snapshot->'plannerSettings'; operator jsonb; weekly jsonb; day jsonb;
  days jsonb:='[]'; intervals jsonb; piece jsonb; weekday integer; capacity numeric; start_sec numeric; end_sec numeric; previous_end numeric;
begin
  select o into operator from jsonb_array_elements(coalesce(settings->'operators','[]')) o where o->>'id'=p_operator_id;
  weekly:=case when jsonb_array_length(coalesce(operator->'weeklySchedule','[]'))>0 then operator->'weeklySchedule' else coalesce(settings->'weeklyWorkSchedule','[]') end;
  for weekday in 0..6 loop
    intervals:='[]'; capacity:=0; previous_end:=null;
    if jsonb_array_length(weekly)>0 then
      select w into day from jsonb_array_elements(weekly) w where (w->>'dayOfWeek')::int=weekday;
      if coalesce((day->>'active')::boolean,false) then
        for piece in select i from jsonb_array_elements(coalesce(day->'intervals','[]')) i order by i->>'startTime' loop
          start_sec:=production_clock_seconds(piece->>'startTime'); end_sec:=production_clock_seconds(piece->>'endTime');
          if start_sec is null or end_sec is null or end_sec<=start_sec or start_sec<previous_end then
            capacity:=null; exit;
          end if;
          capacity:=capacity+end_sec-start_sec; previous_end:=end_sec;
          intervals:=intervals||jsonb_build_array(jsonb_build_object('start',start_sec,'end',end_sec));
        end loop;
      end if;
    elsif exists(select 1 from jsonb_array_elements_text(coalesce(settings->'workingDays','[]')) d where d::int=weekday) then
      capacity:=case when coalesce((operator->>'dailyHours')::numeric,0)>0 then (operator->>'dailyHours')::numeric*3600 else null end;
    end if;
    days:=days||jsonb_build_array(jsonb_build_object('dayOfWeek',weekday,'seconds',capacity,'intervals',intervals));
  end loop;
  return jsonb_build_object('days',days,'holidays',coalesce(settings->'holidays','[]'),'closures',coalesce(settings->'closures','[]'),
    'companyClosures',coalesce(settings->'companyClosures','[]'));
end $$;

create or replace function public.production_day_capacity(schedule jsonb,p_day date)
returns numeric language plpgsql immutable set search_path=public as $$
declare day jsonb; closure jsonb; piece jsonb; capacity numeric; reduced numeric:=0; start_sec numeric; end_sec numeric;
begin
  if schedule is null then return null; end if;
  select d into day from jsonb_array_elements(coalesce(schedule->'days','[]')) d where (d->>'dayOfWeek')::int=extract(dow from p_day);
  capacity:=(day->>'seconds')::numeric;
  if capacity is null then return null; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(schedule->'holidays','[]')||coalesce(schedule->'closures','[]')) h where h=p_day::text) then return 0; end if;
  for closure in select c from jsonb_array_elements(coalesce(schedule->'companyClosures','[]')) c
    where c->>'startDate'<=p_day::text and c->>'endDate'>=p_day::text loop
    start_sec:=production_clock_seconds(closure->>'startTime'); end_sec:=production_clock_seconds(closure->>'endTime');
    if start_sec is not null and end_sec is not null and end_sec>start_sec then
      if jsonb_array_length(coalesce(day->'intervals','[]'))=0 then return null; end if;
      for piece in select i from jsonb_array_elements(day->'intervals') i loop
        reduced:=reduced+greatest(0,least((piece->>'end')::numeric,end_sec)-greatest((piece->>'start')::numeric,start_sec));
      end loop;
    elsif closure->>'type'='mezza-giornata' then reduced:=reduced+capacity/2;
    else return 0; end if;
  end loop;
  return greatest(0,capacity-reduced);
end $$;

create or replace function public.production_hours_report(p_company_id uuid,p_operator_id text,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare member_role text; own_operator text; operator jsonb; snapshot jsonb; stamp timestamptz:=clock_timestamp();
  rows jsonb; worked numeric; ordinary numeric; extra numeric; unconfigured boolean;
begin
  select role into member_role from company_members where company_id=p_company_id and user_id=auth.uid() and active;
  if member_role is null then raise exception 'Accesso aziendale richiesto'; end if;
  select operator_id into own_operator from production_profiles where company_id=p_company_id and user_id=auth.uid();
  if member_role='production' and own_operator is distinct from p_operator_id then raise exception 'Puoi vedere soltanto il tuo monte ore'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Seleziona un periodo massimo di un anno'; end if;
  select payload into snapshot from erp_snapshots where company_id=p_company_id;
  select o into operator from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o where o->>'id'=p_operator_id;
  if operator is null then raise exception 'Operatore non trovato'; end if;
  with daily as (
    select d::date work_day,
      coalesce((select sum(greatest(0,extract(epoch from(least(coalesce(s.ended_at,stamp),((d::date+1)::timestamp at time zone 'Europe/Rome'))
        -greatest(s.started_at,(d::date::timestamp at time zone 'Europe/Rome'))))))
        from production_live_segments s where s.company_id=p_company_id and s.operator_id=p_operator_id
          and s.started_at<((d::date+1)::timestamp at time zone 'Europe/Rome') and coalesce(s.ended_at,stamp)>(d::date::timestamp at time zone 'Europe/Rome')),0) seconds,
      production_day_capacity(coalesce((select s.ordinary_schedule from production_live_segments s
        where s.company_id=p_company_id and s.operator_id=p_operator_id and s.started_at<((d::date+1)::timestamp at time zone 'Europe/Rome')
          and coalesce(s.ended_at,stamp)>(d::date::timestamp at time zone 'Europe/Rome') order by s.started_at,s.id limit 1),
        production_operator_schedule(snapshot,p_operator_id)),d::date) planned,
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
end $$;

create or replace function public.production_job_details(p_company_id uuid,p_job_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job jsonb; profile text; phases jsonb; tasks jsonb;
begin
  select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  select jsonb_agg(jsonb_build_object('id',ph->>'id','name',ph->>'name','notRequired',coalesce((ph->>'notRequired')::boolean,false),
    'status',case when checkmark.phase_id is not null then 'Completata' else ph->>'status' end,
    'checkedBy',checkmark.operator_name,'checkedAt',checkmark.checked_at,'blockedReason',ph->>'blockedReason',
    'canComplete',exists(select 1 from production_live_segments sg where sg.company_id=p_company_id and sg.job_id=p_job_id and sg.operator_id=profile and sg.user_id=auth.uid() and sg.phase_id=ph->>'id'))
    order by coalesce((ph->>'cycleOrder')::numeric,ord)) into phases
    from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality source(ph,ord)
    left join production_phase_checks checkmark on checkmark.company_id=p_company_id and checkmark.job_id=p_job_id and checkmark.phase_id=ph->>'id';
  select jsonb_agg(jsonb_build_object('id',line->>'id','description',line->>'description','panel',line->>'panelName','quantity',line->'quantity') order by ord)
    into tasks from jsonb_array_elements(coalesce(job->'lines','[]')) with ordinality source(line,ord);
  return jsonb_build_object('phases',coalesce(phases,'[]'),'tasks',coalesce(tasks,'[]'));
end $$;

create or replace function public.production_complete_phase(p_company_id uuid,p_job_id text,p_phase_id text)
returns void language plpgsql security definer set search_path=public as $$
declare profile text; phase jsonb; job jsonb; name text; phase_order bigint; worked numeric;
begin
  if not public.is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  if profile is null then raise exception 'Collega il tuo profilo operatore'; end if;
  if exists(select 1 from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id) then return; end if;
  select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
  select ph,ord into phase,phase_order from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality source(ph,ord) where ph->>'id'=p_phase_id;
  if phase is null or coalesce((phase->>'notRequired')::boolean,false) or phase->>'status' in ('Completata','Bloccata') then raise exception 'Fase non completabile'; end if;
  if phase->>'name'='Controllo qualità' and exists(select 1 from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality source(ph,ord)
      where ord<phase_order and not coalesce((ph->>'notRequired')::boolean,false) and ph->>'status'<>'Completata'
        and not exists(select 1 from production_phase_checks pc where pc.company_id=p_company_id and pc.job_id=p_job_id and pc.phase_id=ph->>'id'))
    then raise exception 'Completa le fasi precedenti prima del Controllo qualità'; end if;
  if not exists(select 1 from production_live_segments where company_id=p_company_id and job_id=p_job_id and operator_id=profile and user_id=auth.uid() and phase_id=p_phase_id)
    then raise exception 'Puoi mettere il visto soltanto sulle fasi che hai lavorato'; end if;
  if exists(select 1 from production_live_sessions where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and operator_id<>profile and status='running')
    then raise exception 'Un collega sta ancora lavorando su questa fase: deve prima premere Fine o Pausa'; end if;
  -- End only a segment actually running on this phase; preserve other phases/cars.
  if exists(select 1 from production_live_sessions where company_id=p_company_id and job_id=p_job_id and operator_id=profile and phase_id=p_phase_id and status='running') then
    perform production_timer_action(p_company_id,p_job_id,'finish',p_phase_id);
  end if;
  select operator_name into name from production_live_sessions where company_id=p_company_id and job_id=p_job_id and operator_id=profile;
  select coalesce(sum(extract(epoch from(ended_at-started_at))),0) into worked from production_live_segments
    where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and ended_at is not null;
  insert into production_phase_checks(company_id,job_id,phase_id,phase_name,checked_by,operator_id,operator_name,worked_seconds)
    values(p_company_id,p_job_id,p_phase_id,phase->>'name',auth.uid(),profile,name,worked);
end $$;
create or replace function public.production_phase_updates(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('jobId',job_id,'phaseId',phase_id,'checkedBy',operator_name,'checkedAt',checked_at,'workedSeconds',worked_seconds))
    from production_phase_checks where company_id=p_company_id),'[]'::jsonb);
end $$;
revoke all on function public.production_clock_seconds(text),public.production_operator_schedule(jsonb,text),public.production_day_capacity(jsonb,date),
  public.production_job_details(uuid,text),public.production_hours_report(uuid,text,date,date),public.production_complete_phase(uuid,text,text),public.production_phase_updates(uuid) from public;
grant execute on function public.production_hours_report(uuid,text,date,date),public.production_complete_phase(uuid,text,text),public.production_phase_updates(uuid) to authenticated;
commit;
