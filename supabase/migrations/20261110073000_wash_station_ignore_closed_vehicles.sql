do $migration$
declare definition text; previous text;
begin
 previous := pg_get_functiondef('public.guard_wash_station_capacity()'::regprocedure);
 definition := replace(previous, $match$and p->>'name' in ('Lavaggio esterno','Lavaggio interni','Lavaggio')$match$, $replacement$and not exists (
   select 1 from jsonb_array_elements(coalesce(s.payload->'vehicles','[]')) v
   where v->>'id'=j->>'vehicleId'
     and (lower(coalesce(v->>'status','')) in ('consegnata','annullata','delivered','cancelled')
       or exists (select 1 from jsonb_array_elements(coalesce(s.payload->'plannerSettings'->'vehicleStatuses','[]')) status
         where status->>'id'=v->>'status' and status->>'semantic' in ('delivered','cancelled')))
  )
  and p->>'name' in ('Lavaggio esterno','Lavaggio interni','Lavaggio')$replacement$);
 if definition=previous then raise exception 'Condizione di occupazione lavaggio non trovata'; end if;
 execute definition;
end
$migration$;
