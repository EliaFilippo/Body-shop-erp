-- The planner still reserves stations. An automatic tablet start does not
-- reject work based on the station reservation.
create or replace trigger paint_station_capacity_start
  before insert on public.production_live_segments
  for each row when (new.manual_start)
  execute function public.guard_paint_station_capacity();

create or replace trigger wash_station_capacity_start
  before insert on public.production_live_segments
  for each row when (new.manual_start)
  execute function public.guard_wash_station_capacity();
