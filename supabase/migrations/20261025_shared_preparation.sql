begin;
create table if not exists public.preparation_cycle_backups(
 company_id uuid primary key, payload jsonb not null, saved_at timestamptz not null default clock_timestamp()
);
alter table public.preparation_cycle_backups enable row level security;
revoke all on public.preparation_cycle_backups from public,anon,authenticated;

-- Pure, idempotent job conversion. Phase identifiers and recorded work stay intact.
create or replace function public.production_split_preparation(job jsonb,advanced boolean default false)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare prep jsonb; paint jsonb; ph jsonb; phases jsonb:='[]'; total numeric; ordinal int:=0; skip_prep boolean;
begin
 if job->>'workflowCycle'<>'elias-v1' or job->>'status' in ('Consegnata','Annullata')
  or coalesce((job->>'sharedPreparationCycle')::boolean,false) then return job;end if;
 select value into paint from jsonb_array_elements(coalesce(job->'phases','[]')) where value->>'name'='Verniciatura';
 if paint is null or coalesce((paint->>'notRequired')::boolean,false) then return job;end if;
 select value into prep from jsonb_array_elements(coalesce(job->'phases','[]')) where value->>'name'='Stuccatura';
 select coalesce(sum(greatest(0,coalesce((value->>'estimatedMinutes')::numeric,0))),0) into total
  from jsonb_array_elements(job->'phases') where value->>'name' in ('Stuccatura','Verniciatura');
 if total<=0 then total:=greatest(coalesce((paint->>'sharedTimeMinutes')::numeric,0),coalesce((prep->>'sharedTimeMinutes')::numeric,0));end if;
 if total<=0 then return job;end if;
 skip_prep:=advanced and coalesce((prep->>'notRequired')::boolean,true);
 if prep is null then prep:=jsonb_build_object('id',(job->>'id')||'-preparation-v2','name','Stuccatura','status','Da fare','actualMinutes',0,'operatorAssignments','[]'::jsonb,'timeAdjustments','[]'::jsonb,'notes','Preparazione separata dalla verniciatura; totale V invariato.');end if;
 prep:=prep||jsonb_build_object('requiredSkill','Stuccatura','sharedTimeKey','v','sharedTimeMinutes',total,'estimatedMinutes',case when skip_prep then 0 else total end,
  'notRequired',skip_prep,'status',case when skip_prep then 'Completata' when coalesce((prep->>'notRequired')::boolean,false) then 'Da fare' else coalesce(prep->>'status','Da fare') end,'technicalWaitMinutes',0);
 paint:=paint||jsonb_build_object('requiredSkill','Verniciatura','sharedTimeKey','v','sharedTimeMinutes',total,'estimatedMinutes',case when skip_prep then total else 0 end);
 for ph in select value from jsonb_array_elements(job->'phases') loop
  if ph->>'name'='Stuccatura' then continue;end if;
  if ph->>'name'='Incartatura' then ordinal:=ordinal+1;phases:=phases||jsonb_build_array(prep||jsonb_build_object('cycleOrder',ordinal));end if;
  ordinal:=ordinal+1;
  if ph->>'name'='Verniciatura' then
   if not exists(select 1 from jsonb_array_elements(phases) where value->>'name'='Stuccatura') then phases:=phases||jsonb_build_array(prep||jsonb_build_object('cycleOrder',ordinal));ordinal:=ordinal+1;end if;
   ph:=paint;
  end if;
  phases:=phases||jsonb_build_array(ph||jsonb_build_object('cycleOrder',ordinal));
 end loop;
 return job||jsonb_build_object('phases',phases,'sharedPreparationCycle',true);
end $$;
revoke all on function public.production_split_preparation(jsonb,boolean) from public,anon,authenticated;

do $$declare row record; job jsonb; revised jsonb; jobs jsonb; advanced boolean; changed boolean; prep jsonb;paint jsonb;total numeric;
begin
 for row in select company_id,payload from erp_snapshots for update loop
  perform pg_advisory_xact_lock(hashtextextended(row.company_id::text,0));
  jobs:='[]';changed:=false;
  for job in select value from jsonb_array_elements(coalesce(row.payload->'jobs','[]')) loop
   advanced:=exists(select 1 from jsonb_array_elements(coalesce(job->'phases','[]')) ph where ph->>'name' in ('Incartatura','Verniciatura','Scartatura','Rimontaggio','Consegna')
    and not coalesce((ph->>'notRequired')::boolean,false)
    and (ph->>'status' in ('In lavorazione','Completata') or coalesce((ph->>'actualMinutes')::numeric,0)>0
      or exists(select 1 from production_live_segments sg where sg.company_id=row.company_id and sg.job_id=job->>'id' and sg.phase_id=ph->>'id')
      or exists(select 1 from production_phase_checks pc where pc.company_id=row.company_id and pc.job_id=job->>'id' and pc.phase_id=ph->>'id')));
   revised:=production_split_preparation(job,advanced);changed:=changed or revised is distinct from job;
   jobs:=jobs||jsonb_build_array(revised);
  end loop;
  if changed then
   insert into preparation_cycle_backups(company_id,payload) values(row.company_id,row.payload) on conflict do nothing;
   update erp_snapshots set payload=jsonb_set(payload,'{jobs}',jobs),revision=revision+1 where company_id=row.company_id;
   for job in select value from jsonb_array_elements(jobs) where coalesce((value->>'sharedPreparationCycle')::boolean,false) loop
    select value into prep from jsonb_array_elements(job->'phases') where value->>'name'='Stuccatura';
    select value into paint from jsonb_array_elements(job->'phases') where value->>'name'='Verniciatura';
    total:=(paint->>'sharedTimeMinutes')::numeric;
    update production_live_jobs set phase_time_limits=phase_time_limits||jsonb_build_object(
     prep->>'id',jsonb_build_object('key','v','minutes',total,'label','Stuccatura e carteggiatura / Verniciatura'),
     paint->>'id',jsonb_build_object('key','v','minutes',total,'label','Stuccatura e carteggiatura / Verniciatura'))
     where company_id=row.company_id and job_id=job->>'id';
   end loop;
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
