\set ON_ERROR_STOP on
\ir ../migrations/20261004_work_cycle.sql
-- Disposable fixtures: roll back changes to preserve concurrency tests.
begin;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||
 '[{"id":"j-cycle","status":"In lavorazione","workflowCycle":"elias-v1","phases":[{"id":"paint","name":"Verniciatura","requiredSkill":"Verniciatura","status":"Da fare"},{"id":"unmask","name":"Scartatura","requiredSkill":"Scartatura","status":"Da fare"},{"id":"delivery","name":"Consegna","status":"Da fare"}]}]');
update erp_snapshots set payload=jsonb_set(jsonb_set(payload,'{plannerSettings,operators,0,skillsConfigured}','true'),'{plannerSettings,operators,0,skills}','["Verniciatura"]');
update company_members set role='office' where user_id='00000000-0000-0000-0000-000000000002';
select production_prepare_job('10000000-0000-0000-0000-000000000001','j-cycle',10,120,'[{"id":"a","name":"A","rate":50},{"id":"b","name":"B","rate":60}]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','j-cycle','start','unmask');raise exception 'Phase order bypassed';
 exception when raise_exception then if sqlerrm not like 'Completa le fasi%' then raise; end if;end;
end $$;
select production_timer_action('10000000-0000-0000-0000-000000000001','j-cycle','start','paint');
select production_complete_phase('10000000-0000-0000-0000-000000000001','j-cycle','paint');
do $$begin
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','j-cycle','start','unmask');raise exception 'Drying wait bypassed';
 exception when raise_exception then if sqlerrm not like 'Attesa asciugatura%' then raise; end if;end;
end $$;
update production_phase_checks set checked_at=clock_timestamp()-interval '61 minutes' where job_id='j-cycle' and phase_id='paint';
do $$begin
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','j-cycle','start','unmask');raise exception 'Disabled duty allowed';
 exception when insufficient_privilege then if sqlerrm not like 'Mansione non abilitata%' then raise; end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update erp_snapshots set payload=jsonb_set(payload,'{plannerSettings,operators,0,skills}','["Verniciatura","Scartatura"]');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('10000000-0000-0000-0000-000000000001','j-cycle','start','unmask');
select production_complete_phase('10000000-0000-0000-0000-000000000001','j-cycle','unmask');
do $$begin
 begin perform production_timer_action('10000000-0000-0000-0000-000000000001','j-cycle','start','delivery');raise exception 'Delivery labor allowed';
 exception when raise_exception then if sqlerrm not like 'La consegna viene%' then raise;end if;end;
 if (select sum(extract(epoch from(ended_at-started_at))) from production_live_segments where job_id='j-cycle')>60 then raise exception 'Drying counted as worked hours';end if;
end $$;
rollback;
