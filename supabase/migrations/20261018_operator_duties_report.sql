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
