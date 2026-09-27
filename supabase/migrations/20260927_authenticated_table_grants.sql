-- Correzione per progetti su cui supabase/schema.sql è già stato applicato.
-- Eseguire nel SQL Editor di Supabase dopo aver verificato che RLS sia attiva
-- e che le policy dello schema limitino l'accesso alla propria azienda.
-- Non concede accesso agli utenti anonimi né il permesso di eliminare dati.

begin;
grant select on public.companies, public.company_members to authenticated;
grant select, insert, update on public.erp_snapshots to authenticated;
commit;
