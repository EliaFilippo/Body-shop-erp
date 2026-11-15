begin;

-- Keep the phase selected by the office visible in the tablet program.
-- Readiness still comes from the real phase and the existing automatic gate.
do $migration$
declare
  definition text := pg_get_functiondef('public.production_live_feed_before_cones(uuid)'::regprocedure);
  anchor text := $sql$if not(open_jobs ? (task->>'jobId')) then continue;end if;$sql$;
  program_anchor text := $sql$for task in select t from jsonb_array_elements(coalesce(snapshot->'operatorPrograms','[]')) p,$sql$;
  dedup_anchor text := $sql$key:=(task->>'jobId')||':'||(chosen->>'id');if key=any(seen) then continue;end if;$sql$;
begin
  if position('office-manual:%' in definition) > 0 then return; end if;
  if position(anchor in definition) = 0 or position(program_anchor in definition) = 0
    or position(dedup_anchor in definition) = 0 or position('key text;' in definition) = 0 then
    raise exception 'Production program feed anchor not found';
  end if;
  definition := replace(definition, 'key text;', 'key text; manual_keys text[];');
  definition := replace(definition, program_anchor, $sql$
 select coalesce(array_agg((t->>'jobId')||':'||(t->>'phaseId')),'{}'::text[]) into manual_keys
 from jsonb_array_elements(coalesce(snapshot->'operatorPrograms','[]')) p,
  jsonb_array_elements(coalesce(p->'tasks','[]')) t
 where p->>'operatorId'=profile and t->>'id' like 'office-manual:%';
 $sql$ || program_anchor);
  definition := replace(definition, dedup_anchor, $sql$key:=(task->>'jobId')||':'||(chosen->>'id');
  if key=any(seen) or key=any(manual_keys) then continue;end if;$sql$);
  execute replace(definition, anchor, anchor || $sql$
  if task->>'id' like 'office-manual:%' then
   select ph into chosen from jsonb_array_elements(coalesce(card->'phases','[]')) ph
    where ph->>'id'=task->>'phaseId';
   if chosen->>'status'='Completata' then continue; end if;
   key:=(task->>'jobId')||':'||(task->>'phaseId');
   if key=any(seen) then continue; end if;
   seen:=array_append(seen,key);
   program:=program||jsonb_build_array(jsonb_build_object(
    'id',task->>'id','jobId',task->>'jobId','plate',coalesce(card->>'plate',task->>'plate'),
    'phaseId',task->>'phaseId','phaseName',task->>'phaseName','startAt',task->>'startAt','endAt',task->>'endAt',
    'panels',coalesce(task->'panelNames','[]'),
    'ready',coalesce((chosen->>'automaticAllowed')::boolean
     and chosen->>'status' not in ('Completata','Bloccata')
     and not coalesce((chosen->>'notRequired')::boolean,false),false)));
   continue;
  end if;$sql$);
end $migration$;

notify pgrst, 'reload schema';
commit;
