-- 015: el centro decide si los buceadores ven el barco de cada salida
-- Por defecto el barco es interno (solo para el centro: capacidad y organización).
alter table public.boats add column if not exists show_to_divers boolean not null default false;

create or replace view public.published_trips with (security_invoker = true) as
 SELECT t.id,
    t.center_id,
    t.departs_at,
    t.num_dives,
    t.min_level,
    t.price_php,
    t.gear_rental_php,
    c.name AS center_name,
    CASE WHEN bo.show_to_divers THEN bo.name END AS boat_name,
    ARRAY( SELECT ds.name
           FROM trip_sites ts
             JOIN dive_sites ds ON ds.id = ts.site_id
          WHERE ts.trip_id = t.id
          ORDER BY ts."position") AS sites,
    app_available_seats(t.id) AS available_seats,
    c.area AS center_area,
    c.locality AS center_locality,
    c.lat AS center_lat,
    c.lng AS center_lng,
    trip_booked_seats(t.id) AS booked_seats,
    c.destination AS center_destination,
    c.province AS center_province
   FROM trips t
     JOIN centers c ON c.id = t.center_id
     JOIN boats bo ON bo.id = t.boat_id
  WHERE t.status = 'published'::trip_status;

alter view public.published_trips set (security_invoker = true);
