\set ON_ERROR_STOP on
\ir ../migrations/20261006_phase_notices.sql
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs,0,phases}','[{"id":"notice-phase","name":"Lattoneria","status":"Da fare"}]');
set role authenticated;
select production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','add','notice-phase','Proteggere il rivestimento.','20000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','add','notice-phase','Serve un controllo prima del rimontaggio.','20000000-0000-0000-0000-000000000002');
-- Retry must not duplicate the append or alter its author/time.
select production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','add','notice-phase','Serve un controllo prima del rimontaggio.','20000000-0000-0000-0000-000000000002');
do $$declare notes jsonb; begin
  notes:=production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1');
  if jsonb_array_length(notes)<>2 or notes->1->>'authorName'<>'A' or notes->1->>'phaseName'<>'Lattoneria' then raise exception 'Missing phase/author or duplicate retry'; end if;
  begin perform production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','review',null,null,'20000000-0000-0000-0000-000000000001'); raise exception 'Operator reviewed office notice';
  exception when raise_exception then if sqlerrm not like 'Solo l%ufficio%' then raise; end if; end;
  begin perform production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','add','bad-phase','Test','20000000-0000-0000-0000-000000000003'); raise exception 'Unknown phase accepted';
  exception when raise_exception then if sqlerrm not like 'Scegli una fase%' then raise; end if; end;
  begin perform production_phase_notices_action('10000000-0000-0000-0000-000000000099','j1'); raise exception 'Cross tenant read';
  exception when raise_exception then if sqlerrm not like 'Accesso aziendale%' then raise; end if; end;
  begin perform * from production_phase_notices; raise exception 'Direct table read'; exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','add','notice-phase','Controllo effettuato da B.','20000000-0000-0000-0000-000000000003');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','review',null,null,'20000000-0000-0000-0000-000000000002');
do $$declare notes jsonb; begin
  notes:=production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1');
  if jsonb_array_length(notes)<>3 or notes->1->>'reviewedName'<>'Owner' or notes->1->>'reviewedAt' is null or notes->2->>'authorName'<>'B' then raise exception 'Office review/provenance missing'; end if;
end $$;
reset role;
insert into company_members(company_id,user_id,display_name,role) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','Office colleague','office');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
set role authenticated;
select production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','review',null,null,'20000000-0000-0000-0000-000000000003');
do $$begin
  if production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1')->2->>'reviewedName'<>'Office colleague' then raise exception 'Office colleague cannot review'; end if;
end $$;
reset role;
update erp_snapshots set payload=jsonb_set(payload,'{jobs,0,status}','"Consegnata"');
set role authenticated;
do $$begin
  if jsonb_array_length(production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1'))<>3 then raise exception 'Closed history lost'; end if;
  begin perform production_phase_notices_action('10000000-0000-0000-0000-000000000001','j1','add','notice-phase','After closure','20000000-0000-0000-0000-000000000004'); raise exception 'Closed job changed';
  exception when raise_exception then if sqlerrm not like 'La commessa è chiusa%' then raise; end if; end;
end $$;
reset role;
rollback;
