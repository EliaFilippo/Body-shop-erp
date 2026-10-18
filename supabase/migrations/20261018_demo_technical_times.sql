begin;
-- The owner identified this test job's two pieces from the tablet.
-- This one-off correction changes phase allowances only: quote/job lines, sale amounts and worked records stay intact.
create or replace function public.production_demo_technical_job(job jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare line jsonb; phases jsonb:='[]'; ph jsonb; stage text; descriptor text;
 found_blend integer:=0; found_wing integer:=0; minutes integer; shared_minutes integer; group_key text;
 required boolean; ordinal integer:=0; stamp text:=clock_timestamp()::text;
begin
 if job->>'number' is distinct from 'COMM-00001' or job->>'plate' is distinct from 'HFIEJI' then raise exception 'La correzione riguarda soltanto la commessa di prova COMM-00001 / HFIEJI';end if;
 if job->>'technicalTimeRevision'='demo-tempario-20261018' then return job;end if;
 if job->>'status' in ('Consegnata','Annullata') then raise exception 'La commessa di prova è chiusa';end if;
 if jsonb_array_length(coalesce(job->'lines','[]'))<>2 then raise exception 'Le righe della prova sono cambiate: verifica i due pannelli prima di correggere';end if;
 for line in select value from jsonb_array_elements(job->'lines') loop
  descriptor:=lower(coalesce(line->>'description','')||' '||coalesce(line->>'standardWorkName','')||' '||coalesce(line->>'panelName',''));
  if coalesce((line->>'quantity')::numeric,1)<>1 then raise exception 'Quantità della prova da verificare';end if;
  if descriptor like '%sfumatura%' and descriptor like '%parafango%' and descriptor like '%posteriore%' and descriptor like '%sx%' then
   found_blend:=found_blend+1;
  
  elsif descriptor not like '%sfumatura%' and descriptor like '%parafango%' and descriptor like '%anteriore%' and descriptor like '%dx%' then
   found_wing:=found_wing+1;
  
  else raise exception 'Pannello della prova diverso dalle foto: correzione interrotta';end if;
 end loop;
 if found_blend<>1 or found_wing<>1 then raise exception 'Servono sfumatura parafango posteriore SX e parafango anteriore DX';end if;
 foreach stage in array array['Lavaggio esterno','Smontaggio','Riparazione grandine','Lattoneria','Stuccatura','Incartatura','Verniciatura','Scartatura','Rimontaggio','Meccanica / gommista','Lucidatura','Lavaggio interni','Ritocchi','Consegna'] loop
  ordinal:=ordinal+1;
  if (select count(*) from jsonb_array_elements(coalesce(job->'phases','[]')) p where p->>'name'=stage)>1 then raise exception 'Fasi duplicate nella prova: verifica prima di correggere';end if;
  select p into ph from jsonb_array_elements(coalesce(job->'phases','[]')) p where p->>'name'=stage;
  ph:=coalesce(ph,jsonb_build_object('id',gen_random_uuid()::text,'name',stage,'status','Da fare','notRequired',true,'actualMinutes',0,'notes','','blockedReason','','operatorAssignments','[]'::jsonb,'timeAdjustments','[]'::jsonb));
  required:=stage=any(array['Lavaggio esterno','Smontaggio','Incartatura','Verniciatura','Scartatura','Rimontaggio','Lucidatura','Consegna']);
  minutes:=case stage when 'Lavaggio esterno' then 25 when 'Smontaggio' then 60 when 'Incartatura' then 70 when 'Verniciatura' then 90 when 'Lucidatura' then 15 else 0 end;
  group_key:=case when stage in ('Smontaggio','Rimontaggio') then 'sr' when stage in ('Incartatura','Scartatura') then 'is' when stage in ('Stuccatura','Verniciatura') then 'v' else null end;
  shared_minutes:=case group_key when 'sr' then 60 when 'is' then 70 when 'v' then 90 else null end;
  if required and coalesce((ph->>'notRequired')::boolean,false) and nullif(ph->>'completedAt','') is null and nullif(ph->>'completedByName','') is null then ph:=ph||'{"status":"Da fare"}';end if;
  ph:=ph||jsonb_build_object('cycleOrder',ordinal,'notRequired',not required,'estimatedMinutes',minutes,
    'sharedTimeKey',group_key,'sharedTimeMinutes',shared_minutes,'requiredSkill',stage,
    'technicalWaitMinutes',case when stage='Verniciatura' then 60 else 0 end);
  phases:=phases||jsonb_build_array(ph);
 end loop;
 return job||jsonb_build_object('phases',phases,'workflowCycle','elias-v1','technicalTimeRevision','demo-tempario-20261018','updatedAt',stamp,
  'history',jsonb_build_array(jsonb_build_object('id','demo-tempario-20261018','at',stamp,'actor','Titolare','message','Tempario prova corretto: S/R 60 min, I/S 70 min, verniciatura inclusa stuccatura 90 min, lucidatura 15 min, lavaggio esterno 25 min. Prezzi e lavoro registrato conservati.'))||coalesce(job->'history','[]'));
end $$;
revoke all on function public.production_demo_technical_job(jsonb) from public,anon,authenticated;

create or replace function public.production_repair_demo_times(target_company uuid)
returns void language plpgsql set search_path=public,pg_temp as $$
declare snapshot jsonb; job jsonb; repaired jsonb; jobs jsonb; limits jsonb; ph jsonb; target_job_id text;
begin
 perform pg_advisory_xact_lock(hashtextextended(target_company::text,0));
 select payload into snapshot from erp_snapshots where company_id=target_company for update;
 if snapshot is null then return;end if;
 if (select count(*) from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'number'='COMM-00001' and j->>'plate'='HFIEJI')>1 then raise exception 'Commessa di prova duplicata';end if;
 select j into job from jsonb_array_elements(coalesce(snapshot->'jobs','[]')) j where j->>'number'='COMM-00001' and j->>'plate'='HFIEJI';
 if job is null or job->>'technicalTimeRevision'='demo-tempario-20261018' then return;end if;
 target_job_id:=job->>'id';
 if exists(select 1 from production_live_sessions where company_id=target_company and production_live_sessions.job_id=target_job_id and status='running') then raise exception 'Metti in pausa gli operatori sulla prova prima di aggiornare il tempario';end if;
 repaired:=production_demo_technical_job(job);
 select jsonb_agg(case when j->>'id'=target_job_id then repaired else j end order by ord) into jobs
  from jsonb_array_elements(snapshot->'jobs') with ordinality source(j,ord);
 update erp_snapshots set payload=jsonb_set(payload,'{jobs}',jobs),revision=revision+1,updated_at=clock_timestamp() where company_id=target_company;
 -- Keep the original IDs (including the retired prep phase) in the same shared group:
 -- earlier prep segments continue consuming the painting allowance.
 for ph in select value from jsonb_array_elements(repaired->'phases') loop
  if not coalesce((ph->>'notRequired')::boolean,false) or ph->>'name'='Stuccatura' then
   if ph->>'name'<>'Consegna' then
    limits:=coalesce(limits,'{}')||jsonb_build_object(ph->>'id',jsonb_build_object(
     'key',coalesce(nullif(ph->>'sharedTimeKey',''),ph->>'id'),
     'minutes',coalesce((ph->>'sharedTimeMinutes')::numeric,(ph->>'estimatedMinutes')::numeric,0),
     'label',case ph->>'sharedTimeKey' when 'sr' then 'Smontaggio / rimontaggio' when 'is' then 'Incartatura / scartatura' when 'v' then 'Verniciatura, carteggiatura e stuccatura' else ph->>'name' end));
   end if;
  end if;
 end loop;
 update production_live_jobs set phase_time_limits=limits where company_id=target_company and production_live_jobs.job_id=target_job_id;
end $$;
revoke all on function public.production_repair_demo_times(uuid) from public,anon,authenticated;
select public.production_repair_demo_times('aa49d334-492f-4daa-aa7e-5d5c022308b7');
commit;
