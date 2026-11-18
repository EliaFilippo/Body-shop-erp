-- Read the publication registry independently of the filtered tablet feed.
begin;

create or replace function public.production_publication_state(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when public.is_office_company_member(p_company_id) then (
    select jsonb_build_object(
      'revision', snapshot.revision,
      'preparedJobIds', coalesce((
        select jsonb_agg(job.job_id)
        from public.production_live_jobs job
        where job.company_id = snapshot.company_id
      ), '[]'::jsonb)
    )
    from public.erp_snapshots snapshot
    where snapshot.company_id = p_company_id
  ) end;
$$;

revoke all on function public.production_publication_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.production_publication_state(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
