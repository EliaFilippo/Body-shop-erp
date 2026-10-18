begin;
-- The owner supplied the missing exterior-wash standard: 25 person-minutes.
-- Positive overrides, financial budgets, tariffs, sessions and worked seconds stay intact.
create or replace function public.production_time_limits(p_company_id uuid,p_job_id text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with phases as (
  select ph from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j,
   jsonb_array_elements(coalesce(j->'phases','[]')) ph
  where s.company_id=p_company_id and j->>'id'=p_job_id
   and not coalesce((ph->>'notRequired')::boolean,false) and ph->>'name'<>'Consegna'
 ) select coalesce(jsonb_object_agg(ph->>'id',jsonb_build_object(
  'key',coalesce(nullif(ph->>'sharedTimeKey',''),ph->>'id'),
  'minutes',case when ph->>'name'='Lavaggio esterno' and coalesce((ph->>'sharedTimeMinutes')::numeric,(ph->>'estimatedMinutes')::numeric,0)<=0 then 25
   else greatest(0,coalesce((ph->>'sharedTimeMinutes')::numeric,(ph->>'estimatedMinutes')::numeric,0)) end,
  'label',case ph->>'sharedTimeKey' when 'sr' then 'Smontaggio / rimontaggio' when 'is' then 'Incartatura / scartatura'
   when 'v' then 'Verniciatura, carteggiatura e stuccatura' else ph->>'name' end
 )),'{}') from phases;
$$;
revoke all on function public.production_time_limits(uuid,text) from public,anon,authenticated;
update public.production_live_jobs lj
set phase_time_limits=(
 select jsonb_object_agg(t.key,case when t.value->>'label'='Lavaggio esterno'
  and coalesce((t.value->>'minutes')::numeric,0)<=0
  and not exists(select 1 from public.production_phase_checks pc where pc.company_id=lj.company_id and pc.job_id=lj.job_id and pc.phase_id=t.key)
 then jsonb_set(t.value,'{minutes}','25'::jsonb) else t.value end)
 from jsonb_each(lj.phase_time_limits) t
)
where exists(
 select 1 from public.erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j
 where s.company_id=lj.company_id and j->>'id'=lj.job_id and j->>'status' not in ('Consegnata','Annullata')
) and exists(
 select 1 from jsonb_each(lj.phase_time_limits) t
 where t.value->>'label'='Lavaggio esterno' and coalesce((t.value->>'minutes')::numeric,0)<=0
 and not exists(select 1 from public.production_phase_checks pc where pc.company_id=lj.company_id and pc.job_id=lj.job_id and pc.phase_id=t.key)
);
commit;
