begin;
-- pg_net's request queue contains internal authentication headers. Only the
-- extension owners/definer functions need direct access, never browser roles.
-- Managed extension ownership can retain defaults; signed_completion_dispatch
-- therefore authenticates requests without placing a durable token in this table.
revoke all on table net.http_request_queue,net._http_response from public,anon,authenticated;
commit;
