begin;
create or replace function public.require_recent_owner_password()
returns trigger language plpgsql security definer set search_path=public as $$
declare kind text; previous jsonb; revised jsonb; authenticated_at numeric;
begin
 if not public.is_company_owner(old.company_id) then return new; end if;
 select max((entry->>'timestamp')::numeric) into authenticated_at
 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) entry where entry->>'method'='password';
 foreach kind in array array['estimates','quotes'] loop
  for previous in select value from jsonb_array_elements(coalesce(old.payload->kind,'[]'::jsonb)) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null)) or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(coalesce(new.payload->kind,'[]'::jsonb)) where value->>'id'=previous->>'id';
    if (case when kind='quotes' then revised-'invoiceId'-'updatedAt' else revised end) is distinct from (case when kind='quotes' then previous-'invoiceId'-'updatedAt' else previous end)
       and (authenticated_at is null or authenticated_at<extract(epoch from clock_timestamp())-300 or authenticated_at>extract(epoch from clock_timestamp())+30) then
     raise exception 'Inserisci nuovamente la password del titolare per modificare il preventivo confermato.' using errcode='42501';
    end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.require_recent_owner_password() from public;
drop trigger if exists require_password_for_confirmed_estimates on public.erp_snapshots;
create trigger require_password_for_confirmed_estimates before update on public.erp_snapshots for each row execute function public.require_recent_owner_password();
commit;
