\set ON_ERROR_STOP on
\ir ../migrations/20261028072111_manual_unquoted_phases.sql
\ir ../migrations/20261028072111_manual_unquoted_phases.sql
begin;
insert into companies(id,name) values('70000000-0000-0000-0000-000000000007','Unquoted phases fixture');
insert into company_members(company_id,user_id,display_name,role) values
('70000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','Owner','owner'),
('70000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000002','A','production'),
('70000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000003','B','production');
insert into erp_snapshots(company_id,payload,updated_by) values('70000000-0000-0000-0000-000000000007',
'{"plannerSettings":{"operators":[{"id":"a","name":"A","active":true,"skillsConfigured":true,"skills":["Lattoneria"]},{"id":"b","name":"B","active":true}]},"estimates":[],"jobs":[
{"id":"extra-modern","plate":"EXTRA1","status":"Pianificata","workflowCycle":"elias-v1","taxableAmount":100,"lines":[],"phases":[{"id":"body","name":"Lattoneria","status":"Da fare"},{"id":"optional","name":"Lucidatura","status":"Completata","notRequired":true}]},
{"id":"extra-legacy","plate":"EXTRA2","status":"Pianificata","phases":[{"id":"body","name":"Lattoneria","status":"Da fare"}]},
{"id":"extra-empty","plate":"EXTRA3","status":"Pianificata","phases":[]}]}',
'00000000-0000-0000-0000-000000000001');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select production_bind_profile('70000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000002','a');
select production_bind_profile('70000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000003','b');
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '70000000-0000-0000-0000-000000000007',id,id,id,120,'[{"id":"a","name":"A","rate":20},{"id":"b","name":"B","rate":20}]',1,
'00000000-0000-0000-0000-000000000001'::uuid from unnest(array['extra-modern','extra-legacy','extra-empty']) id;
select set_config('test.unquoted_payload',(select payload::text from erp_snapshots where company_id='70000000-0000-0000-0000-000000000007'),true);
select set_config('test.unquoted_limits',(select jsonb_object_agg(job_id,phase_time_limits)::text from production_live_jobs where company_id='70000000-0000-0000-0000-000000000007'),true);
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$declare feed jsonb;begin
 feed:=production_live_feed('70000000-0000-0000-0000-000000000007');
 if (select count(*) from jsonb_array_elements(feed->'jobs') j,jsonb_array_elements(j->'phases') p where p->>'name'='Lucidatura')<>3 then raise exception 'Incomplete manual catalog';end if;
 if not exists(select 1 from jsonb_array_elements(feed->'jobs') j,jsonb_array_elements(j->'phases') p where j->>'jobId'='extra-modern' and p->>'id'='optional' and p->>'automaticAllowed'='false') then raise exception 'Extra phase granted automatic permission';end if;
 begin
  perform production_timer_action('70000000-0000-0000-0000-000000000007','extra-modern','start','optional');raise exception 'Automatic extra Start allowed';
 exception when others then if sqlerrm='Automatic extra Start allowed' then raise;end if;end;
end $$;
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-modern','optional');
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-modern','optional');
select production_timer_action('70000000-0000-0000-0000-000000000007','extra-modern','pause');
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-modern','optional');
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-legacy','manual-phase:polishing');
select production_timer_action('70000000-0000-0000-0000-000000000007','extra-legacy','finish');
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-empty','manual-phase:assembly');
do $$begin
 begin
  perform production_manual_start('70000000-0000-0000-0000-000000000007','extra-modern','manual-phase:made-up');raise exception 'Invented phase allowed';
 exception when raise_exception then if sqlerrm<>'Scegli una fase di lavorazione valida' then raise;end if;end;
end $$;
reset role;
-- No quote, snapshot, programmed work, price or budget changes; real work remains counted.
do $$begin
 if (select payload::text from erp_snapshots where company_id='70000000-0000-0000-0000-000000000007')<>current_setting('test.unquoted_payload') then raise exception 'Snapshot or quote rewritten';end if;
 if (select count(*) from production_live_segments where company_id='70000000-0000-0000-0000-000000000007' and ended_at is null)<>1 then raise exception 'Duplicate active timer';end if;
 if exists(select 1 from production_live_jobs where company_id='70000000-0000-0000-0000-000000000007' and (initial_budget<>120 or phase_time_limits is distinct from current_setting('test.unquoted_limits')::jsonb->job_id)) then raise exception 'Invented quote time/budget';end if;
 if exists(select 1 from production_phase_checks where company_id='70000000-0000-0000-0000-000000000007') then raise exception 'Automatic completion';end if;
end $$;
update production_live_segments set started_at=started_at-interval '2 minutes' where company_id='70000000-0000-0000-0000-000000000007';
do $$begin
 if not exists(select 1 from production_time_facts('70000000-0000-0000-0000-000000000007') where job_id='extra-legacy' and label='Lucidatura' and spent_seconds>=120 and assigned_seconds=0 and not completed) then raise exception 'Extra time missing from phase report';end if;
end $$;
-- Legacy jobs with no original phase still use all physical post stations.
update erp_snapshots set payload=jsonb_set(payload,'{jobs}',payload->'jobs'||(
 select jsonb_agg(jsonb_build_object('id','extra-station'||n,'status','Pianificata','phases','[]'::jsonb)) from generate_series(1,6)n))
where company_id='70000000-0000-0000-0000-000000000007';
insert into production_live_jobs(company_id,job_id,plate,number,initial_budget,operator_rates,source_revision,approved_by)
select '70000000-0000-0000-0000-000000000007','extra-station'||n,'EXTRA'||n,'EXTRA'||n,120,
'[{"id":"a","name":"A","rate":20},{"id":"b","name":"B","rate":20}]',1,'00000000-0000-0000-0000-000000000001'::uuid from generate_series(1,6)n;
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-station1','manual-phase:wash-exterior');
select production_timer_action('70000000-0000-0000-0000-000000000007','extra-station1','pause');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
do $$begin
 begin
  perform production_manual_start('70000000-0000-0000-0000-000000000007','extra-station2','manual-phase:wash-exterior');raise exception 'Extra wash capacity bypass';
 exception when raise_exception then if sqlerrm not like 'La sola postazione%' then raise;end if;end;
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_timer_action('70000000-0000-0000-0000-000000000007','extra-station1','finish');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-station2','manual-phase:wash-exterior');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-station3','manual-phase:painting');
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-station4','manual-phase:painting');
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-station5','manual-phase:painting');
do $$begin
 begin
  perform production_manual_start('70000000-0000-0000-0000-000000000007','extra-station6','manual-phase:painting');raise exception 'Extra paint capacity bypass';
 exception when raise_exception then if sqlerrm not like 'Le 3 postazioni%' then raise;end if;end;
end $$;
select production_timer_action('70000000-0000-0000-0000-000000000007','extra-station5','finish');
do $$begin
 begin
  perform production_manual_start('70000000-0000-0000-0000-000000000007','extra-station5','manual-phase:assembly');raise exception 'Extra drying bypass';
 exception when raise_exception then if sqlerrm<>'Attesa asciugatura prima di proseguire' then raise;end if;end;
end $$;
update production_live_segments set ended_at=ended_at-interval '61 minutes',started_at=started_at-interval '62 minutes'
where company_id='70000000-0000-0000-0000-000000000007' and job_id='extra-station5';
select production_manual_start('70000000-0000-0000-0000-000000000007','extra-station6','manual-phase:painting');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
set local role authenticated;
do $$begin
 begin
  perform production_manual_start('70000000-0000-0000-0000-000000000007','extra-modern','optional');raise exception 'Foreign Start allowed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
