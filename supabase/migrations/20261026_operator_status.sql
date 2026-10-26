-- Read-only operational status, no rates or personal productivity scores.
create or replace function public.production_operator_status(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ufficio richiesto.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'operatorId',s.operator_id,'jobId',s.job_id,'phaseId',s.phase_id,
 'remainingSeconds',case when f.assigned_seconds>0 then greatest(0,f.assigned_seconds-f.spent_seconds) else null end,
 'overrunSeconds',case when f.assigned_seconds>0 then greatest(0,f.spent_seconds-f.assigned_seconds) else 0 end
 )),'[]'::jsonb) into result
 from production_live_segments s
 join production_live_jobs j on j.company_id=s.company_id and j.job_id=s.job_id
 left join lateral (select * from production_time_facts(p_company_id) t
  where t.job_id=s.job_id and t.group_key=coalesce(j.phase_time_limits->s.phase_id->>'key',s.phase_id)) f on true
 where s.company_id=p_company_id and s.ended_at is null and not coalesce(f.closed,false);
 return jsonb_build_object('serverNow',statement_timestamp(),'running',result);
end $$;
revoke all on function public.production_operator_status(uuid) from public,anon;
grant execute on function public.production_operator_status(uuid) to authenticated;
