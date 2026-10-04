begin;
create or replace function public.production_cycle_gate(p_company_id uuid,p_job_id text,p_phase_id text)
returns text language plpgsql security definer set search_path=public as $$
declare job jsonb; phase jsonb; predecessor jsonb; target_order bigint; completed timestamptz; stamp timestamptz:=clock_timestamp();
begin
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
 if job->>'workflowCycle' is distinct from 'elias-v1' then return ''; end if;
 select ph,ord into phase,target_order from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality source(ph,ord) where ph->>'id'=p_phase_id;
 if phase is null then return 'Scegli una fase da lavorare'; end if;
 if phase->>'name'='Consegna' then return 'La consegna viene registrata dall’ufficio'; end if;
 for predecessor in select ph from jsonb_array_elements(job->'phases') with ordinality source(ph,ord) where ord<target_order and not coalesce((ph->>'notRequired')::boolean,false) loop
  select checked_at into completed from production_phase_checks where company_id=p_company_id and job_id=p_job_id and phase_id=predecessor->>'id';
  if completed is null and predecessor->>'status' is distinct from 'Completata' then return 'Completa le fasi precedenti prima di iniziare questa fase'; end if;
  if predecessor->>'name'='Verniciatura' then
   completed:=coalesce(completed,nullif(predecessor->>'completedAt','')::timestamptz,nullif(predecessor->>'endedAt','')::timestamptz);
   if completed is null then return 'Registra l’orario di fine verniciatura'; end if;
   if completed+interval '1 hour'>stamp then return 'Attesa asciugatura fino alle '||to_char((completed+interval '1 hour') at time zone 'Europe/Rome','HH24:MI'); end if;
  end if;
 end loop;
 return '';
end $$;
revoke all on function public.production_cycle_gate(uuid,text,text) from public;
create or replace function public.guard_production_cycle_start()
returns trigger language plpgsql security definer set search_path=public as $$
declare job jsonb; phase jsonb; operator jsonb; reason text; required text;
begin
 select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=new.company_id and j->>'id'=new.job_id;
 if job->>'workflowCycle' is distinct from 'elias-v1' then return new; end if;
 reason:=production_cycle_gate(new.company_id,new.job_id,new.phase_id);
 if reason<>'' then raise exception '%',reason; end if;
 select ph into phase from jsonb_array_elements(job->'phases') ph where ph->>'id'=new.phase_id;
 select o into operator from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o where s.company_id=new.company_id and o->>'id'=new.operator_id;
 required:=lower(regexp_replace(coalesce(phase->>'requiredSkill',phase->>'name'),'\s','','g'));
 if (coalesce((operator->>'skillsConfigured')::boolean,false) or jsonb_array_length(coalesce(operator->'skills','[]'))>0)
  and not exists(select 1 from jsonb_array_elements_text(coalesce(operator->'skills','[]')) skill where lower(regexp_replace(skill,'\s','','g'))=required)
  then raise exception 'Mansione non abilitata per questo operatore' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_production_cycle_start() from public;
drop trigger if exists production_cycle_start on public.production_live_segments;
create trigger production_cycle_start before insert on public.production_live_segments for each row execute function public.guard_production_cycle_start();
create or replace function public.production_job_details(p_company_id uuid,p_job_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare job jsonb; profile text; phases jsonb; tasks jsonb;
begin
  select j into job from erp_snapshots s,jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j where s.company_id=p_company_id and j->>'id'=p_job_id;
  select operator_id into profile from production_profiles where company_id=p_company_id and user_id=auth.uid();
  select jsonb_agg(jsonb_build_object('id',ph->>'id','name',ph->>'name','notRequired',coalesce((ph->>'notRequired')::boolean,false),
    'status',case when checkmark.phase_id is not null then 'Completata' when ph->>'status'='Completata' then 'Completata' when not coalesce((ph->>'notRequired')::boolean,false) and production_cycle_gate(p_company_id,p_job_id,ph->>'id')<>'' then 'Bloccata' else ph->>'status' end,
    'checkedBy',checkmark.operator_name,'checkedAt',checkmark.checked_at,'blockedReason',coalesce(nullif(production_cycle_gate(p_company_id,p_job_id,ph->>'id'),''),ph->>'blockedReason'),
    'canComplete',exists(select 1 from production_live_segments sg where sg.company_id=p_company_id and sg.job_id=p_job_id and sg.operator_id=profile and sg.user_id=auth.uid() and sg.phase_id=ph->>'id'))
    order by coalesce((ph->>'cycleOrder')::numeric,ord)) into phases
    from jsonb_array_elements(coalesce(job->'phases','[]')) with ordinality source(ph,ord)
    left join production_phase_checks checkmark on checkmark.company_id=p_company_id and checkmark.job_id=p_job_id and checkmark.phase_id=ph->>'id';
  select jsonb_agg(jsonb_build_object('id',line->>'id','description',line->>'description','panel',line->>'panelName','quantity',line->'quantity') order by ord)
    into tasks from jsonb_array_elements(coalesce(job->'lines','[]')) with ordinality source(line,ord);
  return jsonb_build_object('phases',coalesce(phases,'[]'),'tasks',coalesce(tasks,'[]'));
end $$;

commit;
