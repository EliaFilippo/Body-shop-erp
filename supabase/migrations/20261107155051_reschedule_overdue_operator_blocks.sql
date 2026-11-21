begin;
create or replace function public.production_requeue_overdue_blocks()
returns integer language plpgsql set search_path=public,pg_temp as $$
declare
  item record;
  stamp timestamptz := statement_timestamp();
  queued integer := 0;
begin
  for item in
    select q.company_id, s.payload, q.plan
    from production_completion_queue q
    join production_read_snapshots s using (company_id)
    where q.generation = q.applied_generation
      and (q.last_failure_at is null or q.last_failure_at < stamp - interval '5 minutes')
      and coalesce((s.payload->'nightlyPlanning'->>'enabled')::boolean,false)
    for update of q skip locked
  loop
    if exists (
      with active_plan as (
        select production_completion_overlay(item.company_id,item.payload)->'operatorPrograms' as programs
      ), expired as (
        select task->>'jobId' as job_id,task->>'phaseId' as phase_id
        from active_plan,
          jsonb_array_elements(coalesce(programs,'[]')) program,
          jsonb_array_elements(coalesce(program->'tasks','[]')) task
        where task->>'id' not like 'running:%'
          and case when programs = item.plan->'operatorPrograms'
            then (task->>'endAt')::timestamptz
            else (task->>'endAt')::timestamp at time zone 'Europe/Rome'
          end <= stamp - interval '5 minutes'
          and program->>'date' >= ((item.payload->'nightlyPlanning'->>'generatedAt')::timestamptz at time zone 'Europe/Rome')::date::text
      )
      select 1
      from jsonb_array_elements(coalesce(item.payload->'jobs','[]')) job
      cross join lateral jsonb_array_elements(production_effective_phases(item.company_id,job)) phase
      join expired on expired.phase_id=phase->>'id'
      where expired.job_id=job->>'id'
        and job->>'status' not in ('Consegnata','Annullata','In attesa')
        and phase->>'status' not in ('Completata','Bloccata')
        and coalesce((phase->>'notRequired')::boolean,false)=false
        and not exists (
          select 1 from production_live_segments segment
          where segment.company_id=item.company_id and segment.job_id=expired.job_id
            and segment.phase_id=expired.phase_id and segment.ended_at is null
        )
    ) then
      perform production_completion_enqueue(item.company_id);
      queued := queued + 1;
    end if;
  end loop;
  return queued;
end $$;
revoke all on function public.production_requeue_overdue_blocks() from public,anon,authenticated,service_role;
select cron.schedule('elias-overdue-planning','*/5 * * * *','select public.production_requeue_overdue_blocks()');
commit;
