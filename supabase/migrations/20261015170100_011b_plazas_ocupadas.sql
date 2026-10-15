-- Plazas ya ocupadas (app + manuales) para mostrar "👥 N apuntados" en la lista de salidas
create or replace function public.trip_booked_seats(p_trip uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(b.seats), 0)::int from bookings b where b.trip_id = p_trip and holds_seat(b)
$$;
revoke execute on function public.trip_booked_seats(uuid) from public;
grant execute on function public.trip_booked_seats(uuid) to anon, authenticated;

create or replace view public.published_trips with (security_invoker = true) as
 select t.id,
    t.center_id,
    t.departs_at,
    t.num_dives,
    t.min_level,
    t.price_php,
    t.gear_rental_php,
    c.name as center_name,
    bo.name as boat_name,
    array(select ds.name
           from trip_sites ts
             join dive_sites ds on ds.id = ts.site_id
          where ts.trip_id = t.id
          order by ts."position") as sites,
    app_available_seats(t.id) as available_seats,
    c.area as center_area,
    c.locality as center_locality,
    c.lat as center_lat,
    c.lng as center_lng,
    trip_booked_seats(t.id) as booked_seats
   from trips t
     join centers c on c.id = t.center_id
     join boats bo on bo.id = t.boat_id
  where t.status = 'published'::trip_status;
