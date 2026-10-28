begin;
-- Archived signatures are retained when an operator explicitly starts additional work.
create table if not exists public.production_phase_check_history(
 id bigint generated always as identity primary key,company_id uuid not null references companies(id),
 job_id text not null,phase_id text not null,previous_check jsonb not null,
 reopened_by uuid not null references auth.users(id),reopened_at timestamptz not null default clock_timestamp()
);
alter table production_phase_check_history enable row level security;
revoke all on production_phase_check_history from public,anon,authenticated;
create or replace function public.production_effective_phases(p_company_id uuid,job jsonb)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with work as materialized (
  select phase_id,min(started_at) first_start,max(started_at) last_start,
   max(started_at) filter(where manual_start) manual_start,
   coalesce(sum(extract(epoch from(ended_at-started_at))) filter(where ended_at is not null),0) closed_seconds
  from production_live_segments where company_id=p_company_id and job_id=job->>'id' and phase_id is not null group by phase_id
 ), source as (
  select ph,ord,w.*,c.checked_at,c.operator_name signer,c.worked_seconds,
   case when c.checked_at is not null and c.checked_at>=w.last_start then 'Completata'
    when w.last_start is not null and (ph->>'status' is distinct from 'Completata' or coalesce((ph->>'notRequired')::boolean,false)
     or w.manual_start>coalesce(nullif(ph->>'completedAt','')::timestamptz,'-infinity')) then 'In lavorazione'
    else ph->>'status' end actual_status
  from jsonb_array_elements(production_manual_phases(job)) with ordinality src(ph,ord)
  left join work w on w.phase_id=ph->>'id'
  left join production_phase_checks c on c.company_id=p_company_id and c.job_id=job->>'id' and c.phase_id=ph->>'id'
 ) select coalesce(jsonb_agg(
  case when last_start is null then ph else
   (case when actual_status<>'Completata' then ph-'completedAt'-'completedByName'-'endedAt' else ph end)
   || jsonb_build_object('notRequired',false,'status',actual_status,'manualWorkTracked',manual_start is not null,
    'lastManualStartedAt',manual_start,'serverWorkTracked',true,'manualExtra',coalesce((ph->>'manualExtra')::boolean,false) or coalesce((ph->>'notRequired')::boolean,false),'startedAt',first_start,'actualMinutes',closed_seconds/60,
    'technicalWaitMinutes',case when ph->>'name'='Verniciatura' then greatest(60,coalesce((ph->>'technicalWaitMinutes')::integer,60)) else coalesce((ph->>'technicalWaitMinutes')::integer,0) end,
    'technicalWaitBlocksPhaseNames',coalesce(ph->'technicalWaitBlocksPhaseNames','[]')||case when ph->>'name'='Verniciatura' then '["Scartatura","Rimontaggio","Meccanica / gommista","Lucidatura","Lavaggio interni","Ritocchi","Trasporto"]'::jsonb else '[]'::jsonb end,
    'remainingTimeUnknown',actual_status<>'Completata' and coalesce((ph->>'estimatedMinutes')::numeric,0)<=0 and coalesce((ph->>'sharedTimeMinutes')::numeric,0)<=0)
   || case when checked_at is not null and actual_status='Completata' then jsonb_build_object('completedAt',checked_at,'endedAt',checked_at,'completedByName',signer,'tabletWorkedSeconds',worked_seconds) else '{}'::jsonb end
  end order by coalesce((ph->>'cycleOrder')::numeric,ord),ord),'[]') from source;
$$;
revoke all on function production_effective_phases(uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.production_phase_definitions(p_company_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('jobId',j->>'id','phase',ph)),'[]')
 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
 jsonb_array_elements(production_effective_phases(p_company_id,j)) ph
 where s.company_id=p_company_id and coalesce((ph->>'serverWorkTracked')::boolean,false);
$$;
revoke all on function production_phase_definitions(uuid) from public,anon,authenticated,service_role;
-- Entry identity and company locks stay in the existing Start RPC.
do $$begin
 if to_regprocedure('public.production_manual_start_before_progress(uuid,text,text)') is null then
  alter function production_manual_start(uuid,text,text) rename to production_manual_start_before_progress;
 end if;
 if to_regprocedure('public.production_complete_phase_before_manual_progress(uuid,text,text)') is null then
  alter function production_complete_phase(uuid,text,text) rename to production_complete_phase_before_manual_progress;
 end if;
 if to_regprocedure('public.production_planning_state_before_manual_progress(uuid)') is null then
  alter function production_planning_state(uuid) rename to production_planning_state_before_manual_progress;
 end if;
 if to_regprocedure('public.production_nightly_claim_before_manual_progress(uuid,text)') is null then
  alter function production_nightly_claim(uuid,text) rename to production_nightly_claim_before_manual_progress;
 end if;
end $$;
revoke all on function production_manual_start_before_progress(uuid,text,text),production_complete_phase_before_manual_progress(uuid,text,text),
 production_planning_state_before_manual_progress(uuid),production_nightly_claim_before_manual_progress(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.production_manual_start(p_company_id uuid,p_job_id text,p_phase_id text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text;before_id bigint;new_start timestamptz;old_check record;
begin
 if not is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 select coalesce(max(id),0) into before_id from production_live_segments where company_id=p_company_id and operator_id=profile;
 perform production_manual_start_before_progress(p_company_id,p_job_id,p_phase_id);
 select max(started_at) into new_start from production_live_segments where company_id=p_company_id and operator_id=profile and job_id=p_job_id and phase_id=p_phase_id and id>before_id;
 if new_start is not null then
  select * into old_check from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and checked_at<new_start;
  if found then
   insert into production_phase_check_history(company_id,job_id,phase_id,previous_check,reopened_by) values(p_company_id,p_job_id,p_phase_id,to_jsonb(old_check),auth.uid());
   delete from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id;
  end if;
 end if;
end $$;
revoke all on function production_manual_start(uuid,text,text) from public,anon;
grant execute on function production_manual_start(uuid,text,text) to authenticated;
create or replace function public.production_complete_phase(p_company_id uuid,p_job_id text,p_phase_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text;job jsonb;phase jsonb;name text;worked numeric;last_start timestamptz;old_check record;
begin
 if not is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if profile is null or not exists(select 1 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o where s.company_id=p_company_id and o->>'id'=profile and coalesce((o->>'active')::boolean,false)) then raise exception 'Collega un operatore attivo al profilo';end if;
 select max(started_at) into last_start from production_live_segments where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and operator_id=profile and user_id=auth.uid();
 if last_start is null or not exists(select 1 from production_live_segments where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and manual_start) then perform production_complete_phase_before_manual_progress(p_company_id,p_job_id,p_phase_id);return;end if;
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 select p into phase from jsonb_array_elements(production_effective_phases(p_company_id,job)) p where p->>'id'=p_phase_id;
 if job is null or job->>'status' in ('Consegnata','Annullata') or phase is null or phase->>'name'='Consegna' then raise exception 'Fase non completabile';end if;
 if exists(select 1 from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and checked_at>=last_start) then return;end if;
 if exists(select 1 from production_live_sessions where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and operator_id<>profile and status='running') then raise exception 'Un collega sta ancora lavorando su questa fase: deve prima premere Fine o Pausa';end if;
 if exists(select 1 from production_live_sessions where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and operator_id=profile and status='running') then perform production_timer_action(p_company_id,p_job_id,'finish',p_phase_id);end if;
 select operator_name into name from production_live_sessions where company_id=p_company_id and job_id=p_job_id and operator_id=profile;
 select coalesce(sum(extract(epoch from(ended_at-started_at))),0) into worked from production_live_segments where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id and ended_at is not null;
 select * into old_check from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id;
 if found then
  insert into production_phase_check_history(company_id,job_id,phase_id,previous_check,reopened_by) values(p_company_id,p_job_id,p_phase_id,to_jsonb(old_check),auth.uid());
  delete from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id;
 end if;
 insert into production_phase_checks(company_id,job_id,phase_id,phase_name,checked_by,operator_id,operator_name,worked_seconds)
 values(p_company_id,p_job_id,p_phase_id,phase->>'name',auth.uid(),profile,name,worked);
end $$;
revoke all on function production_complete_phase(uuid,text,text) from public,anon;
grant execute on function production_complete_phase(uuid,text,text) to authenticated;
create or replace function public.production_current_phase_checks(p_company_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('jobId',c.job_id,'phaseId',c.phase_id,'checkedBy',c.operator_name,'checkedAt',c.checked_at,'workedSeconds',c.worked_seconds)),'[]')
 from production_phase_checks c where c.company_id=p_company_id and not exists(select 1 from production_live_segments w
  where w.company_id=c.company_id and w.job_id=c.job_id and w.phase_id=c.phase_id and w.manual_start and w.started_at>c.checked_at);
$$;
revoke all on function production_current_phase_checks(uuid) from public,anon,authenticated,service_role;
create or replace function public.production_phase_updates(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto';end if;
 return production_current_phase_checks(p_company_id);
end $$;
revoke all on function production_phase_updates(uuid) from public,anon;
grant execute on function production_phase_updates(uuid) to authenticated;

create or replace function public.production_planning_state(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare state jsonb;
begin
 state:=production_planning_state_before_manual_progress(p_company_id);
 return state||jsonb_build_object('phaseStates',production_phase_definitions(p_company_id),'checks',production_phase_updates(p_company_id));
end $$;
revoke all on function production_planning_state(uuid) from public,anon;
grant execute on function production_planning_state(uuid) to authenticated;
create or replace function public.production_nightly_claim(p_company_id uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare claim jsonb;checks jsonb;
begin
 claim:=production_nightly_claim_before_manual_progress(p_company_id,p_secret);
 if claim is null then return null;end if;
 claim:=jsonb_set(claim,'{checks}',production_current_phase_checks(p_company_id));
 return jsonb_set(claim,'{state,phaseStates}',production_phase_definitions(p_company_id));
end $$;
revoke all on function production_nightly_claim(uuid,text) from public,anon,authenticated;
grant execute on function production_nightly_claim(uuid,text) to service_role;

create or replace function public.production_timer_action(p_company_id uuid,p_job_id text,p_action text,p_phase_id text default null)
returns void language plpgsql security definer set search_path=public as $$
declare profile text; operator jsonb; current_status text; current_phase text; snapshot jsonb; job jsonb; phase jsonb; stamp timestamptz:=clock_timestamp();
begin
  if not public.is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  -- Take time after waiting for the lock, never backdate overlapping actions.
  stamp:=clock_timestamp();
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  if profile is null then raise exception 'Il titolare deve collegare questo account a un operatore'; end if;
  if not exists(select 1 from erp_snapshots s, jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
      where s.company_id=p_company_id and o->>'id'=profile and (o->>'active')::boolean)
    then raise exception 'Operatore disattivato'; end if;
  select r into operator from production_live_jobs j,jsonb_array_elements(j.operator_rates) r
    where j.company_id=p_company_id and j.job_id=p_job_id and r->>'id'=profile;
  if operator is null then raise exception 'Budget non confermato per questo operatore'; end if;
  select status,phase_id into current_status,current_phase from production_live_sessions
    where company_id=p_company_id and job_id=p_job_id and operator_id=profile;
  if p_action='start' then
    if current_status='running' and current_phase is not distinct from p_phase_id then return; end if;
    if current_status='running' then raise exception 'Metti in pausa prima di cambiare fase'; end if;
    if exists(select 1 from production_live_sessions where company_id=p_company_id and operator_id=profile and status='running')
      then raise exception 'Metti in pausa la vettura già avviata prima di iniziarne un’altra'; end if;
    if not exists(select 1 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j
      where s.company_id=p_company_id and j->>'id'=p_job_id and j->>'status' not in ('Consegnata','Annullata'))
      then raise exception 'La commessa è chiusa'; end if;
    select payload into snapshot from erp_snapshots where company_id=p_company_id;
    select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'id'=p_job_id;
    job:=jsonb_set(job,'{phases}',production_effective_phases(p_company_id,job));
    if exists(select 1 from jsonb_array_elements(coalesce(job->'phases','[]')) ph where not coalesce((ph->>'notRequired')::boolean,false)) then
      select ph into phase from jsonb_array_elements(job->'phases') ph where ph->>'id'=p_phase_id;
      if phase is null or coalesce((phase->>'notRequired')::boolean,false) then raise exception 'Scegli una fase da lavorare'; end if;
      if phase->>'status' in ('Completata','Bloccata') or exists(select 1 from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=p_phase_id)
        then raise exception 'La fase è completata o bloccata'; end if;
    elsif p_phase_id is not null then raise exception 'Fase non disponibile'; end if;
    insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
      values(p_company_id,p_job_id,profile,auth.uid(),operator->>'name','running',p_phase_id)
      on conflict(company_id,job_id,operator_id) do update set status='running',user_id=auth.uid(),phase_id=excluded.phase_id;
    insert into production_live_segments(company_id,job_id,operator_id,rate,started_at,phase_id,ordinary_schedule)
      values(p_company_id,p_job_id,profile,(operator->>'rate')::numeric,stamp,p_phase_id,production_operator_schedule(snapshot,profile));
  elsif p_action in ('pause','finish') then
    if current_status is null then raise exception 'Nessun lavoro avviato su questa vettura'; end if;
    -- Stop the caller only. A colleague may still be working on this job.
    update production_live_segments set ended_at=stamp
      where company_id=p_company_id and job_id=p_job_id and operator_id=profile and ended_at is null;
    update production_live_sessions set status=case when p_action='finish' then 'finished'
      when current_status='finished' then 'finished' else 'paused' end
      where company_id=p_company_id and job_id=p_job_id and operator_id=profile;
  else raise exception 'Comando non valido'; end if;
end $$;


create or replace function public.production_operator_can_phase(p_company_id uuid,p_job_id text,p_operator_id text,p_phase_id text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare op jsonb;job jsonb;phase jsonb;
begin
 select o into op from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o where s.company_id=p_company_id and o->>'id'=p_operator_id;
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 select ph into phase from jsonb_array_elements(production_effective_phases(p_company_id,job)) ph where ph->>'id'=p_phase_id;
 return production_phase_matches_operator(op,phase);
end $$;
revoke all on function production_operator_can_phase(uuid,text,text,text) from public,anon,authenticated;
create or replace function public.production_cycle_gate(p_company_id uuid,p_job_id text,p_phase_id text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare job jsonb;
begin
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 job:=jsonb_set(job,'{phases}',production_effective_phases(p_company_id,job));
 return production_cycle_gate_for_job(p_company_id,job,p_phase_id);
end $$;
revoke all on function production_cycle_gate(uuid,text,text) from public,anon,authenticated;

create or replace function public.production_job_details(p_company_id uuid,p_job_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job jsonb;profile text;phases jsonb;tasks jsonb;
begin
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 job:=jsonb_set(job,'{phases}',production_effective_phases(p_company_id,job));
 with source as materialized (
  select ph,ord,production_cycle_gate_for_job(p_company_id,job,ph->>'id') gate
  from jsonb_array_elements(job->'phases') with ordinality s(ph,ord)
 )
 select jsonb_agg(jsonb_build_object('id',ph->>'id','name',ph->>'name','notRequired',coalesce((ph->>'notRequired')::boolean,false),
 'status',case when coalesce((ph->>'manualWorkTracked')::boolean,false) and ph->>'status'='In lavorazione' then 'In lavorazione' when coalesce((ph->>'notRequired')::boolean,false) then 'Non prevista' when checkmark.phase_id is not null then 'Completata' when ph->>'status'='Completata' then 'Completata'
  when not coalesce((ph->>'notRequired')::boolean,false) and gate<>'' then 'Bloccata' else ph->>'status' end,
 'checkedBy',checkmark.operator_name,'checkedAt',checkmark.checked_at,'blockedReason',coalesce(nullif(gate,''),ph->>'blockedReason'),
 'automaticReady',coalesce(gate,'')='','manualExtra',coalesce((ph->>'manualExtra')::boolean,false),'manualWorkTracked',coalesce((ph->>'manualWorkTracked')::boolean,false),'remainingTimeUnknown',coalesce((ph->>'remainingTimeUnknown')::boolean,false),
 'canComplete',ph->>'status' is distinct from 'Completata' and exists(select 1 from production_live_segments sg where sg.company_id=p_company_id and sg.job_id=p_job_id and sg.operator_id=profile and sg.user_id=auth.uid() and sg.phase_id=ph->>'id'))
 order by coalesce((ph->>'cycleOrder')::numeric,ord)) into phases
 from source left join production_phase_checks checkmark on checkmark.company_id=p_company_id and checkmark.job_id=p_job_id and checkmark.phase_id=ph->>'id';
 select jsonb_agg(jsonb_build_object('id',line->>'id','description',line->>'description','panel',line->>'panelName','quantity',line->'quantity') order by ord)
 into tasks from jsonb_array_elements(coalesce(job->'lines','[]')) with ordinality source(line,ord);
 return jsonb_build_object('phases',coalesce(phases,'[]'),'tasks',coalesce(tasks,'[]'));
end $$;
revoke all on function production_job_details(uuid,text) from public,anon,authenticated;

create or replace function public.guard_production_cycle_start()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; has_phases boolean;
begin
 reason:=production_unquoted_drying_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason;end if;
 -- Manual work is an explicit authenticated choice, recorded on the immutable work segment.
 if new.manual_start then
  if not is_active_company_member(new.company_id) or not exists(
   select 1 from production_profiles p where p.company_id=new.company_id and p.user_id=auth.uid() and p.operator_id=new.operator_id
  ) then raise exception 'Accesso operatore richiesto' using errcode='42501';end if;
  return new;
 end if;
 select exists(select 1 from jsonb_array_elements(production_effective_phases(new.company_id,j)) p where not coalesce((p->>'notRequired')::boolean,false)) into has_phases from erp_snapshots s,
  jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=new.company_id and j->>'id'=new.job_id;
 if coalesce(has_phases,false) and not production_operator_can_phase(new.company_id,new.job_id,new.operator_id,new.phase_id)
  then raise exception 'Mansione non abilitata per questo operatore' using errcode='42501';end if;
 reason:=production_cycle_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason;end if;
 return new;
end $$;
revoke all on function guard_production_cycle_start() from public,anon,authenticated;
create or replace function public.production_time_facts(p_company_id uuid)
returns table(job_id text,plate text,number text,group_key text,label text,assigned_seconds numeric,
 spent_seconds numeric,active_count bigint,operators jsonb,completed boolean,completed_at timestamptz,closed boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 with frozen_groups as (
  select j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key) group_key,
   max(e.value->>'label') label,max(coalesce((e.value->>'minutes')::numeric,0))*60 assigned_seconds,
   array_agg(e.key) members
  from production_live_jobs j,jsonb_each(j.phase_time_limits) e where j.company_id=p_company_id
  group by j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key)
 ), payloads as (
  select jsonb_set(j,'{phases}',production_effective_phases(p_company_id,j)) j from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id
 ), extras as (
  select lj.job_id,lj.plate,lj.number,seg.phase_id group_key,max(ph->>'name') label,0::numeric assigned_seconds,array[seg.phase_id] members
  from production_live_segments seg join production_live_jobs lj using(company_id,job_id)
  join payloads p on p.j->>'id'=seg.job_id
  cross join lateral jsonb_array_elements(production_manual_phases(p.j)) ph
  where seg.company_id=p_company_id and seg.manual_start and ph->>'id'=seg.phase_id
   and not exists(select 1 from jsonb_each(lj.phase_time_limits) e where e.key=seg.phase_id)
  group by lj.job_id,lj.plate,lj.number,seg.phase_id
 ), groups as (select * from frozen_groups union all select * from extras)
 select g.job_id,g.plate,g.number,g.group_key,g.label,g.assigned_seconds,
  coalesce(work.spent,0),coalesce(work.active,0),coalesce(work.people,'[]'),
  coalesce(work.active,0)=0 and coalesce(work.spent,0)>0
   and exists(select 1 from jsonb_array_elements(coalesce(p.j->'phases','[]')) ph
     where ph->>'id'=any(g.members) and not coalesce((ph->>'notRequired')::boolean,false))
   and not exists(select 1 from jsonb_array_elements(coalesce(p.j->'phases','[]')) ph
     where ph->>'id'=any(g.members) and not coalesce((ph->>'notRequired')::boolean,false)
      and ph->>'status' is distinct from 'Completata'
      and not exists(select 1 from production_phase_checks c where c.company_id=p_company_id and c.job_id=g.job_id and c.phase_id=ph->>'id')),
  work.last_end,coalesce(p.j->>'status' in ('Consegnata','Annullata'),true)
 from groups g left join payloads p on p.j->>'id'=g.job_id
 left join lateral (
  select sum(seconds) spent,sum(active) active,max(last_end) last_end,
   jsonb_agg(jsonb_build_object('operatorId',op,'name',name,'seconds',seconds)) people
  from (
   select seg.operator_id op,max(sess.operator_name) name,
    sum(greatest(0,extract(epoch from(coalesce(seg.ended_at,statement_timestamp())-seg.started_at)))) seconds,
    count(*) filter(where seg.ended_at is null) active,max(seg.ended_at) last_end
   from production_live_segments seg join production_live_sessions sess using(company_id,job_id,operator_id)
   where seg.company_id=p_company_id and seg.job_id=g.job_id and seg.phase_id=any(g.members)
   group by seg.operator_id
  ) q
 ) work on true;
$$;


revoke all on function production_time_facts(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed_before_cones(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;profile text;item jsonb;phases jsonb;jobs jsonb:='[]';program jsonb:='[]';snapshot jsonb;op jsonb;
 allowed jsonb;open_jobs jsonb;task jsonb;card jsonb;chosen jsonb;seen text[]:='{}';key text;
begin
 result:=production_live_feed_before_duties(p_company_id);
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 select value into op from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) where value->>'id'=profile;
 select coalesce(jsonb_object_agg(j->>'id',ids),'{}'),coalesce(jsonb_agg(j->'id') filter(where coalesce(j->>'status','') not in ('Consegnata','Annullata')),'[]')
 into allowed,open_jobs from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j
 cross join lateral (select coalesce(jsonb_agg(p->'id'),'[]') ids from jsonb_array_elements(production_effective_phases(p_company_id,j)) p
 where production_phase_matches_operator(op,p)) permitted;
 for item in select value from jsonb_array_elements(coalesce(result->'jobs','[]')) loop
  if not(open_jobs ? (item->>'jobId')) and coalesce(item->>'ownStatus','') not in ('running','paused') then continue;end if;
  select coalesce(jsonb_agg(ph||jsonb_build_object('automaticAllowed',coalesce((allowed->(item->>'jobId')) ? (ph->>'id'),false)
   and coalesce((ph->>'automaticReady')::boolean,true) and not coalesce((ph->>'remainingTimeUnknown')::boolean,false))),'[]')
  into phases from jsonb_array_elements(coalesce(item->'phases','[]')) ph;
  jobs:=jobs||jsonb_build_array(item||jsonb_build_object('phases',phases,'dutiesFiltered',false,'manualStartAllowed',open_jobs ? (item->>'jobId')));
 end loop;
 -- Keep the daily vehicle order; refresh its phase against real work instead of replaying a stale task.
 for task in select t from jsonb_array_elements(coalesce(snapshot->'operatorPrograms','[]')) p,
  jsonb_array_elements(coalesce(p->'tasks','[]')) t where p->>'operatorId'=profile order by t->>'startAt' loop
  select j into card from jsonb_array_elements(jobs) j where j->>'jobId'=task->>'jobId';
  if not(open_jobs ? (task->>'jobId')) then continue;end if;
  if card is null then
   key:=(task->>'jobId')||':'||(task->>'phaseId');if key=any(seen) then continue;end if;seen:=array_append(seen,key);
   program:=program||jsonb_build_array(jsonb_build_object('id',task->>'id','jobId',task->>'jobId','plate',task->>'plate','phaseId',task->>'phaseId','phaseName',task->>'phaseName','startAt',task->>'startAt','endAt',task->>'endAt','panels',coalesce(task->'panelNames','[]'),'ready',false));
   continue;
  end if;
  select ph into chosen from jsonb_array_elements(card->'phases') with ordinality src(ph,ord) where (ph->>'automaticAllowed')::boolean
   and ph->>'status' not in ('Completata','Bloccata') and not coalesce((ph->>'notRequired')::boolean,false)
   order by case when ph->>'id'=task->>'phaseId' then 0 else 1 end,ord limit 1;
  if chosen is null then continue;end if;
  key:=(task->>'jobId')||':'||(chosen->>'id');if key=any(seen) then continue;end if;seen:=array_append(seen,key);
  program:=program||jsonb_build_array(jsonb_build_object('id',(task->>'id')||':'||(chosen->>'id'),'jobId',task->>'jobId','plate',card->>'plate',
   'phaseId',chosen->>'id','phaseName',chosen->>'name','startAt',task->>'startAt','endAt',task->>'endAt',
   'panels',coalesce(task->'panelNames','[]'),'ready',true,'updatedFromManual',(chosen->>'id') is distinct from (task->>'phaseId')));
 end loop;
 return result||jsonb_build_object('jobs',jobs,'program',program,'dutiesFiltered',false,'manualSelection',true);
end $$;
revoke all on function production_live_feed_before_cones(uuid) from public,anon,authenticated;

create or replace function public.production_cycle_gate_for_job(p_company_id uuid,job jsonb,p_phase_id text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare phase jsonb;predecessor jsonb;target_order bigint;completed timestamptz;stamp timestamptz:=clock_timestamp();
begin
 if job->>'workflowCycle' is distinct from 'elias-v1' then return '';end if;
 select ph,ord into phase,target_order from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality source(ph,ord) where ph->>'id'=p_phase_id;
 if phase is null then return 'Scegli una fase da lavorare';end if;
 if phase->>'name'='Consegna' then return 'La consegna viene registrata dall’ufficio';end if;
 for predecessor in select ph from jsonb_array_elements(job->'phases') with ordinality source(ph,ord)
  where ord<target_order and not coalesce((ph->>'notRequired')::boolean,false) loop
  select checked_at into completed from production_phase_checks where company_id=p_company_id and job_id=job->>'id' and phase_id=predecessor->>'id' and checked_at>=coalesce(nullif(predecessor->>'lastManualStartedAt','')::timestamptz,'-infinity');
  if completed is null and predecessor->>'status' is distinct from 'Completata' then return 'Completa le fasi precedenti prima di iniziare questa fase';end if;
  if predecessor->>'name'='Verniciatura' then
   completed:=coalesce(completed,nullif(predecessor->>'completedAt','')::timestamptz,nullif(predecessor->>'endedAt','')::timestamptz);
   if completed is null then return 'Registra l’orario di fine verniciatura';end if;
   if completed+interval '1 hour'>stamp then return 'Attesa asciugatura fino alle '||to_char((completed+interval '1 hour') at time zone 'Europe/Rome','HH24:MI');end if;
  end if;
 end loop;
 return '';
end $$;
revoke all on function public.production_cycle_gate_for_job(uuid,jsonb,text) from public,anon,authenticated;


notify pgrst,'reload schema';
commit;
