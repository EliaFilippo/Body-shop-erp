begin;
create table if not exists public.production_operator_activities (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 operator_id text not null, user_id uuid not null references auth.users(id), operator_name text not null,
 kind text not null check(kind in ('cleaning','coffee')),
 started_at timestamptz not null default clock_timestamp(), ended_at timestamptz,
 check(ended_at is null or ended_at>=started_at)
);
create unique index if not exists production_operator_activity_open
 on public.production_operator_activities(company_id,operator_id) where ended_at is null;
create index if not exists production_operator_activity_history
 on public.production_operator_activities(company_id,operator_id,started_at);
alter table public.production_operator_activities enable row level security;
revoke all on public.production_operator_activities from public,anon,authenticated;

create or replace function public.production_activity_action(p_company_id uuid,p_kind text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare profile text; operator jsonb; stamp timestamptz; current_kind text;
begin
 if not public.is_active_company_member(p_company_id) then raise exception 'Accesso aziendale richiesto';end if;
 if p_kind is null or p_kind not in ('cleaning','coffee','end') then raise exception 'Attività non valida';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 stamp:=clock_timestamp();
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 if profile is null then raise exception 'Il titolare deve collegare questo account a un operatore';end if;
 if p_kind='end' then
  update production_operator_activities set ended_at=stamp where company_id=p_company_id and operator_id=profile and ended_at is null;
  return;
 end if;
 select o into operator from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
  where s.company_id=p_company_id and o->>'id'=profile and coalesce((o->>'active')::boolean,false);
 if operator is null then raise exception 'Operatore disattivato';end if;
 select kind into current_kind from production_operator_activities where company_id=p_company_id and operator_id=profile and ended_at is null;
 if current_kind=p_kind then return;end if;
 -- Stop only this employee. Never complete a phase or stop a colleague.
 update production_live_segments set ended_at=stamp where company_id=p_company_id and operator_id=profile and ended_at is null;
 update production_live_sessions set status='paused' where company_id=p_company_id and operator_id=profile and status='running';
 update production_operator_activities set ended_at=stamp where company_id=p_company_id and operator_id=profile and ended_at is null;
 insert into production_operator_activities(company_id,operator_id,user_id,operator_name,kind,started_at)
 values(p_company_id,profile,auth.uid(),operator->>'name',p_kind,stamp);
end $$;
revoke all on function public.production_activity_action(uuid,text) from public,anon;
grant execute on function public.production_activity_action(uuid,text) to authenticated;

-- The company lock is shared with timer Start: two devices cannot overlap activities and vehicle work.
create or replace function public.production_guard_operator_activity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.ended_at is null then
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
  if exists(select 1 from production_operator_activities a where a.company_id=new.company_id and a.operator_id=new.operator_id and a.ended_at is null)
   then raise exception 'Termina prima PULIZIE o PAUSA CAFFÈ, poi riprendi la vettura';end if;
 end if;
 return new;
end $$;
revoke all on function public.production_guard_operator_activity() from public,anon,authenticated;
drop trigger if exists production_guard_operator_activity on public.production_live_segments;
create trigger production_guard_operator_activity before insert on public.production_live_segments
 for each row execute function public.production_guard_operator_activity();

create or replace function public.production_own_activity(p_company_id uuid,p_operator_id text,p_stamp timestamptz)
returns jsonb language sql set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'kind',(select kind from production_operator_activities where company_id=p_company_id and operator_id=p_operator_id and ended_at is null),
 'elapsedSeconds',coalesce((select greatest(0,extract(epoch from(p_stamp-started_at))) from production_operator_activities where company_id=p_company_id and operator_id=p_operator_id and ended_at is null),0),
 'cleaningSeconds',coalesce(sum(case when kind='cleaning' then greatest(0,extract(epoch from(least(coalesce(ended_at,p_stamp),p_stamp)-greatest(started_at,((p_stamp at time zone 'Europe/Rome')::date::timestamp at time zone 'Europe/Rome'))))) else 0 end),0),
 'coffeeSeconds',coalesce(sum(case when kind='coffee' then greatest(0,extract(epoch from(least(coalesce(ended_at,p_stamp),p_stamp)-greatest(started_at,((p_stamp at time zone 'Europe/Rome')::date::timestamp at time zone 'Europe/Rome'))))) else 0 end),0))
 from production_operator_activities where company_id=p_company_id and operator_id=p_operator_id
 and started_at<p_stamp and coalesce(ended_at,p_stamp)>((p_stamp at time zone 'Europe/Rome')::date::timestamp at time zone 'Europe/Rome');
$$;
revoke all on function public.production_own_activity(uuid,text,timestamptz) from public,anon,authenticated;
do $$begin
 if to_regprocedure('public.production_live_feed_before_activities(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_activities;
 end if;
end $$;
revoke all on function public.production_live_feed_before_activities(uuid) from public,anon,authenticated;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; profile text;
begin
 result:=production_live_feed_before_activities(p_company_id);
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 return result||jsonb_build_object('activity',case when profile is null then null else production_own_activity(p_company_id,profile,clock_timestamp()) end);
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
