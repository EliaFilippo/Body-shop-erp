begin;
-- Reserve time for archive writes without relaxing normal tablet/read limits.
alter function public.erp_update_snapshot_sections(uuid,bigint,jsonb,text[])
 set statement_timeout='45s';
notify pgrst,'reload schema';
commit;
