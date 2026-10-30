begin;
-- Progress imported by office polling is already represented by canonical
-- segments/signatures. It must not generate a second replan on Start/Pause/Finish.
create or replace function public.production_completion_input_hash(p_payload jsonb)
returns text language sql immutable set search_path=public,pg_temp as $$
 select md5(jsonb_build_array(
 (select coalesce(jsonb_agg(jsonb_build_object('id',j->'id','vehicleId',j->'vehicleId','plate',j->'plate','number',j->'number',
 'closed',j->>'status' in ('Consegnata','Annullata'),'blocked',j->>'status'='In attesa',
 'priority',j->'priority','entryDate',j->'entryDate','createdAt',j->'createdAt','expectedDeliveryDate',j->'expectedDeliveryDate','agreedDeliveryDate',j->'agreedDeliveryDate',
 'blocks',j->'blocks','taxableAmount',j->'taxableAmount','lines',j->'lines',
 'phases',(select coalesce(jsonb_agg(jsonb_build_object('id',p->'id','name',p->'name','estimatedMinutes',p->'estimatedMinutes','sharedTimeKey',p->'sharedTimeKey','sharedTimeMinutes',p->'sharedTimeMinutes',
 'notRequired',p->'notRequired','blocked',p->>'status'='Bloccata','blockedReason',p->'blockedReason','requiredSkill',p->'requiredSkill','preferredOperatorId',p->'preferredOperatorId','supportOperatorId',p->'supportOperatorId','technicalWaitMinutes',p->'technicalWaitMinutes','technicalWaitBlocksPhaseNames',p->'technicalWaitBlocksPhaseNames',
 'officeAssignments',(select coalesce(jsonb_agg(a-'workedMinutes'),'[]') from jsonb_array_elements(coalesce(p->'operatorAssignments','[]')) a where coalesce(a->>'id','') not like 'tablet:%')) order by ord),'[]') from jsonb_array_elements(coalesce(j->'phases','[]')) with ordinality phases(p,ord))) order by j->>'id'),'[]') from jsonb_array_elements(coalesce(p_payload->'jobs','[]')) j),
 (select coalesce(jsonb_agg(jsonb_build_object('id',v->'id','plate',v->'plate','priority',v->'priority','requestedDeliveryDate',v->'requestedDeliveryDate','manualPlanningDate',v->'manualPlanningDate','plannedEntryDate',v->'plannedEntryDate','estimatedHours',v->'estimatedHours','expectedRevenue',v->'expectedRevenue','expectedMargin',v->'expectedMargin','partsStatus',v->'partsStatus','blockReason',v->'blockReason','coneNumber',v->'coneNumber','createdAt',v->'createdAt',
 'terminal',lower(coalesce(v->>'status','')) in ('consegnata','annullata','delivered','cancelled') or exists(select 1 from jsonb_array_elements(coalesce(p_payload->'plannerSettings'->'vehicleStatuses','[]')) status where status->>'id'=v->>'status' and status->>'semantic' in ('delivered','cancelled'))) order by v->>'id'),'[]') from jsonb_array_elements(coalesce(p_payload->'vehicles','[]')) v),
 p_payload->'plannerSettings')::text)
$$;
revoke all on function public.production_completion_input_hash(jsonb) from public,anon,authenticated,service_role;
-- A customer-only save is safe during a derived computation: compare the inputs
-- and real-work watermark, never overwrite the office archive to adopt a plan.
do $$declare body text;begin
 body:=pg_get_functiondef('public.production_completion_commit(uuid,uuid,bigint,bigint,jsonb)'::regprocedure);
 body:=replace(body,'s.revision<>p_revision or ','production_completion_input_hash(s.payload) is distinct from q.input_hash or ');
 execute body;
end $$;
do $$declare item record;begin
 for item in select company_id from production_completion_queue where plan is not null loop
  perform production_completion_enqueue(item.company_id);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
