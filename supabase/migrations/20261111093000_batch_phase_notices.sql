begin;
create function public.production_phase_notices_batch(p_company_id uuid, p_job_ids text[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare member_role text; result jsonb;
begin
  select role into member_role from company_members
    where company_id=p_company_id and user_id=auth.uid() and active;
  if member_role is null or member_role not in ('owner','office','production') then
    raise exception 'Accesso aziendale richiesto';
  end if;
  if member_role='production' and not exists(
    select 1 from production_profiles pp join erp_snapshots s on s.company_id=pp.company_id
    cross join lateral jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'operators','[]')) o
    where pp.company_id=p_company_id and pp.user_id=auth.uid()
      and o->>'id'=pp.operator_id and coalesce((o->>'active')::boolean,false)
  ) then raise exception 'Profilo operatore non abilitato'; end if;
  select coalesce(jsonb_object_agg(job_id, notices),'{}'::jsonb) into result
  from (
    select n.job_id,jsonb_agg(jsonb_build_object('id',n.id,'phaseId',n.phase_id,'phaseName',n.phase_name,
      'body',n.body,'authorName',n.author_name,'authorRole',n.author_role,'createdAt',n.created_at,
      'reviewedName',n.reviewed_name,'reviewedAt',n.reviewed_at) order by n.created_at,n.id) as notices
    from production_phase_notices n
    where n.company_id=p_company_id and n.job_id=any(p_job_ids)
      and (member_role<>'production' or exists(
        select 1 from production_live_jobs j where j.company_id=p_company_id and j.job_id=n.job_id))
      and exists(select 1 from erp_snapshots s
        cross join lateral jsonb_array_elements(coalesce(s.payload->'jobs','[]')) j
        where s.company_id=p_company_id and j->>'id'=n.job_id)
    group by n.job_id
  ) grouped;
  return result;
end $$;
revoke all on function public.production_phase_notices_batch(uuid,text[]) from public,anon;
grant execute on function public.production_phase_notices_batch(uuid,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
