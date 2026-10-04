-- Preventivi confermati: modifica riservata al titolare, con storico sul server.
begin;
create table if not exists public.confirmed_estimate_revisions (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),
 document_kind text not null,
 document_id text not null,
 changed_by uuid not null references auth.users(id),
 changed_at timestamptz not null default clock_timestamp(),
 previous_document jsonb not null,
 revised_document jsonb
);
alter table public.confirmed_estimate_revisions enable row level security;
drop policy if exists estimate_revisions_owner_read on public.confirmed_estimate_revisions;
create policy estimate_revisions_owner_read on public.confirmed_estimate_revisions for select to authenticated using (public.is_company_owner(company_id));
grant select on public.confirmed_estimate_revisions to authenticated;

create or replace function public.guard_confirmed_estimates()
returns trigger language plpgsql security definer set search_path = public as $$
declare kind text; previous jsonb; revised jsonb; target jsonb; field text;
begin
 if new.company_id is distinct from old.company_id then raise exception 'Non è consentito spostare un archivio tra aziende.'; end if;
 foreach kind in array array['estimates','quotes'] loop
  for previous in select value from jsonb_array_elements(coalesce(old.payload->kind,'[]'::jsonb)) loop
   if (kind='estimates' and (previous->>'status'='Approvato' or nullif(previous->>'convertedJobId','') is not null))
     or (kind='quotes' and previous->>'status'='accettato') then
    select value into revised from jsonb_array_elements(coalesce(new.payload->kind,'[]'::jsonb)) where value->>'id'=previous->>'id';
    if (select count(*) from jsonb_array_elements(coalesce(new.payload->kind,'[]'::jsonb)) where value->>'id'=previous->>'id') > 1 then raise exception 'Identificativo preventivo duplicato.'; end if;
    if (case when kind='quotes' then revised - 'invoiceId' - 'updatedAt' else revised end) is distinct from (case when kind='quotes' then previous - 'invoiceId' - 'updatedAt' else previous end) then
     if not public.is_company_owner(old.company_id) then raise exception 'Solo il titolare può modificare o eliminare un preventivo confermato.' using errcode='42501'; end if;
     insert into public.confirmed_estimate_revisions(company_id,document_kind,document_id,changed_by,previous_document,revised_document)
       values(old.company_id,kind,previous->>'id',auth.uid(),previous,revised);
    end if;
    -- I campi economici della commessa collegata sono protetti; le fasi restano operative.
    if kind='estimates' and not public.is_company_owner(old.company_id) then
     select value into target from jsonb_array_elements(coalesce(old.payload->'jobs','[]'::jsonb)) where value->>'estimateId'=previous->>'id';
     if target is not null then
      select value into revised from jsonb_array_elements(coalesce(new.payload->'jobs','[]'::jsonb)) where value->>'id'=target->>'id';
      if revised is null then raise exception 'Solo il titolare può eliminare una commessa confermata.' using errcode='42501'; end if;
      foreach field in array array['estimateId','customerId','vehicleId','plate','lines','taxableAmount','vatAmount','total'] loop
       if revised->field is distinct from target->field then raise exception 'Solo il titolare può modificare i dati economici della commessa.' using errcode='42501'; end if;
      end loop;
     end if;
     select value into target from jsonb_array_elements(coalesce(old.payload->'vehicles','[]'::jsonb)) where value->>'id'=previous->>'vehicleId';
     if target is not null then
      select value into revised from jsonb_array_elements(coalesce(new.payload->'vehicles','[]'::jsonb)) where value->>'id'=target->>'id';
      if revised is null or revised->'expectedRevenue' is distinct from target->'expectedRevenue' then raise exception 'Solo il titolare può modificare il valore della vettura confermata.' using errcode='42501'; end if;
     end if;
    end if;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.guard_confirmed_estimates() from public;
drop trigger if exists protect_confirmed_estimates on public.erp_snapshots;
create trigger protect_confirmed_estimates before update on public.erp_snapshots for each row execute function public.guard_confirmed_estimates();
commit;
