begin;
-- Canonical, clipped person-time. The Rome calendar handles midnight and DST boundaries.
create or replace function public.production_nightly_workdays(p_company_id uuid,p_as_of timestamptz)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with bounds as (
  select date_trunc('month',p_as_of at time zone 'Europe/Rome')::date first_day,(p_as_of at time zone 'Europe/Rome')::date last_day
 ), days as (
  select d::date day,d::date::timestamp at time zone 'Europe/Rome' lo,(d::date+1)::timestamp at time zone 'Europe/Rome' hi
  from bounds,generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d
 ), work as (
  select s.operator_id,d.day,greatest(0,extract(epoch from(least(s.ended_at,p_as_of,d.hi)-greatest(s.started_at,d.lo)))) seconds,true productive
  from production_live_segments s join days d on s.started_at<least(d.hi,p_as_of) and s.ended_at>d.lo
  where s.company_id=p_company_id and s.ended_at is not null
  union all
  select a.operator_id,d.day,greatest(0,extract(epoch from(least(a.ended_at,p_as_of,d.hi)-greatest(a.started_at,d.lo)))) seconds,false productive
  from production_operator_activities a join days d on a.started_at<least(d.hi,p_as_of) and a.ended_at>d.lo
  where a.company_id=p_company_id and a.ended_at is not null
 ), totals as (
  select operator_id,day,coalesce(sum(seconds) filter(where productive),0) productive_seconds,sum(seconds) paid_seconds
  from work where seconds>0 group by operator_id,day
 ) select coalesce(jsonb_agg(jsonb_build_object('date',day,'operatorId',operator_id,'productiveSeconds',productive_seconds,'paidSeconds',paid_seconds) order by day,operator_id),'[]') from totals;
$$;
revoke all on function public.production_nightly_workdays(uuid,timestamptz) from public,anon,authenticated,service_role;
-- Reuse the existing secret, shift, lease and source-revision checks before exposing any hours.
do $$begin
 if to_regprocedure('public.production_nightly_claim_before_economics(uuid,text)') is null then
  alter function public.production_nightly_claim(uuid,text) rename to production_nightly_claim_before_economics;
 end if;
end $$;
revoke all on function public.production_nightly_claim_before_economics(uuid,text) from public,anon,authenticated,service_role;
create or replace function public.production_nightly_claim(p_company_id uuid,p_secret text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare claim jsonb;hours jsonb;
begin
 claim:=production_nightly_claim_before_economics(p_company_id,p_secret);
 if claim is null then return null;end if;
 hours:=production_nightly_workdays(p_company_id,(claim->'state'->>'serverNow')::timestamptz);
 return jsonb_set(claim,'{state,dailyWork}',hours);
end $$;
revoke all on function public.production_nightly_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.production_nightly_claim(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
