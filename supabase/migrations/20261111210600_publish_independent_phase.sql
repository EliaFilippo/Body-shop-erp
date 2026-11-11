begin;

-- The feed labels normal sequence dependencies as blocked. Publish an exact
-- planner-selected independent phase through the manual route only.
do $migration$
declare
  definition text := pg_get_functiondef('public.production_live_feed_before_cones(uuid)'::regprocedure);
  anchor text := $sql$and ph->>'status' not in ('Completata','Bloccata')$sql$;
begin
  if position(anchor in definition) = 0 then raise exception 'Production feed phase gate changed'; end if;
  execute replace(definition, anchor, $sql$and (
    ph->>'status' not in ('Completata','Bloccata') or (
      task->>'id' like 'early-phase:%' and ph->>'id'=task->>'phaseId'
      and ph->>'status'='Bloccata'
      and ph->>'blockedReason'='Completa le fasi precedenti prima di iniziare questa fase'
    )
  )$sql$);
end $migration$;

notify pgrst, 'reload schema';
commit;
