begin;
-- Leases coalesce calculations. Do not throttle the notification after a plan
-- has already committed: a second completion must not wait for the watchdog.
do $$declare body text;begin
 body:=pg_get_functiondef('public.production_completion_dispatch(uuid)'::regprocedure);
 body:=replace(body,' and coalesce(last_dispatch_at,''-infinity'')<clock_timestamp()-interval ''3 seconds''','');
 execute body;
end $$;
commit;
