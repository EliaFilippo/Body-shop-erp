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
create or replace function public.require_recent_owner_password()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; previous jsonb; revised jsonb;
begin
 if not exists(select 1 from company_members where company_id=old.company_id and user_id=auth.uid() and active and role in ('owner','office')) then return new;end if;
 foreach kind in array array['estimates','quotes'] loop
  for previous in select value from jsonb_array_elements(coalesce(old.payload->kind,'[]')) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null)) or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(coalesce(new.payload->kind,'[]')) where value->>'id'=previous->>'id';
    if (case when kind='quotes' then revised-'invoiceId'-'updatedAt' else revised end) is distinct from (case when kind='quotes' then previous-'invoiceId'-'updatedAt' else previous end)
     and not production_owner_password_recent(old.company_id) then raise exception 'Inserisci la password dei blocchi per modificare il preventivo confermato.' using errcode='42501';end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.require_recent_owner_password() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
