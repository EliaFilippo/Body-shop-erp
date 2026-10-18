-- Aggiornamento completo: eseguire tutto nel SQL Editor. Conserva i timer registrati.
begin;
-- All times are productive person-seconds. Existing financial budgets and segments are untouched.
create table if not exists public.production_time_assignments (
 company_id uuid not null, job_id text not null, group_key text not null,
 weights jsonb not null default '{}', captured_at timestamptz not null default now(),
 primary key(company_id,job_id,group_key),
 foreign key(company_id,job_id) references production_live_jobs(company_id,job_id)
);
create table if not exists public.production_overrun_alerts (
 id bigint generated always as identity primary key, company_id uuid not null,
 job_id text not null, group_key text not null, phase_label text not null,
 detected_at timestamptz not null default now(), acknowledged_at timestamptz,
 acknowledged_by uuid references auth.users(id),
 unique(company_id,job_id,group_key),
 foreign key(company_id,job_id) references production_live_jobs(company_id,job_id)
);
alter table public.production_time_assignments enable row level security;
alter table public.production_overrun_alerts enable row level security;
revoke all on public.production_time_assignments,public.production_overrun_alerts from public,anon,authenticated;
-- A historical shared group has no reliable personal plan: do not invent one retrospectively.
insert into production_time_assignments(company_id,job_id,group_key)
 select distinct s.company_id,s.job_id,coalesce(j.phase_time_limits->s.phase_id->>'key',s.phase_id)
 from production_live_segments s join production_live_jobs j using(company_id,job_id)
 where s.phase_id is not null on conflict do nothing;
create or replace function public.production_capture_time_assignment()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare limits jsonb; g text; weights jsonb;
begin
 if new.phase_id is null then return new;end if;
 select phase_time_limits into limits from production_live_jobs where company_id=new.company_id and job_id=new.job_id;
 g:=coalesce(limits->new.phase_id->>'key',new.phase_id);
 -- Frozen at first actual Start, never rewritten by a later reassignment or snapshot refresh.
 select coalesce(jsonb_object_agg(op,to_jsonb(minutes)),'{}') into weights from (
  select t->>'operatorId' op,sum(greatest(0,coalesce((t->>'plannedMinutes')::numeric,0))) minutes
  from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'operatorPrograms','[]')) p,
   jsonb_array_elements(coalesce(p->'tasks','[]')) t
  where s.company_id=new.company_id and t->>'jobId'=new.job_id
   and coalesce(limits->(t->>'phaseId')->>'key',t->>'phaseId')=g
   and nullif(t->>'operatorId','') is not null
  group by t->>'operatorId' having sum(greatest(0,coalesce((t->>'plannedMinutes')::numeric,0)))>0
 ) q;
 insert into production_time_assignments(company_id,job_id,group_key,weights)
  values(new.company_id,new.job_id,g,weights) on conflict do nothing;
 return new;
end $$;
revoke all on function public.production_capture_time_assignment() from public,anon,authenticated;
drop trigger if exists production_capture_time_assignment on public.production_live_segments;
create trigger production_capture_time_assignment after insert on public.production_live_segments
 for each row execute function public.production_capture_time_assignment();
-- One fact per allowance, including retired legacy members for worked time, without multiplying S/R or I/S.
create or replace function public.production_time_facts(p_company_id uuid)
returns table(job_id text,plate text,number text,group_key text,label text,assigned_seconds numeric,
 spent_seconds numeric,active_count bigint,operators jsonb,completed boolean,completed_at timestamptz,closed boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 with groups as (
  select j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key) group_key,
   max(e.value->>'label') label,max(coalesce((e.value->>'minutes')::numeric,0))*60 assigned_seconds,
   array_agg(e.key) members
  from production_live_jobs j,jsonb_each(j.phase_time_limits) e where j.company_id=p_company_id
  group by j.job_id,j.plate,j.number,coalesce(e.value->>'key',e.key)
 ), payloads as (
  select j from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id
 )
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
revoke all on function public.production_time_facts(uuid) from public,anon,authenticated;
create or replace function public.production_scan_overruns(p_company_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
 insert into production_overrun_alerts(company_id,job_id,group_key,phase_label)
 select p_company_id,f.job_id,f.group_key,coalesce(f.label,'Lavorazione') from production_time_facts(p_company_id) f
 where not f.closed and f.assigned_seconds>0 and f.spent_seconds>f.assigned_seconds
 on conflict(company_id,job_id,group_key) do nothing;
$$;
revoke all on function public.production_scan_overruns(uuid) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.production_live_feed_before_overruns(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_overruns;
 end if;
end $$;
revoke all on function public.production_live_feed_before_overruns(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; item jsonb; ph jsonb; jobs jsonb:='[]'; phases jsonb; limits jsonb; facts jsonb; g text; extra numeric;
begin
 result:=production_live_feed_before_overruns(p_company_id); -- original tenant and role checks
 perform production_scan_overruns(p_company_id);
 for item in select value from jsonb_array_elements(result->'jobs') loop
  phases:='[]';
  select phase_time_limits into limits from production_live_jobs where company_id=p_company_id and job_id=item->>'jobId';
  select coalesce(jsonb_object_agg(f.group_key,to_jsonb(greatest(0,f.spent_seconds-f.assigned_seconds))),'{}') into facts
   from production_time_facts(p_company_id) f where f.job_id=item->>'jobId' and f.assigned_seconds>0;
  for ph in select value from jsonb_array_elements(coalesce(item->'phases','[]')) loop
   g:=coalesce(limits->(ph->>'id')->>'key',ph->>'id'); extra:=coalesce((facts->>g)::numeric,0);
   if jsonb_typeof(ph->'standardClock')='object' then
    ph:=jsonb_set(ph,'{standardClock}',(ph->'standardClock')||jsonb_build_object('overrunSeconds',extra));
   end if;
   phases:=phases||jsonb_build_array(ph);
  end loop;
  jobs:=jobs||jsonb_build_array(item||jsonb_build_object('phases',phases));
 end loop;
 return result||jsonb_build_object('jobs',jobs);
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
-- Office only: durable alerts and a weighted productivity score for completed comparable groups.
create or replace function public.production_control_report(p_company_id uuid,p_from date,p_to date,p_ack_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare alerts jsonb; people jsonb; teams jsonb;
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Periodo non valido';end if;
 perform production_scan_overruns(p_company_id);
 if p_ack_id is not null then
  update production_overrun_alerts set acknowledged_at=coalesce(acknowledged_at,now()),acknowledged_by=coalesce(acknowledged_by,auth.uid())
   where id=p_ack_id and company_id=p_company_id;
  if not found then raise exception 'Avviso non disponibile';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'jobId',a.job_id,'plate',j.plate,'number',j.number,
  'phase',a.phase_label,'detectedAt',a.detected_at,'acknowledgedAt',a.acknowledged_at,
  'overrunSeconds',greatest(0,coalesce(f.spent_seconds,0)-coalesce(f.assigned_seconds,0)),
  'operators',coalesce(f.operators,'[]'),'active',coalesce(f.active_count,0)>0) order by a.detected_at desc),'[]') into alerts
 from production_overrun_alerts a join production_live_jobs j using(company_id,job_id)
 left join production_time_facts(p_company_id) f on f.job_id=a.job_id and f.group_key=a.group_key
 where a.company_id=p_company_id and (a.acknowledged_at is null or (a.detected_at at time zone 'Europe/Rome')::date between p_from and p_to);
 with done as (
  select f.*,coalesce(a.weights,'{}') weights from production_time_facts(p_company_id) f
   left join production_time_assignments a on a.company_id=p_company_id and a.job_id=f.job_id and a.group_key=f.group_key
  where f.completed and f.assigned_seconds>0 and (f.completed_at at time zone 'Europe/Rome')::date between p_from and p_to
 ), comparable as (
  select d.*,
   (jsonb_array_length(operators)=1 or (
    (select count(*) from jsonb_object_keys(weights))=jsonb_array_length(operators)
    and not exists(select 1 from jsonb_array_elements(operators) o where not weights ? (o->>'operatorId'))
   )) reliable
  from done d
 ), scores as (
  select o->>'operatorId' op,max(o->>'name') name,
   sum(case when reliable then assigned_seconds * case when jsonb_array_length(operators)=1 then 1
    else (weights->>(o->>'operatorId'))::numeric/(select sum(value::numeric) from jsonb_each_text(weights)) end else 0 end) assigned,
   sum(case when reliable then (o->>'seconds')::numeric else 0 end) worked,
   count(*) filter(where reliable) groups,
   sum(case when not reliable then (o->>'seconds')::numeric else 0 end) shared
  from comparable,jsonb_array_elements(operators) o group by o->>'operatorId'
 ) select coalesce(jsonb_agg(jsonb_build_object('operatorId',op,'name',name,'assignedSeconds',assigned,
  'workedSeconds',worked,'score',case when worked>0 then round(100*assigned/worked,1) else null end,
  'completedGroups',groups,'unscoredSharedSeconds',shared) order by name),'[]') into people from scores;
 select coalesce(jsonb_agg(jsonb_build_object('jobId',f.job_id,'plate',f.plate,'phase',f.label,
  'assignedSeconds',f.assigned_seconds,'workedSeconds',f.spent_seconds,
  'score',round(100*f.assigned_seconds/f.spent_seconds,1),'operators',f.operators) order by f.completed_at desc),'[]') into teams
 from production_time_facts(p_company_id) f where f.completed and f.assigned_seconds>0 and f.spent_seconds>0
  and jsonb_array_length(f.operators)>1 and (f.completed_at at time zone 'Europe/Rome')::date between p_from and p_to;
 return jsonb_build_object('alerts',alerts,'operators',people,'teams',teams,'serverNow',statement_timestamp());
end $$;
revoke all on function public.production_control_report(uuid,date,date,bigint) from public,anon;
grant execute on function public.production_control_report(uuid,date,date,bigint) to authenticated;
commit;

begin;
create or replace function public.production_operator_can_phase(p_company_id uuid,p_job_id text,p_operator_id text,p_phase_id text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare op jsonb; ph jsonb; required text; skills text[];
begin
 select o into op from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
  where s.company_id=p_company_id and o->>'id'=p_operator_id;
 select p into ph from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
  jsonb_array_elements(coalesce(j->'phases','[]')) p where s.company_id=p_company_id and j->>'id'=p_job_id and p->>'id'=p_phase_id;
 if op is null or not coalesce((op->>'active')::boolean,false) or ph is null
  or coalesce((ph->>'notRequired')::boolean,false) or ph->>'name'='Consegna' then return false;end if;
 select coalesce(array_agg(lower(translate(trim(value),'àèéìòù','aeeiou'))),'{}') into skills
  from jsonb_array_elements_text(coalesce(op->'skills','[]'));
 -- Existing unrestricted profiles retain their explicit all-duties mode. A configured empty list grants none.
 if not coalesce((op->>'skillsConfigured')::boolean,false) and cardinality(skills)=0 then return true;end if;
 required:=lower(translate(trim(coalesce(nullif(ph->>'requiredSkill',''),ph->>'name')),'àèéìòù','aeeiou'));
 return required=any(skills)
  or (required in ('incartatura','scartatura') and 'preparazione'=any(skills))
  or (required in ('lavaggio esterno','lavaggio interni') and 'lavaggio'=any(skills))
  or (required='preparazione' and 'incartatura'=any(skills) and 'scartatura'=any(skills))
  or (required='lavaggio' and 'lavaggio esterno'=any(skills) and 'lavaggio interni'=any(skills))
  or (required in ('meccanica','gommista') and 'meccanica / gommista'=any(skills))
  or (required='controllo qualita' and 'controllo'=any(skills));
end $$;
revoke all on function public.production_operator_can_phase(uuid,text,text,text) from public,anon,authenticated;
-- Enforce on every phase, including legacy jobs, independently from ordered-cycle gates.
create or replace function public.guard_production_cycle_start()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare reason text; has_phases boolean;
begin
 select jsonb_array_length(coalesce(j->'phases','[]'))>0 into has_phases from erp_snapshots s,
  jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=new.company_id and j->>'id'=new.job_id;
 if coalesce(has_phases,false) and not production_operator_can_phase(new.company_id,new.job_id,new.operator_id,new.phase_id)
  then raise exception 'Mansione non abilitata per questo operatore' using errcode='42501';end if;
 reason:=production_cycle_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason;end if;
 return new;
end $$;
revoke all on function public.guard_production_cycle_start() from public,anon,authenticated;
-- Phase signatures must also obey current permissions; Pause/Finish are deliberately still available.
do $$begin
 if to_regprocedure('public.production_complete_phase_before_duties(uuid,text,text)') is null then
  alter function public.production_complete_phase(uuid,text,text) rename to production_complete_phase_before_duties;
 end if;
 if to_regprocedure('public.production_live_feed_before_duties(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_duties;
 end if;
 if to_regprocedure('public.production_control_report_before_phase_review(uuid,date,date,bigint)') is null then
  alter function public.production_control_report(uuid,date,date,bigint) rename to production_control_report_before_phase_review;
 end if;
end $$;
revoke all on function public.production_complete_phase_before_duties(uuid,text,text),public.production_live_feed_before_duties(uuid),
 public.production_control_report_before_phase_review(uuid,date,date,bigint) from public,anon,authenticated;
create or replace function public.production_complete_phase(p_company_id uuid,p_job_id text,p_phase_id text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text;
begin
 if not is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto';end if;
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if not production_operator_can_phase(p_company_id,p_job_id,profile,p_phase_id) then raise exception 'Mansione non abilitata per questo operatore' using errcode='42501';end if;
 perform production_complete_phase_before_duties(p_company_id,p_job_id,p_phase_id);
end $$;
revoke all on function public.production_complete_phase(uuid,text,text) from public,anon;
grant execute on function public.production_complete_phase(uuid,text,text) to authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; profile text; item jsonb; phases jsonb; jobs jsonb:='[]'; program jsonb;
begin
 result:=production_live_feed_before_duties(p_company_id); -- authoritative tenant check
 if result->>'role' in ('owner','office') then return result;end if;
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 for item in select value from jsonb_array_elements(coalesce(result->'jobs','[]')) loop
  select coalesce(jsonb_agg(ph),'[]') into phases from jsonb_array_elements(coalesce(item->'phases','[]')) ph
   where production_operator_can_phase(p_company_id,item->>'jobId',profile,ph->>'id');
  -- Keep a running/paused card available for Pause/Finish after a permission is removed, but no unauthorized phase.
  if jsonb_array_length(phases)>0 or item->>'ownStatus' in ('running','paused') then
   jobs:=jobs||jsonb_build_array(item||jsonb_build_object('phases',phases,'dutiesFiltered',true));
  end if;
 end loop;
 select coalesce(jsonb_agg(t),'[]') into program from jsonb_array_elements(coalesce(result->'program','[]')) t
  where production_operator_can_phase(p_company_id,t->>'jobId',profile,t->>'phaseId');
 return result||jsonb_build_object('jobs',jobs,'program',program,'dutiesFiltered',true);
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
create or replace function public.production_control_report(p_company_id uuid,p_from date,p_to date,p_ack_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; phases jsonb;
begin
 result:=production_control_report_before_phase_review(p_company_id,p_from,p_to,p_ack_id); -- office-only check and date validation
 with facts as (
  select f.* from production_time_facts(p_company_id) f
  where not f.completed or (f.completed_at at time zone 'Europe/Rome')::date between p_from and p_to
 ), summary as (
  select coalesce(label,'Lavorazione') label,
   count(*) filter(where completed and assigned_seconds>0) samples,
   count(*) filter(where not completed and not closed) pending,
   count(*) filter(where assigned_seconds<=0 and not closed) missing,
   coalesce(sum(assigned_seconds) filter(where completed and assigned_seconds>0),0) assigned,
   coalesce(sum(spent_seconds) filter(where completed and assigned_seconds>0),0) worked,
   coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'plate',plate,'number',number,
    'assignedSeconds',assigned_seconds,'workedSeconds',spent_seconds,'completed',completed,'active',active_count>0)
    order by plate) filter(where not closed or completed),'[]') jobs
  from facts group by coalesce(label,'Lavorazione')
 ) select coalesce(jsonb_agg(jsonb_build_object('phase',label,'samples',samples,'pending',pending,'missing',missing,
  'assignedSeconds',assigned,'workedSeconds',worked,'averageWorkedSeconds',case when samples>0 then worked/samples else null end,
  'deviationPercent',case when assigned>0 then round((worked-assigned)/assigned*100,1) else null end,
  'review',case when missing>0 then 'Configurare i tempi mancanti' when samples<5 then 'Pochi dati: osservare ancora'
   when worked>assigned*1.15 then 'Verificare tempi o difficoltà delle lavorazioni'
   when worked<assigned*0.85 then 'Verificare se il tempo standard è troppo ampio' else 'Tempi medi in linea' end,
  'jobs',jobs) order by label),'[]') into phases from summary;
 return result||jsonb_build_object('phaseReview',phases);
end $$;
revoke all on function public.production_control_report(uuid,date,date,bigint) from public,anon;
grant execute on function public.production_control_report(uuid,date,date,bigint) to authenticated;
-- Apply only the owner's requested personnel change, preserving all other settings and work history.
-- Existing selected duties are kept, except Smontaggio; unknown duties are not invented.
do $$declare snapshot jsonb; operators jsonb; updated jsonb; o jsonb; skills jsonb; prefs jsonb; changed boolean:=false;
begin
 perform pg_advisory_xact_lock(hashtextextended('aa49d334-492f-4daa-aa7e-5d5c022308b7',0));
 select payload into snapshot from erp_snapshots where company_id='aa49d334-492f-4daa-aa7e-5d5c022308b7' for update;
 if snapshot is null then return;end if;
 operators:='[]';
 for o in select value from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) loop
  updated:=o;
  if lower(trim(o->>'name'))='stefania' then
   select coalesce(jsonb_agg(value),'[]') into skills from jsonb_array_elements_text(coalesce(o->'skills','[]')) where lower(trim(value))<>'smontaggio';
   prefs:=coalesce(o->'preferredDuties',skills);
   updated:=o||jsonb_build_object('skillsConfigured',true,'skills',skills,'preferredDuties',prefs);
  end if;
  if updated is distinct from o then changed:=true;end if;
  operators:=operators||jsonb_build_array(updated);
 end loop;
 if changed then update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,operators}',operators),revision=revision+1,updated_at=now()
  where company_id='aa49d334-492f-4daa-aa7e-5d5c022308b7';end if;
end $$;
commit;

begin;
create or replace function public.production_owner_password_recent(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.is_company_owner(p_company_id) and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) e
  where e->>'method'='password' and (e->>'timestamp')::numeric between extract(epoch from statement_timestamp())-300 and extract(epoch from statement_timestamp())+30);
$$;
revoke all on function public.production_owner_password_recent(uuid) from public,anon,authenticated;
create or replace function public.production_report_access(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not production_owner_password_recent(p_company_id) then raise exception 'Inserisci nuovamente la password del titolare per leggere i report dei dipendenti.' using errcode='42501';end if;
end $$;
revoke all on function public.production_report_access(uuid) from public,anon;
grant execute on function public.production_report_access(uuid) to authenticated;
do $$begin
 if to_regprocedure('public.production_hours_report_before_password(uuid,text,date,date)') is null then
  alter function public.production_hours_report(uuid,text,date,date) rename to production_hours_report_before_password;
 end if;
 if to_regprocedure('public.production_control_report_before_report_password(uuid,date,date,bigint)') is null then
  alter function public.production_control_report(uuid,date,date,bigint) rename to production_control_report_before_report_password;
 end if;
end $$;
revoke all on function public.production_hours_report_before_password(uuid,text,date,date),
 public.production_control_report_before_report_password(uuid,date,date,bigint) from public,anon,authenticated;
create or replace function public.production_hours_report(p_company_id uuid,p_operator_id text,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare own_operator text;
begin
 if not is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto';end if;
 select operator_id into own_operator from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if own_operator is distinct from p_operator_id then perform production_report_access(p_company_id);end if;
 return production_hours_report_before_password(p_company_id,p_operator_id,p_from,p_to);
end $$;
revoke all on function public.production_hours_report(uuid,text,date,date) from public,anon;
grant execute on function public.production_hours_report(uuid,text,date,date) to authenticated;
create or replace function public.production_staff_hours(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare stamp date:=(statement_timestamp() at time zone 'Europe/Rome')::date;
begin
 perform production_report_access(p_company_id);
 return coalesce((select jsonb_agg(jsonb_build_object('operatorId',o->>'id','name',o->>'name',
  'today',production_hours_report_before_password(p_company_id,o->>'id',stamp,stamp)))
  from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
  where s.company_id=p_company_id),'[]');
end $$;
revoke all on function public.production_staff_hours(uuid) from public,anon;
grant execute on function public.production_staff_hours(uuid) to authenticated;
create or replace function public.production_control_report(p_company_id uuid,p_from date,p_to date,p_ack_id bigint default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; alerts jsonb;
begin
 result:=production_control_report_before_report_password(p_company_id,p_from,p_to,p_ack_id);
 select coalesce(jsonb_agg(a||jsonb_build_object('operators',coalesce((select jsonb_agg(o-'seconds')
  from jsonb_array_elements(coalesce(a->'operators','[]')) o),'[]'))),'[]') into alerts
  from jsonb_array_elements(coalesce(result->'alerts','[]')) a;
 return result||jsonb_build_object('alerts',alerts,'operators','[]'::jsonb,'teams','[]'::jsonb);
end $$;
revoke all on function public.production_control_report(uuid,date,date,bigint) from public,anon;
grant execute on function public.production_control_report(uuid,date,date,bigint) to authenticated;
create or replace function public.production_productivity_report(p_company_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform production_report_access(p_company_id);
 return production_control_report_before_report_password(p_company_id,p_from,p_to,null);
end $$;
revoke all on function public.production_productivity_report(uuid,date,date) from public,anon;
grant execute on function public.production_productivity_report(uuid,date,date) to authenticated;
-- Do not preload anyone else's hours in the ordinary tablet feed, even for the owner.
create or replace function public.production_live_feed_before_phase_budgets(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare profile text; member_role text; stamp timestamptz:=clock_timestamp(); result jsonb;
begin
  select role into member_role from company_members where company_id=p_company_id and user_id=auth.uid() and active;
  if member_role is null then raise exception 'Accesso aziendale richiesto'; end if;
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  with clocks as (
    select j.*,coalesce((select sum(extract(epoch from(coalesce(g.ended_at,stamp)-g.started_at))*g.rate/3600)
      from production_live_segments g where g.company_id=j.company_id and g.job_id=j.job_id),0) spent,
      coalesce((select sum(g.rate) from production_live_segments g where g.company_id=j.company_id and g.job_id=j.job_id and g.ended_at is null),0) active_rate,
      (select count(*) from production_live_segments g where g.company_id=j.company_id and g.job_id=j.job_id and g.ended_at is null) active_count,
      coalesce((select (r->>'rate')::numeric from jsonb_array_elements(j.operator_rates) r where r->>'id'=profile),0) own_rate
    from production_live_jobs j where j.company_id=p_company_id
  ) select jsonb_build_object('companyId',p_company_id,'serverNow',stamp,'role',member_role,
    'operatorName',(select o->>'name' from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
      where s.company_id=p_company_id and o->>'id'=profile),
    'members',case when member_role='owner' then coalesce((select jsonb_agg(jsonb_build_object('userId',cm.user_id,'name',cm.display_name,'operatorId',pp.operator_id))
      from company_members cm left join production_profiles pp on pp.company_id=cm.company_id and pp.user_id=cm.user_id
      where cm.company_id=p_company_id and cm.active),'[]'::jsonb) else '[]'::jsonb end,
    'jobs',coalesce((select jsonb_agg(jsonb_build_object('jobId',c.job_id,'plate',c.plate,'number',c.number,
      'remainingSeconds',case when greatest(c.active_rate,c.own_rate)>0 then greatest(0,c.initial_budget-c.spent)/
        (case when c.active_rate>0 then c.active_rate else c.own_rate end)*3600 else null end,
      'ownRemainingSeconds',case when c.own_rate>0 then greatest(0,c.initial_budget-c.spent)/c.own_rate*3600 else null end,
      'ownBurnFactor',case when c.own_rate>0 then c.active_rate/c.own_rate else 0 end,
      'ownPhaseId',(select ss.phase_id from production_live_sessions ss where ss.company_id=c.company_id and ss.job_id=c.job_id and ss.operator_id=profile),
      'remainingPercent',greatest(0,c.initial_budget-c.spent)/c.initial_budget*100,'activeCount',c.active_count,
      'ownStatus',(select ss.status from production_live_sessions ss where ss.company_id=c.company_id and ss.job_id=c.job_id and ss.operator_id=profile),
      'operators',coalesce((select jsonb_agg(jsonb_build_object('name',ss.operator_name,'status',ss.status)) from production_live_sessions ss
        where ss.company_id=c.company_id and ss.job_id=c.job_id),'[]'::jsonb)) || production_job_details(p_company_id,c.job_id)) from clocks c),'[]'::jsonb)) into result;
  result:=result || jsonb_build_object('program',coalesce((select jsonb_agg(jsonb_build_object('id',task->>'id','jobId',task->>'jobId','plate',task->>'plate',
      'phaseId',task->>'phaseId','phaseName',task->>'phaseName','startAt',task->>'startAt','endAt',task->>'endAt','panels',coalesce(task->'panelNames','[]'),
      'ready',exists(select 1 from production_live_jobs lj where lj.company_id=p_company_id and lj.job_id=task->>'jobId')) order by task->>'startAt')
      from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'operatorPrograms','[]')) program,jsonb_array_elements(coalesce(program->'tasks','[]')) task
      where s.company_id=p_company_id and program->>'operatorId'=profile
        and not exists(select 1 from production_phase_checks pc where pc.company_id=p_company_id and pc.job_id=task->>'jobId' and pc.phase_id=task->>'phaseId')
        and exists(select 1 from jsonb_array_elements(coalesce(s.payload->'jobs','[]')) jj where jj->>'id'=task->>'jobId' and jj->>'status' not in ('Consegnata','Annullata')
          and not exists(select 1 from jsonb_array_elements(coalesce(jj->'phases','[]')) ph where ph->>'id'=task->>'phaseId' and (ph->>'status'='Completata' or coalesce((ph->>'notRequired')::boolean,false))))),'[]'::jsonb),
    'today',case when profile is not null then production_hours_report(p_company_id,profile,(stamp at time zone 'Europe/Rome')::date,(stamp at time zone 'Europe/Rome')::date) else null end,
    'staff',case when false then coalesce((select jsonb_agg(jsonb_build_object('operatorId',o->>'id','name',o->>'name',
      'today',production_hours_report(p_company_id,o->>'id',(stamp at time zone 'Europe/Rome')::date,(stamp at time zone 'Europe/Rome')::date)))
      from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o where s.company_id=p_company_id),'[]'::jsonb) else '[]'::jsonb end);
  return result;
end $$;
revoke all on function public.production_live_feed_before_phase_budgets(uuid) from public,anon,authenticated;
commit;

-- Protezione delle modifiche ai preventivi confermati.
begin;
create or replace function public.require_recent_owner_password()
returns trigger language plpgsql security definer set search_path=public as $$
declare kind text; previous jsonb; revised jsonb; authenticated_at numeric;
begin
 if not public.is_company_owner(old.company_id) then return new; end if;
 select max((entry->>'timestamp')::numeric) into authenticated_at
 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) entry where entry->>'method'='password';
 foreach kind in array array['estimates','quotes'] loop
  for previous in select value from jsonb_array_elements(coalesce(old.payload->kind,'[]'::jsonb)) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null)) or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(coalesce(new.payload->kind,'[]'::jsonb)) where value->>'id'=previous->>'id';
    if (case when kind='quotes' then revised-'invoiceId'-'updatedAt' else revised end) is distinct from (case when kind='quotes' then previous-'invoiceId'-'updatedAt' else previous end)
       and (authenticated_at is null or authenticated_at<extract(epoch from clock_timestamp())-300 or authenticated_at>extract(epoch from clock_timestamp())+30) then
     raise exception 'Inserisci nuovamente la password del titolare per modificare il preventivo confermato.' using errcode='42501';
    end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.require_recent_owner_password() from public;
drop trigger if exists require_password_for_confirmed_estimates on public.erp_snapshots;
create trigger require_password_for_confirmed_estimates before update on public.erp_snapshots for each row execute function public.require_recent_owner_password();
commit;

begin;
create extension if not exists pgcrypto;
create table if not exists public.production_private_passwords(
 company_id uuid primary key references companies(id), password_hash text not null,
 failures integer not null default 0, locked_until timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.production_private_grants(
 company_id uuid not null references companies(id), user_id uuid not null references auth.users(id),
 session_key text not null, expires_at timestamptz not null,
 primary key(company_id,user_id,session_key)
);
alter table public.production_private_passwords enable row level security;
alter table public.production_private_grants enable row level security;
revoke all on public.production_private_passwords,public.production_private_grants from public,anon,authenticated;
create or replace function public.production_private_hash(p_password text,p_hash text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare ns text; result text;
begin
 select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
 if p_hash is null then execute format('select %I.crypt($1,%I.gen_salt(''bf'',10))',ns,ns) into result using p_password;
 else execute format('select %I.crypt($1,$2)',ns) into result using p_password,p_hash;end if;
 return result;
end $$;
revoke all on function public.production_private_hash(text,text) from public,anon,authenticated;
create or replace function public.production_private_password(p_company_id uuid,p_action text default 'status',p_password text default null,p_new_password text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare saved production_private_passwords%rowtype; sid text:=nullif(auth.jwt()->>'session_id',''); stamp timestamptz:=clock_timestamp();
begin
 if not is_company_owner(p_company_id) then raise exception 'Accesso riservato al titolare' using errcode='42501';end if;
 if p_action not in ('status','set','unlock') then raise exception 'Operazione non valida';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select * into saved from production_private_passwords where company_id=p_company_id for update;
 if p_action='status' then return jsonb_build_object('configured',saved.company_id is not null);end if;
 if sid is null then raise exception 'Esci e accedi nuovamente al gestionale prima di usare la password dei blocchi.';end if;
 if saved.locked_until>stamp then return jsonb_build_object('ok',false,'message','Troppi tentativi. Riprova tra 15 minuti.');end if;
 if p_action='unlock' or saved.company_id is not null then
  if saved.company_id is null or p_password is null or octet_length(p_password)>72 or production_private_hash(p_password,saved.password_hash) is distinct from saved.password_hash then
   if saved.company_id is not null then update production_private_passwords set failures=case when failures>=4 then 0 else failures+1 end,
    locked_until=case when failures>=4 then stamp+interval '15 minutes' else null end where company_id=p_company_id;end if;
   return jsonb_build_object('ok',false,'message','Password dei blocchi non corretta.');
  end if;
 end if;
 if p_action='set' then
  if p_new_password is null or char_length(p_new_password)<8 or octet_length(p_new_password)>72 then raise exception 'Scegli una password di almeno 8 caratteri e massimo 72 byte.';end if;
  insert into production_private_passwords(company_id,password_hash) values(p_company_id,production_private_hash(p_new_password))
   on conflict(company_id) do update set password_hash=excluded.password_hash,failures=0,locked_until=null,updated_at=stamp;
  delete from production_private_grants where company_id=p_company_id;
 else
  update production_private_passwords set failures=0,locked_until=null where company_id=p_company_id;
  insert into production_private_grants(company_id,user_id,session_key,expires_at) values(p_company_id,auth.uid(),sid,stamp+interval '5 minutes')
   on conflict(company_id,user_id,session_key) do update set expires_at=excluded.expires_at;
 end if;
 return jsonb_build_object('ok',true,'configured',true);
end $$;
revoke all on function public.production_private_password(uuid,text,text,text) from public,anon;
grant execute on function public.production_private_password(uuid,text,text,text) to authenticated;
-- Account login or password refresh cannot unlock private reports; only this specific signed-in session has a grant.
create or replace function public.production_owner_password_recent(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select is_company_owner(p_company_id) and exists(select 1 from production_private_grants
  where company_id=p_company_id and user_id=auth.uid() and session_key=auth.jwt()->>'session_id' and expires_at>statement_timestamp());
$$;
revoke all on function public.production_owner_password_recent(uuid) from public,anon,authenticated;
create or replace function public.production_report_access(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not production_owner_password_recent(p_company_id) then raise exception 'Inserisci la password dei blocchi per accedere a preventivi confermati e report riservati.' using errcode='42501';end if;
end $$;
revoke all on function public.production_report_access(uuid) from public,anon;
grant execute on function public.production_report_access(uuid) to authenticated;
create or replace function public.require_recent_owner_password()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; previous jsonb; revised jsonb;
begin
 if not is_company_owner(old.company_id) then return new;end if;
 foreach kind in array array['estimates','quotes'] loop
  for previous in select value from jsonb_array_elements(coalesce(old.payload->kind,'[]')) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null)) or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(coalesce(new.payload->kind,'[]')) where value->>'id'=previous->>'id';
    if (case when kind='quotes' then revised-'invoiceId'-'updatedAt' else revised end) is distinct from (case when kind='quotes' then previous-'invoiceId'-'updatedAt' else previous end)
     and not production_owner_password_recent(old.company_id) then raise exception 'Inserisci la password dei blocchi per modificare il preventivo confermato.' using errcode='42501';end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.require_recent_owner_password() from public,anon,authenticated;
commit;
