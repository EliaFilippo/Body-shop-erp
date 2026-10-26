begin;
-- Append-only corrections: raw tablet intervals and their economic budgets are never rewritten.
create table if not exists public.production_hour_adjustments(
 id uuid primary key,
 company_id uuid not null references public.companies(id),
 operator_id text not null,work_day date not null,
 kind text not null check(kind in ('vehicle','cleaning','coffee','other')),
 job_id text,
 delta_seconds integer not null check(delta_seconds<>0 and abs(delta_seconds)<=86400),
 reason text not null check(char_length(btrim(reason)) between 3 and 500),
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 check((kind='vehicle' and job_id is not null) or (kind<>'vehicle' and job_id is null))
);
create index if not exists production_hour_adjustments_day on public.production_hour_adjustments(company_id,work_day,operator_id);
alter table public.production_hour_adjustments enable row level security;
revoke all on public.production_hour_adjustments from public,anon,authenticated;

create or replace function public.production_daily_hour_entries(p_company_id uuid,p_day date)
returns table(operator_id text,kind text,job_id text,phase_id text,started_at timestamptz,ended_at timestamptz,seconds numeric,running boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 with bounds as (select p_day::timestamp at time zone 'Europe/Rome' lo,(p_day+1)::timestamp at time zone 'Europe/Rome' hi,statement_timestamp() stamp)
 select s.operator_id,'vehicle'::text,s.job_id,s.phase_id,greatest(s.started_at,b.lo),
 least(coalesce(s.ended_at,b.stamp),b.hi,b.stamp),
 greatest(0,extract(epoch from(least(coalesce(s.ended_at,b.stamp),b.hi,b.stamp)-greatest(s.started_at,b.lo)))),
 s.ended_at is null and b.stamp>=b.lo and b.stamp<b.hi
 from production_live_segments s cross join bounds b
 where s.company_id=p_company_id and s.started_at<least(b.hi,b.stamp) and coalesce(s.ended_at,b.stamp)>b.lo
 union all
 select a.operator_id,a.kind,null::text,null::text,greatest(a.started_at,b.lo),
 least(coalesce(a.ended_at,b.stamp),b.hi,b.stamp),
 greatest(0,extract(epoch from(least(coalesce(a.ended_at,b.stamp),b.hi,b.stamp)-greatest(a.started_at,b.lo)))),
 a.ended_at is null and b.stamp>=b.lo and b.stamp<b.hi
 from production_operator_activities a cross join bounds b
 where a.company_id=p_company_id and a.started_at<least(b.hi,b.stamp) and coalesce(a.ended_at,b.stamp)>b.lo;
$$;
revoke all on function public.production_daily_hour_entries(uuid,date) from public,anon,authenticated;

create or replace function public.production_daily_hours(p_company_id uuid,p_day date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
  planned:=production_day_capacity(coalesce((select s.ordinary_schedule from production_live_segments s
    where s.company_id=p_company_id and s.operator_id=person.id and s.started_at<((p_day+1)::timestamp at time zone 'Europe/Rome')
    and coalesce(s.ended_at,statement_timestamp())>(p_day::timestamp at time zone 'Europe/Rome') order by s.started_at,s.id limit 1),
    case when op is not null then production_operator_schedule(snapshot,person.id) end),p_day);
  people:=people||jsonb_build_array(jsonb_build_object('operatorId',person.id,'name',person.name,
   'vehicleSeconds',vehicle,'cleaningSeconds',cleaning,'coffeeSeconds',coffee,'otherSeconds',other,'totalSeconds',total,
   'ordinarySeconds',case when planned is not null then least(total,planned) end,
   'extraSeconds',case when planned is not null then greatest(0,total-planned) end,
   'entries',entries,'adjustments',changes));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','plate',j->>'plate','number',j->>'number') order by j->>'plate'),'[]')
 into job_options from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j;
 return jsonb_build_object('day',p_day,'serverNow',statement_timestamp(),'operators',people,'jobs',job_options,'canAdjust',public.is_company_owner(p_company_id));
end $$;
revoke all on function public.production_daily_hours(uuid,date) from public,anon;
grant execute on function public.production_daily_hours(uuid,date) to authenticated;

create or replace function public.production_adjust_hours(p_company_id uuid,p_operator_id text,p_day date,p_kind text,p_job_id text,p_delta_minutes integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous production_hour_adjustments%rowtype; snapshot jsonb;bucket numeric;recorded numeric;max_seconds numeric;job text:=nullif(p_job_id,'');
begin
 if not public.production_owner_password_recent(p_company_id) then raise exception 'Inserisci la password dei blocchi per correggere le ore.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 if p_day is null or p_day>(statement_timestamp() at time zone 'Europe/Rome')::date or p_request_id is null then raise exception 'Giornata o richiesta non valida.';end if;
 if p_kind is null or p_kind not in ('vehicle','cleaning','coffee','other') or p_delta_minutes is null
  or p_delta_minutes=0 or abs(p_delta_minutes::bigint)>1440 or p_reason is null or char_length(btrim(p_reason)) not between 3 and 500
  then raise exception 'Indica minuti e una causale da 3 a 500 caratteri.';end if;
 if (p_kind='vehicle' and job is null) or (p_kind<>'vehicle' and job is not null) then raise exception 'Seleziona la vettura solo per le ore su vettura.';end if;
 select * into previous from production_hour_adjustments where id=p_request_id and company_id=p_company_id;
 if found then
  if previous.operator_id is distinct from p_operator_id or previous.work_day<>p_day or previous.kind<>p_kind
   or previous.job_id is distinct from job or previous.delta_seconds<>p_delta_minutes*60 or previous.reason<>btrim(p_reason)
   then raise exception 'Richiesta già usata con dati differenti.';end if;
  return production_daily_hours(p_company_id,p_day);
 end if;
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 if not exists(select 1 from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) o where o->>'id'=p_operator_id)
 and not exists(select 1 from production_daily_hour_entries(p_company_id,p_day) e where e.operator_id=p_operator_id)
 and not exists(select 1 from production_hour_adjustments a where a.company_id=p_company_id and a.work_day=p_day and a.operator_id=p_operator_id)
 then raise exception 'Operatore non trovato.';end if;
 if p_kind='vehicle' and not exists(select 1 from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'id'=job)
 and not exists(select 1 from production_live_jobs j where j.company_id=p_company_id and j.job_id=job)
 then raise exception 'Vettura non trovata in questa azienda.';end if;
 select coalesce(sum(e.seconds),0) into bucket from production_daily_hour_entries(p_company_id,p_day) e
  where e.operator_id=p_operator_id and e.kind=p_kind and e.job_id is not distinct from job;
 bucket:=bucket+coalesce((select sum(a.delta_seconds) from production_hour_adjustments a where a.company_id=p_company_id and a.operator_id=p_operator_id
  and a.work_day=p_day and a.kind=p_kind and a.job_id is not distinct from job),0);
 if bucket+p_delta_minutes*60<0 then raise exception 'Non puoi togliere più ore di quelle registrate per questa attività e vettura.';end if;
 select coalesce(sum(e.seconds),0) into recorded from production_daily_hour_entries(p_company_id,p_day) e where e.operator_id=p_operator_id;
 recorded:=recorded+coalesce((select sum(a.delta_seconds) from production_hour_adjustments a where a.company_id=p_company_id and a.operator_id=p_operator_id and a.work_day=p_day),0);
 max_seconds:=extract(epoch from(((p_day+1)::timestamp at time zone 'Europe/Rome')-(p_day::timestamp at time zone 'Europe/Rome')));
 if recorded+p_delta_minutes*60>max_seconds then raise exception 'Il totale non può superare la durata della giornata.';end if;
 insert into production_hour_adjustments(id,company_id,operator_id,work_day,kind,job_id,delta_seconds,reason,actor_id)
 values(p_request_id,p_company_id,p_operator_id,p_day,p_kind,job,p_delta_minutes*60,btrim(p_reason),auth.uid());
 return production_daily_hours(p_company_id,p_day);
end $$;
revoke all on function public.production_adjust_hours(uuid,text,date,text,text,integer,text,uuid) from public,anon;
grant execute on function public.production_adjust_hours(uuid,text,date,text,text,integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
