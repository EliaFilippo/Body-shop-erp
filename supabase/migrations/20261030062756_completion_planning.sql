begin;
-- Derived operational plans are isolated from the office archive and its CAS revision.
create table if not exists public.production_completion_queue(
 company_id uuid primary key references public.companies(id) on delete cascade,
 generation bigint not null default 0,applied_generation bigint not null default 0,
 requested_at timestamptz not null default clock_timestamp(),last_dispatch_at timestamptz,
 claim_id uuid,lease_until timestamptz,source_revision bigint,source_watermark text,input_hash text,
 plan jsonb,plan_input_hash text,computed_at timestamptz,last_failure_at timestamptz
);
create table if not exists public.production_completion_worker(
 singleton boolean primary key default true check(singleton),endpoint text not null,secret_hash text not null
);
alter table public.production_completion_queue enable row level security;
alter table public.production_completion_worker enable row level security;
revoke all on public.production_completion_queue,public.production_completion_worker from public,anon,authenticated,service_role;
create or replace function public.production_completion_input_hash(p_payload jsonb)
returns text language sql immutable set search_path=public,pg_temp as $$
 select md5(jsonb_build_array(p_payload->'jobs',
 (select coalesce(jsonb_agg(v-'calculatedDeliveryDate' order by v->>'id'),'[]') from jsonb_array_elements(coalesce(p_payload->'vehicles','[]')) v),p_payload->'plannerSettings')::text)
$$;
revoke all on function public.production_completion_input_hash(jsonb) from public,anon,authenticated,service_role;
create or replace function public.production_completion_dispatch(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare endpoint text;secret text;
begin
 if to_regnamespace('net') is null or to_regnamespace('vault') is null then return;end if;
 select w.endpoint into endpoint from production_completion_worker w where singleton;
 if endpoint is null then return;end if;
 update production_completion_queue set last_dispatch_at=clock_timestamp()
 where company_id=p_company_id and generation>applied_generation
 and coalesce(lease_until,'-infinity')<clock_timestamp()
 and coalesce(last_dispatch_at,'-infinity')<clock_timestamp()-interval '3 seconds';
 if not found then return;end if;
 -- The token is generated in Vault and is never returned to clients or logs.
 execute 'select decrypted_secret from vault.decrypted_secrets where name=''production_completion_worker'' limit 1' into secret;
 if secret is null then return;end if;
 execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=60000)'
 using endpoint,jsonb_build_object('Content-Type','application/json','x-planning-secret',secret),jsonb_build_object('companyId',p_company_id);
exception when others then
 -- A network notification must never roll back the operator's signature.
 return;
end $$;
revoke all on function production_completion_dispatch(uuid) from public,anon,authenticated,service_role;
create or replace function public.production_completion_enqueue(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into production_completion_queue(company_id,generation) values(p_company_id,1)
 on conflict(company_id) do update set generation=production_completion_queue.generation+1,requested_at=clock_timestamp();
 perform production_completion_dispatch(p_company_id);
end $$;
revoke all on function production_completion_enqueue(uuid) from public,anon,authenticated,service_role;
create or replace function public.production_completion_signature_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' or new.checked_at is distinct from old.checked_at or new.worked_seconds is distinct from old.worked_seconds then
  perform production_completion_enqueue(new.company_id);
 end if;
 return new;
end $$;
revoke all on function production_completion_signature_trigger() from public,anon,authenticated,service_role;
drop trigger if exists production_completion_replan on public.production_phase_checks;
create trigger production_completion_replan after insert or update on public.production_phase_checks
 for each row execute function public.production_completion_signature_trigger();
create or replace function public.production_completion_archive_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from production_completion_queue where company_id=new.company_id) then return new;end if;
 if new.payload->'nightlyPlanning'->>'generatedAt' is distinct from old.payload->'nightlyPlanning'->>'generatedAt' then
  update production_completion_queue set plan=null,applied_generation=generation,claim_id=null,lease_until=null where company_id=new.company_id;
 elsif production_completion_input_hash(new.payload) is distinct from production_completion_input_hash(old.payload) then
  perform production_completion_enqueue(new.company_id);
 end if;
 return new;
end $$;
revoke all on function production_completion_archive_trigger() from public,anon,authenticated,service_role;
drop trigger if exists production_completion_archive_replan on public.erp_snapshots;
create trigger production_completion_archive_replan after update of payload on public.erp_snapshots
 for each row execute function public.production_completion_archive_trigger();
create or replace function public.production_completion_claim(p_company_id uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q record;s record;facts jsonb;token uuid:=gen_random_uuid();stamp timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from production_completion_worker where singleton and secret_hash=encode(sha256(convert_to(coalesce(p_secret,''),'UTF8')),'hex')) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select * into q from production_completion_queue where company_id=p_company_id for update;
 if not found or q.generation<=q.applied_generation or coalesce(q.lease_until,'-infinity')>stamp then return null;end if;
 select * into s from production_read_snapshots where company_id=p_company_id;
 if not found then return null;end if;
 update production_completion_queue set claim_id=token,lease_until=stamp+interval '90 seconds',source_revision=s.revision,
 source_watermark=production_nightly_watermark(p_company_id),input_hash=production_completion_input_hash(s.payload) where company_id=p_company_id;
 select coalesce(jsonb_agg(entry),'[]') into facts from (
  select jsonb_build_object('jobId',seg.job_id,'phaseId',seg.phase_id,'operatorId',seg.operator_id,'operatorName',max(sess.operator_name),
  'closedSeconds',coalesce(sum(extract(epoch from(seg.ended_at-seg.started_at))) filter(where seg.ended_at is not null),0),
  'runningSince',min(seg.started_at) filter(where seg.ended_at is null),'firstStartedAt',min(seg.started_at),'lastEndedAt',max(seg.ended_at)) entry
  from production_live_segments seg join production_live_sessions sess using(company_id,job_id,operator_id)
  where seg.company_id=p_company_id and seg.phase_id is not null group by seg.job_id,seg.phase_id,seg.operator_id
 ) entries;
 return jsonb_build_object('id',token,'generation',q.generation,'revision',s.revision,'payload',s.payload,
 'state',jsonb_build_object('serverNow',stamp,'entries',facts,'checks',production_current_phase_checks(p_company_id),'phaseStates',production_phase_definitions(p_company_id)));
end $$;
revoke all on function production_completion_claim(uuid,text) from public,anon,authenticated;
grant execute on function production_completion_claim(uuid,text) to service_role;
create or replace function public.production_completion_commit(p_company_id uuid,p_id uuid,p_generation bigint,p_revision bigint,p_plan jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare q record;s record;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
 select * into q from production_completion_queue where company_id=p_company_id for update;
 if not found or q.claim_id is distinct from p_id or coalesce(q.lease_until,'-infinity')<clock_timestamp() then return false;end if;
 select revision,payload into s from production_read_snapshots where company_id=p_company_id;
 if q.generation<>p_generation or s.revision<>p_revision or q.source_revision<>p_revision or q.source_watermark<>production_nightly_watermark(p_company_id) then
  update production_completion_queue set claim_id=null,lease_until=null where company_id=p_company_id;return false;
 end if;
 if jsonb_typeof(p_plan->'operatorPrograms') is distinct from 'array' or jsonb_typeof(p_plan->'forecasts') is distinct from 'array'
 or (p_plan->>'generation')::bigint<>p_generation or nullif(p_plan->>'generatedAt','') is null then raise exception 'Piano operativo non valido';end if;
 update production_completion_queue set plan=p_plan,plan_input_hash=input_hash,computed_at=clock_timestamp(),applied_generation=p_generation,claim_id=null,lease_until=null where company_id=p_company_id;
 return true;
end $$;
revoke all on function production_completion_commit(uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function production_completion_commit(uuid,uuid,bigint,bigint,jsonb) to service_role;
create or replace function public.production_completion_failed(p_company_id uuid,p_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
 update production_completion_queue set claim_id=null,lease_until=null,last_failure_at=clock_timestamp() where company_id=p_company_id and claim_id=p_id
$$;
revoke all on function production_completion_failed(uuid,uuid) from public,anon,authenticated;
grant execute on function production_completion_failed(uuid,uuid) to service_role;
create or replace function public.production_completion_overlay(p_company_id uuid,p_payload jsonb)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select case when q.plan is not null and q.plan_input_hash=production_completion_input_hash(p_payload)
 and (q.plan->>'generatedAt')::timestamptz>coalesce((p_payload->'nightlyPlanning'->>'generatedAt')::timestamptz,'-infinity')
 then p_payload||jsonb_build_object('operatorPrograms',q.plan->'operatorPrograms') else p_payload end
 from (select 1) seed left join production_completion_queue q on q.company_id=p_company_id
$$;
revoke all on function production_completion_overlay(uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.production_completion_plan(p_company_id uuid,p_known_generation bigint default -1)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare q record;s jsonb;
begin
 if not is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto' using errcode='42501';end if;
 select * into q from production_completion_queue where company_id=p_company_id;
 if not found then return jsonb_build_object('pending',false,'reset',true);end if;
 select payload into s from production_read_snapshots where company_id=p_company_id;
 if q.plan is null or q.plan_input_hash is distinct from production_completion_input_hash(s)
 or (q.plan->>'generatedAt')::timestamptz<=coalesce((s->'nightlyPlanning'->>'generatedAt')::timestamptz,'-infinity') then
  return jsonb_build_object('pending',q.generation>q.applied_generation,'reset',true);
 end if;
 return jsonb_build_object('pending',q.generation>q.applied_generation)||case when p_known_generation<>q.applied_generation then jsonb_build_object('plan',q.plan) else '{}'::jsonb end;
end $$;
revoke all on function production_completion_plan(uuid,bigint) from public,anon;
grant execute on function production_completion_plan(uuid,bigint) to authenticated;
-- Preserve all duty, cycle and real-signature guards; only replace the source of proposals.
do $$declare body text;begin
 body:=pg_get_functiondef('public.production_live_feed_before_cones(uuid)'::regprocedure);
 if position('select payload into snapshot from production_read_snapshots' in body)=0 and position('select production_completion_overlay(p_company_id,payload)' in body)=0 then raise exception 'Unexpected production feed prerequisite';end if;
 body:=replace(body,'select payload into snapshot from production_read_snapshots','select production_completion_overlay(p_company_id,payload) into snapshot from production_read_snapshots');
 execute body;
end $$;
do $$begin
 if to_regprocedure('public.production_live_feed_before_completion(uuid)') is null then
  alter function public.production_live_feed(uuid) rename to production_live_feed_before_completion;
 end if;
end $$;
revoke all on function public.production_live_feed_before_completion(uuid) from public,anon,authenticated,service_role;
create or replace function public.production_live_feed(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;source jsonb;plan jsonb;
begin
 result:=production_live_feed_before_completion(p_company_id);
 select payload into source from production_read_snapshots where company_id=p_company_id;
 select q.plan into plan from production_completion_queue q where q.company_id=p_company_id
 and q.plan_input_hash=production_completion_input_hash(source)
 and (q.plan->>'generatedAt')::timestamptz>coalesce((source->'nightlyPlanning'->>'generatedAt')::timestamptz,'-infinity');
 return result||jsonb_build_object('deliveryForecasts',coalesce(plan->'forecasts','[]'),'planningUpdatedAt',plan->>'generatedAt');
end $$;
revoke all on function public.production_live_feed(uuid) from public,anon;
grant execute on function public.production_live_feed(uuid) to authenticated;
create or replace function public.production_completion_dispatch_pending()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare entry record;
begin
 for entry in select company_id from production_completion_queue where generation>applied_generation and coalesce(lease_until,'-infinity')<clock_timestamp() order by requested_at limit 20 loop
  perform production_completion_dispatch(entry.company_id);
 end loop;
end $$;
revoke all on function production_completion_dispatch_pending() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
