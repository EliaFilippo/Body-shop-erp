begin;
-- The manual command explicitly bypasses drying. Automatic starts still use both drying checks.
CREATE OR REPLACE FUNCTION public.production_manual_start_before_progress(p_company_id uuid, p_job_id text, p_phase_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare profile text; op jsonb; snapshot jsonb; job jsonb; phase jsonb; prior record; stamp timestamptz;
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
end $function$;

CREATE OR REPLACE FUNCTION public.guard_production_cycle_start()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare reason text; has_phases boolean;
begin
 -- Manual work is an explicit authenticated choice, recorded on the immutable work segment.
 if new.manual_start then
  if not is_active_company_member(new.company_id) or not exists(
   select 1 from production_profiles p where p.company_id=new.company_id and p.user_id=auth.uid() and p.operator_id=new.operator_id
  ) then raise exception 'Accesso operatore richiesto' using errcode='42501';end if;
  return new;
 end if;
 reason:=production_unquoted_drying_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason;end if;
 select exists(select 1 from jsonb_array_elements(production_effective_phases(new.company_id,j)) p where not coalesce((p->>'notRequired')::boolean,false)) into has_phases from erp_snapshots s,
  jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=new.company_id and j->>'id'=new.job_id;
 if coalesce(has_phases,false) and not production_operator_can_phase(new.company_id,new.job_id,new.operator_id,new.phase_id)
  then raise exception 'Mansione non abilitata per questo operatore' using errcode='42501';end if;
 reason:=production_cycle_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason;end if;
 return new;
end $function$;
commit;
