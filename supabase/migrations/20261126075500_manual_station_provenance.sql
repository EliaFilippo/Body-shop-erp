begin;
do $migration$
declare
 definition text := pg_get_functiondef('public.production_effective_phases(uuid,jsonb)'::regprocedure);
 anchor text := $sql$max(started_at) filter(where manual_start) manual_start,$sql$;
 output_anchor text := $sql$'manualWorkTracked',manual_start is not null,$sql$;
begin
 if position(anchor in definition)=0 or position(output_anchor in definition)=0 then
  raise exception 'Unexpected production_effective_phases definition';
 end if;
 definition := replace(definition,anchor,$sql$max(started_at) filter(where manual_start) manual_start,
 bool_and(manual_start) manual_only_station_work,$sql$);
 execute replace(definition,output_anchor,$sql$'manualWorkTracked',manual_start is not null,
 'manualOnlyStationWork',coalesce(manual_only_station_work,false),$sql$);
end $migration$;
notify pgrst,'reload schema';
commit;
