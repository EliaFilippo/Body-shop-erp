-- Rimuove il collegamento al profilo operatore, conservando account e storico.
create or replace function public.production_unbind_profile(p_company_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_company_owner(p_company_id) then raise exception 'Solo il titolare può scollegare i profili'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text,0));
  if not exists(select 1 from company_members where company_id=p_company_id and user_id=p_user_id and active)
    then raise exception 'Account non abilitato per questa azienda'; end if;
  if exists(select 1 from production_live_sessions where company_id=p_company_id and user_id=p_user_id and status='running')
    then raise exception 'Metti in pausa il lavoro prima di scollegare il profilo'; end if;
  -- Gli accessi PIN si gestiscono dal loro modulo: non scollegare un tablet tecnico.
  if exists(select 1 from production_pin_accounts where company_id=p_company_id and user_id=p_user_id)
    then raise exception 'Questo account usa un accesso PIN: gestiscilo da Accessi tablet con PIN'; end if;
  delete from production_profiles where company_id=p_company_id and user_id=p_user_id;
end $$;
revoke all on function public.production_unbind_profile(uuid,uuid) from public,anon;
grant execute on function public.production_unbind_profile(uuid,uuid) to authenticated;

