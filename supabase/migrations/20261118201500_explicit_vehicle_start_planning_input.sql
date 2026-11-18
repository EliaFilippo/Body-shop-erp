begin;
-- Include explicit start dates in the derived-plan invalidation key.
do $migration$
declare body text;
begin
 body := pg_get_functiondef('public.production_completion_input_hash(jsonb)'::regprocedure);
 if position('''scheduledStartDate''' in body) = 0 then
  if position('''plannedEntryDate'',v->''plannedEntryDate''' in body) = 0 then
   raise exception 'Expected planner input signature not found';
  end if;
  body := replace(body, '''plannedEntryDate'',v->''plannedEntryDate''', '''plannedEntryDate'',v->''plannedEntryDate'',''scheduledStartDate'',v->''scheduledStartDate''');
  execute body;
 end if;
end $migration$;
commit;