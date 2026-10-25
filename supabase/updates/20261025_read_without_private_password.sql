begin;
-- Reading office reports no longer needs the separate edit password.
-- Existing row-level company access and production-only restrictions remain in effect.
create or replace function public.production_report_access(p_company_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from company_members where company_id=p_company_id and user_id=auth.uid() and active and role in ('owner','office'))
 then raise exception 'Accesso ufficio richiesto' using errcode='42501';end if;
end $$;
revoke all on function public.production_report_access(uuid) from public,anon;
grant execute on function public.production_report_access(uuid) to authenticated;
-- Keep production_owner_password_recent and the confirmed-document write trigger unchanged.
notify pgrst,'reload schema';
commit;
