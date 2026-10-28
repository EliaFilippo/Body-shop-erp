begin;
-- A complete manual menu, including legacy jobs without the full workshop cycle.
-- This is a read projection: quotes, prices, planned work and frozen budgets are never rewritten.
create or replace function public.production_manual_phases(job jsonb)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
 with catalog(code,name,ord) as (values
 ('wash-exterior','Lavaggio esterno',1),('disassembly','Smontaggio',2),('hail','Riparazione grandine',3),
 ('bodywork','Lattoneria',4),('filler','Stuccatura',5),('masking','Incartatura',6),('painting','Verniciatura',7),
 ('unmasking','Scartatura',8),('assembly','Rimontaggio',9),('mechanical','Meccanica / gommista',10),
 ('polishing','Lucidatura',11),('wash-interior','Lavaggio interni',12),('touchups','Ritocchi',13),('transport','Trasporto',14)
 ), existing as (select ph,ord from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality s(ph,ord))
 select coalesce((select jsonb_agg(ph order by ord) from existing),'[]') || coalesce((
  select jsonb_agg(jsonb_build_object('id','manual-phase:'||c.code,'name',c.name,'status','Non prevista',
   'notRequired',true,'cycleOrder',c.ord,'estimatedMinutes',0,'actualMinutes',0,'operatorAssignments','[]'::jsonb) order by c.ord)
  from catalog c where not exists(select 1 from existing e where e.ph->>'name'=c.name)
 ),'[]');
$$;
revoke all on function public.production_manual_phases(jsonb) from public,anon,authenticated;

create or replace function public.production_unquoted_drying_gate(p_company_id uuid,p_job_id text,p_phase_id text)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare job jsonb;target_name text;painted_at timestamptz;
begin
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 select ph->>'name' into target_name from jsonb_array_elements(production_manual_phases(job)) ph where ph->>'id'=p_phase_id;
 if target_name is null or target_name not in ('Scartatura','Rimontaggio','Meccanica / gommista','Lucidatura','Lavaggio interni','Ritocchi','Trasporto') then return '';end if;
 select max(seg.ended_at) into painted_at from production_live_segments seg
 join lateral jsonb_array_elements(production_manual_phases(job)) ph on ph->>'id'=seg.phase_id
 where seg.company_id=p_company_id and seg.job_id=p_job_id and seg.manual_start
 and ph->>'name'='Verniciatura' and coalesce((ph->>'notRequired')::boolean,false);
 if painted_at+interval '1 hour'>statement_timestamp() then return 'Attesa asciugatura prima di proseguire';end if;
 return '';
end $$;
revoke all on function public.production_unquoted_drying_gate(uuid,text,text) from public,anon,authenticated;

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
 select jsonb_array_length(coalesce(j->'phases','[]'))>0 into has_phases from erp_snapshots s,
  jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=new.company_id and j->>'id'=new.job_id;
 if coalesce(has_phases,false) and not production_operator_can_phase(new.company_id,new.job_id,new.operator_id,new.phase_id)
  then raise exception 'Mansione non abilitata per questo operatore' using errcode='42501';end if;
 reason:=production_cycle_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason;end if;
 return new;
end $$;
revoke all on function public.guard_production_cycle_start() from public,anon,authenticated;


create or replace function public.production_manual_start(p_company_id uuid,p_job_id text,p_phase_id text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text; op jsonb; snapshot jsonb; job jsonb; phase jsonb; prior record; stamp timestamptz; painted_at timestamptz; target_order bigint; paint_order bigint; paint_phase jsonb;
begin
 if not is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 if profile is null or not exists(select 1 from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o
  where o->>'id'=profile and coalesce((o->>'active')::boolean,false)) then raise exception 'Collega un operatore attivo al profilo';end if;
 select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'id'=p_job_id;
 if job is null or coalesce(job->>'status','') in ('Consegnata','Annullata') then raise exception 'La commessa è chiusa o non disponibile';end if;
 job:=jsonb_set(job,'{phases}',production_manual_phases(job));
 select r into op from production_live_jobs j,jsonb_array_elements(j.operator_rates) r
  where j.company_id=p_company_id and j.job_id=p_job_id and r->>'id'=profile;
 if op is null then raise exception 'Budget non confermato per questo operatore';end if;
 if jsonb_array_length(coalesce(job->'phases','[]'))>0 then
  select ph into phase from jsonb_array_elements(job->'phases') ph where ph->>'id'=p_phase_id;
  if phase is null then raise exception 'Scegli una fase di lavorazione valida';end if;
  if phase->>'name'='Consegna' then raise exception 'La consegna viene registrata dall’ufficio';end if;
 elsif p_phase_id is not null then raise exception 'Fase non disponibile';end if;
 if phase->>'name' in ('Scartatura','Rimontaggio','Meccanica / gommista','Lucidatura','Lavaggio interni','Ritocchi','Trasporto') then
  select ord into target_order from jsonb_array_elements(job->'phases') with ordinality s(ph,ord) where ph->>'id'=p_phase_id;
  select ph,ord into paint_phase,paint_order from jsonb_array_elements(job->'phases') with ordinality s(ph,ord) where ph->>'name'='Verniciatura';
  if paint_phase is not null then
   select checked_at into painted_at from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=paint_phase->>'id';
   painted_at:=coalesce(painted_at,nullif(paint_phase->>'completedAt','')::timestamptz,nullif(paint_phase->>'endedAt','')::timestamptz);
   select greatest(painted_at,max(ended_at)) into painted_at from production_live_segments
    where company_id=p_company_id and job_id=p_job_id and phase_id=paint_phase->>'id' and manual_start;
   if painted_at+interval '1 hour'>clock_timestamp() then raise exception 'Attesa asciugatura prima di proseguire';end if;
  end if;
 end if;
 -- Validate before stopping anything. The whole function rolls back if a station guard rejects Start.
 for prior in select job_id,phase_id from production_live_sessions
  where company_id=p_company_id and operator_id=profile and status='running' loop
  if prior.job_id=p_job_id and prior.phase_id is not distinct from p_phase_id then return;end if;
  perform production_timer_action(p_company_id,prior.job_id,'pause');
 end loop;
 perform production_activity_action(p_company_id,'end');
 stamp:=clock_timestamp();
 insert into production_live_sessions(company_id,job_id,operator_id,user_id,operator_name,status,phase_id)
 values(p_company_id,p_job_id,profile,auth.uid(),op->>'name','running',p_phase_id)
 on conflict(company_id,job_id,operator_id) do update set status='running',user_id=auth.uid(),phase_id=excluded.phase_id;
 insert into production_live_segments(company_id,job_id,operator_id,rate,started_at,phase_id,ordinary_schedule,manual_start)
 values(p_company_id,p_job_id,profile,(op->>'rate')::numeric,stamp,p_phase_id,production_operator_schedule(snapshot,profile),true);
 -- Existing signatures are history: additional work never erases or fabricates completion.
end $$;
revoke all on function public.production_manual_start(uuid,text,text) from public,anon;
grant execute on function public.production_manual_start(uuid,text,text) to authenticated;
create or replace function public.production_job_details(p_company_id uuid,p_job_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job jsonb;profile text;phases jsonb;tasks jsonb;
begin
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 with source as materialized (
  select ph,ord,production_cycle_gate_for_job(p_company_id,job,ph->>'id') gate
  from jsonb_array_elements(production_manual_phases(job)) with ordinality s(ph,ord)
 )
 select jsonb_agg(jsonb_build_object('id',ph->>'id','name',ph->>'name','notRequired',coalesce((ph->>'notRequired')::boolean,false),
 'status',case when coalesce((ph->>'notRequired')::boolean,false) then 'Non prevista' when checkmark.phase_id is not null then 'Completata' when ph->>'status'='Completata' then 'Completata'
  when not coalesce((ph->>'notRequired')::boolean,false) and gate<>'' then 'Bloccata' else ph->>'status' end,
 'checkedBy',checkmark.operator_name,'checkedAt',checkmark.checked_at,'blockedReason',coalesce(nullif(gate,''),ph->>'blockedReason'),
 'canComplete',not coalesce((ph->>'notRequired')::boolean,false) and exists(select 1 from production_live_segments sg where sg.company_id=p_company_id and sg.job_id=p_job_id and sg.operator_id=profile and sg.user_id=auth.uid() and sg.phase_id=ph->>'id'))
 order by coalesce((ph->>'cycleOrder')::numeric,ord)) into phases
 from source left join production_phase_checks checkmark on checkmark.company_id=p_company_id and checkmark.job_id=p_job_id and checkmark.phase_id=ph->>'id';
 select jsonb_agg(jsonb_build_object('id',line->>'id','description',line->>'description','panel',line->>'panelName','quantity',line->'quantity') order by ord)
 into tasks from jsonb_array_elements(coalesce(job->'lines','[]')) with ordinality source(line,ord);
 return jsonb_build_object('phases',coalesce(phases,'[]'),'tasks',coalesce(tasks,'[]'));
end $$;
revoke all on function public.production_job_details(uuid,text) from public,anon,authenticated;
create or replace function public.guard_paint_station_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_name text; occupied integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select p->>'name' into phase_name
 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
  jsonb_array_elements(production_manual_phases(j)) p
 where s.company_id=new.company_id and j->>'id'=new.job_id and p->>'id'=new.phase_id;
 if phase_name is distinct from 'Verniciatura' then return new;end if;
 with phases as (
  select j->>'id' as job_id,p,
   (select max(c.checked_at) from production_phase_checks c
    where c.company_id=new.company_id and c.job_id=j->>'id' and c.phase_id=p->>'id') checked_at,
   exists(select 1 from production_live_segments seg
    where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id') has_started
  from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
   jsonb_array_elements(production_manual_phases(j)) p
  where s.company_id=new.company_id and j->>'id'<>new.job_id
   and coalesce(j->>'status','') not in ('Annullata','Consegnata')
   and p->>'name'='Verniciatura'
 ), occupied_phases as (
  select job_id from phases where
   case when exists(select 1 from production_live_sessions ss
    where ss.company_id=new.company_id and ss.job_id=phases.job_id and ss.phase_id=p->>'id' and ss.status in ('running','paused')
    and exists(select 1 from production_live_segments seg where seg.company_id=ss.company_id and seg.job_id=ss.job_id and seg.operator_id=ss.operator_id and seg.phase_id=ss.phase_id and seg.manual_start and seg.started_at>coalesce(checked_at,'-infinity'::timestamptz))) then true
   when exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=phases.job_id and seg.phase_id=p->>'id' and seg.manual_start and seg.ended_at+interval '1 hour'>clock_timestamp()) then true
   when coalesce((p->>'notRequired')::boolean,false) then false
   when checked_at is not null or p->>'status'='Completata' then
    coalesce(checked_at,nullif(p->>'completedAt','')::timestamptz,nullif(p->>'endedAt','')::timestamptz)
     +make_interval(mins=>greatest(0,coalesce((p->>'technicalWaitMinutes')::integer,60)))>clock_timestamp()
   else has_started or p->>'status'='In lavorazione' end
 )
 select count(distinct job_id) into occupied from occupied_phases;
 if occupied>=3 then
  raise exception 'Le 3 postazioni di verniciatura sono occupate, inclusa l’asciugatura. Attendi che se ne liberi una prima di avviare un’altra vettura.';
 end if;
 return new;
end $$;
revoke all on function public.guard_paint_station_capacity() from public,anon,authenticated;
create or replace function public.guard_wash_station_capacity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare phase_name text; occupied boolean;
begin
 if new.ended_at is not null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select p->>'name' into phase_name from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(production_manual_phases(j)) p
 where s.company_id=new.company_id and j->>'id'=new.job_id and p->>'id'=new.phase_id;
 if phase_name is null or phase_name not in ('Lavaggio esterno','Lavaggio interni','Lavaggio') then return new;end if;
 select exists(
  select 1 from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,jsonb_array_elements(production_manual_phases(j)) p
  where s.company_id=new.company_id and coalesce(j->>'status','') not in ('Annullata','Consegnata')
  and p->>'name' in ('Lavaggio esterno','Lavaggio interni','Lavaggio')
  and (
   exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id' and seg.operator_id<>new.operator_id and seg.ended_at is null)
   or (
    (j->>'id'<>new.job_id or p->>'id'<>new.phase_id)
    and (
     (not coalesce((p->>'notRequired')::boolean,false) and p->>'status'<>'Completata'
      and not exists(select 1 from production_phase_checks c where c.company_id=new.company_id and c.job_id=j->>'id' and c.phase_id=p->>'id')
      and exists(select 1 from production_live_segments seg where seg.company_id=new.company_id and seg.job_id=j->>'id' and seg.phase_id=p->>'id'))
     or exists(select 1 from production_live_sessions ss where ss.company_id=new.company_id and ss.job_id=j->>'id' and ss.phase_id=p->>'id' and ss.status='paused'
      and exists(select 1 from production_live_segments seg where seg.company_id=ss.company_id and seg.job_id=ss.job_id and seg.operator_id=ss.operator_id and seg.phase_id=ss.phase_id and seg.manual_start and seg.started_at>coalesce((select c.checked_at from production_phase_checks c where c.company_id=ss.company_id and c.job_id=ss.job_id and c.phase_id=ss.phase_id),'-infinity'::timestamptz)))
    )
   )
  )
 ) into occupied;
 if occupied then raise exception 'La sola postazione di lavaggio è occupata. Attendi il completamento del lavaggio o lavora su un’altra fase abilitata.';end if;
 return new;
end $$;
revoke all on function public.guard_wash_station_capacity() from public,anon,authenticated;
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
  select j from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id
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

revoke all on function public.production_time_facts(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
