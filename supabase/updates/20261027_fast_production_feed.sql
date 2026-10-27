begin;
-- Pure permission predicate. Same rules as production_operator_can_phase; no repeated archive reads.
create or replace function public.production_phase_matches_operator(op jsonb,ph jsonb)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare required text;skills text[];
begin
 if op is null or not coalesce((op->>'active')::boolean,false) or ph is null
  or coalesce((ph->>'notRequired')::boolean,false) or ph->>'name'='Consegna' then return false;end if;
 select coalesce(array_agg(lower(translate(trim(value),'àèéìòù','aeeiou'))),'{}') into skills
  from jsonb_array_elements_text(coalesce(op->'skills','[]'));
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
revoke all on function public.production_phase_matches_operator(jsonb,jsonb) from public,anon,authenticated;
-- Patch only the existing duties layer, preserving cones, activities and overtime wrappers.
create or replace function public.production_live_feed_before_cones(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;profile text;item jsonb;phases jsonb;jobs jsonb:='[]';program jsonb;
 snapshot jsonb;op jsonb;allowed jsonb;
begin
 result:=production_live_feed_before_duties(p_company_id);
 if result->>'role' in ('owner','office') then return result;end if;
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 select payload into snapshot from erp_snapshots where company_id=p_company_id;
 select value into op from jsonb_array_elements(coalesce(snapshot->'plannerSettings'->'operators','[]')) where value->>'id'=profile;
 select coalesce(jsonb_object_agg(j->>'id',ids),'{}') into allowed from
 jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j
 cross join lateral (select coalesce(jsonb_agg(p->'id'),'[]') ids
  from jsonb_array_elements(coalesce(j->'phases','[]')) p
  where production_phase_matches_operator(op,p)) permitted;
 for item in select value from jsonb_array_elements(coalesce(result->'jobs','[]')) loop
  select coalesce(jsonb_agg(ph),'[]') into phases from jsonb_array_elements(coalesce(item->'phases','[]')) ph
   where coalesce((allowed->(item->>'jobId')) ? (ph->>'id'),false);
  if jsonb_array_length(phases)>0 or item->>'ownStatus' in ('running','paused') then
   jobs:=jobs||jsonb_build_array(item||jsonb_build_object('phases',phases,'dutiesFiltered',true));
  end if;
 end loop;
 select coalesce(jsonb_agg(t),'[]') into program from jsonb_array_elements(coalesce(result->'program','[]')) t
  where coalesce((allowed->(t->>'jobId')) ? (t->>'phaseId'),false);
 return result||jsonb_build_object('jobs',jobs,'program',program,'dutiesFiltered',true);
end $$;
revoke all on function public.production_live_feed_before_cones(uuid) from public,anon,authenticated;

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
  select checked_at into completed from production_phase_checks where company_id=p_company_id and job_id=job->>'id' and phase_id=predecessor->>'id';
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

create or replace function public.production_job_details(p_company_id uuid,p_job_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare job jsonb;profile text;phases jsonb;tasks jsonb;
begin
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
 with source as materialized (
  select ph,ord,production_cycle_gate_for_job(p_company_id,job,ph->>'id') gate
  from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality s(ph,ord)
 )
 select jsonb_agg(jsonb_build_object('id',ph->>'id','name',ph->>'name','notRequired',coalesce((ph->>'notRequired')::boolean,false),
 'status',case when checkmark.phase_id is not null then 'Completata' when ph->>'status'='Completata' then 'Completata'
  when not coalesce((ph->>'notRequired')::boolean,false) and gate<>'' then 'Bloccata' else ph->>'status' end,
 'checkedBy',checkmark.operator_name,'checkedAt',checkmark.checked_at,'blockedReason',coalesce(nullif(gate,''),ph->>'blockedReason'),
 'canComplete',exists(select 1 from production_live_segments sg where sg.company_id=p_company_id and sg.job_id=p_job_id and sg.operator_id=profile and sg.user_id=auth.uid() and sg.phase_id=ph->>'id'))
 order by coalesce((ph->>'cycleOrder')::numeric,ord)) into phases
 from source left join production_phase_checks checkmark on checkmark.company_id=p_company_id and checkmark.job_id=p_job_id and checkmark.phase_id=ph->>'id';
 select jsonb_agg(jsonb_build_object('id',line->>'id','description',line->>'description','panel',line->>'panelName','quantity',line->'quantity') order by ord)
 into tasks from jsonb_array_elements(coalesce(job->'lines','[]')) with ordinality source(line,ord);
 return jsonb_build_object('phases',coalesce(phases,'[]'),'tasks',coalesce(tasks,'[]'));
end $$;
revoke all on function public.production_job_details(uuid,text) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.production_live_feed_before_duties(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare result jsonb; item jsonb; ph jsonb; jobs jsonb:='[]'; phases jsonb; limits jsonb; facts jsonb; all_facts jsonb; g text; extra numeric;
begin
 result:=production_live_feed_before_overruns(p_company_id); -- original tenant and role checks
 perform production_scan_overruns(p_company_id);
 select coalesce(jsonb_object_agg(job_id,groups),'{}') into all_facts from (
 select f.job_id,jsonb_object_agg(f.group_key,to_jsonb(greatest(0,f.spent_seconds-f.assigned_seconds))) groups
 from production_time_facts(p_company_id) f where f.assigned_seconds>0 group by f.job_id) grouped;
 for item in select value from jsonb_array_elements(result->'jobs') loop
  phases:='[]';
  select phase_time_limits into limits from production_live_jobs where company_id=p_company_id and job_id=item->>'jobId';
  facts:=coalesce(all_facts->(item->>'jobId'),'{}');
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
end $function$

revoke all on function public.production_live_feed_before_duties(uuid) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
