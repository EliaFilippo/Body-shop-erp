begin;
-- Cache extracted arrays once: avoid repeatedly decompressing a multi-megabyte archive.
create or replace function public.guard_confirmed_estimates()
returns trigger language plpgsql security definer set search_path = public as $$
declare kind text; previous jsonb; revised jsonb; target jsonb; field text; old_docs jsonb; new_docs jsonb; old_jobs jsonb; new_jobs jsonb; old_vehicles jsonb; new_vehicles jsonb; owner boolean;
begin
 if new.company_id is distinct from old.company_id then raise exception 'Non è consentito spostare un archivio tra aziende.'; end if;
 owner:=public.is_company_owner(old.company_id);
 if not owner then
  old_jobs:=coalesce(old.payload->'jobs','[]'); new_jobs:=coalesce(new.payload->'jobs','[]');
  old_vehicles:=coalesce(old.payload->'vehicles','[]'); new_vehicles:=coalesce(new.payload->'vehicles','[]');
 end if;
 foreach kind in array array['estimates','quotes'] loop
  old_docs:=coalesce(old.payload->kind,'[]'); new_docs:=coalesce(new.payload->kind,'[]');
  for previous in select value from jsonb_array_elements(old_docs) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null))
     or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(new_docs) where value->>'id'=previous->>'id';
    if (select count(*) from jsonb_array_elements(new_docs) where value->>'id'=previous->>'id') > 1 then raise exception 'Identificativo preventivo duplicato.'; end if;
    if (case when kind='quotes' then revised - 'invoiceId' - 'updatedAt' else revised end) is distinct from (case when kind='quotes' then previous - 'invoiceId' - 'updatedAt' else previous end) then
     if not owner then raise exception 'Solo il titolare può modificare o eliminare un preventivo confermato.' using errcode='42501'; end if;
     insert into public.confirmed_estimate_revisions(company_id,document_kind,document_id,changed_by,previous_document,revised_document)
       values(old.company_id,kind,previous->>'id',auth.uid(),previous,revised);
    end if;
    -- I campi economici della commessa collegata sono protetti; le fasi restano operative.
    if kind='estimates' and not owner then
     select value into target from jsonb_array_elements(old_jobs) where value->>'estimateId'=previous->>'id';
     if target is not null then
      select value into revised from jsonb_array_elements(new_jobs) where value->>'id'=target->>'id';
      if revised is null then raise exception 'Solo il titolare può eliminare una commessa confermata.' using errcode='42501'; end if;
      foreach field in array array['estimateId','customerId','vehicleId','plate','lines','taxableAmount','vatAmount','total'] loop
       if revised->field is distinct from target->field then raise exception 'Solo il titolare può modificare i dati economici della commessa.' using errcode='42501'; end if;
      end loop;
     end if;
     select value into target from jsonb_array_elements(old_vehicles) where value->>'id'=previous->>'vehicleId';
     if target is not null then
      select value into revised from jsonb_array_elements(new_vehicles) where value->>'id'=target->>'id';
      if revised is null or revised->'expectedRevenue' is distinct from target->'expectedRevenue' then raise exception 'Solo il titolare può modificare il valore della vettura confermata.' using errcode='42501'; end if;
     end if;
    end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;

revoke all on function public.guard_confirmed_estimates() from public,anon,authenticated;
create or replace function public.require_recent_owner_password()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text; previous jsonb; revised jsonb; old_docs jsonb; new_docs jsonb;
begin
 if not exists(select 1 from company_members where company_id=old.company_id and user_id=auth.uid() and active and role in ('owner','office')) then return new;end if;
 foreach kind in array array['estimates','quotes'] loop
  old_docs:=coalesce(old.payload->kind,'[]'); new_docs:=coalesce(new.payload->kind,'[]');
  for previous in select value from jsonb_array_elements(old_docs) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null)) or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(new_docs) where value->>'id'=previous->>'id';
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
