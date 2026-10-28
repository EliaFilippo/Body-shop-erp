begin;
-- Send only changed top-level sections. Large immutable planning histories stay
-- on the server. CAS, RLS and the existing quote/password triggers still apply.
create or replace function public.erp_update_snapshot_sections(
 p_company_id uuid,p_expected_revision bigint,p_changes jsonb,p_remove_keys text[] default '{}'
) returns table(company_id uuid,revision bigint,updated_at timestamptz)
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not public.is_office_company_member(p_company_id) then raise exception 'Accesso ai dati cloud negato.' using errcode='42501';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'Salvataggio cloud non valido.' using errcode='22023';end if;
 return query update public.erp_snapshots s
 set payload=(s.payload-coalesce(p_remove_keys,'{}'::text[]))||p_changes,
 revision=s.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
 where s.company_id=p_company_id and s.revision=p_expected_revision
 returning s.company_id,s.revision,s.updated_at;
end $$;
revoke all on function public.erp_update_snapshot_sections(uuid,bigint,jsonb,text[]) from public,anon;
grant execute on function public.erp_update_snapshot_sections(uuid,bigint,jsonb,text[]) to authenticated;
notify pgrst,'reload schema';
commit;
