begin;
-- Automatic starts already bypass these guards; manual starts must do so too.
-- Planner capacity is separate from these insert-time checks.
drop trigger if exists paint_station_capacity_start on public.production_live_segments;
drop trigger if exists wash_station_capacity_start on public.production_live_segments;
commit;
