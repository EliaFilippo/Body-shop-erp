\set ON_ERROR_STOP on
\ir ../migrations/20261018_unbind_profile.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$begin
  begin perform production_unbind_profile('10000000-0000-0000-0000-000000000001',auth.uid());raise exception 'Worker unbound profile';
  exception when raise_exception then if sqlerrm not like 'Solo il titolare%' then raise;end if;end;
end $$;
reset role;
update production_live_sessions set status='running' where user_id='00000000-0000-0000-0000-000000000002';
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin
  begin perform production_unbind_profile('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');raise exception 'Running work unbound';
  exception when raise_exception then if sqlerrm not like 'Metti in pausa%' then raise;end if;end;
end $$;
reset role;
update production_live_sessions set status='paused' where user_id='00000000-0000-0000-0000-000000000002';
do $$declare segments_before bigint; members_before bigint;begin
  select count(*) into segments_before from production_live_segments;
  select count(*) into members_before from company_members;
  perform production_unbind_profile('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
  perform production_unbind_profile('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
  if exists(select 1 from production_profiles where user_id='00000000-0000-0000-0000-000000000002') then raise exception 'Profile still bound';end if;
  if (select count(*) from production_live_segments)<>segments_before or (select count(*) from company_members)<>members_before then raise exception 'History/account changed';end if;
  begin perform production_unbind_profile('10000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000002');raise exception 'Cross tenant unbind';
  exception when raise_exception then if sqlerrm not like 'Solo il titolare%' then raise;end if;end;
end $$;
rollback;
