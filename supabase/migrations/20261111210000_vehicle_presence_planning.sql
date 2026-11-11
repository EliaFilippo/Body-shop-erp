begin;

-- Presence affects the live planning input and must invalidate stale programs.
do $migration$
declare
  definition text := pg_get_functiondef('public.production_completion_input_hash(jsonb)'::regprocedure);
  anchor text := '''plannedEntryDate'',v->''plannedEntryDate''';
begin
  if position(anchor in definition) = 0 then raise exception 'Planning input signature changed'; end if;
  execute replace(definition, anchor, anchor || ',''presentInShop'',v->''presentInShop''');
end $migration$;

-- An independent phase uses the existing manual Start route. Leave the automatic
-- prerequisite gate on the normal route and keep the published phase and skill checks.
do $migration$
declare
  definition text := pg_get_functiondef('public.production_live_feed_before_cones(uuid)'::regprocedure);
  anchor text := $sql$where (ph->>'automaticAllowed')::boolean$sql$;
begin
  if position(anchor in definition) = 0 then raise exception 'Production feed signature changed'; end if;
  execute replace(definition, anchor, $sql$where (
   (task->>'id' like 'early-phase:%' and ph->>'id'=task->>'phaseId'
    and (allowed->(task->>'jobId')) ? (ph->>'id')
    and not coalesce((ph->>'remainingTimeUnknown')::boolean,false))
   or (task->>'id' not like 'early-phase:%' and (ph->>'automaticAllowed')::boolean))$sql$);
end $migration$;

notify pgrst, 'reload schema';
commit;
