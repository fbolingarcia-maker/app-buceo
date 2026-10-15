-- 010: buscar salidas por zona y "cerca de mí"
-- La vista pública de salidas expone la zona y las coordenadas del centro.
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
    c.lng as center_lng
   from trips t
     join centers c on c.id = t.center_id
     join boats bo on bo.id = t.boat_id
  where t.status = 'published'::trip_status;

-- Centros demo: zona y coordenadas aproximadas para probar la búsqueda
update public.centers set locality = 'Alona Beach', lat = 9.5487, lng = 123.7745
 where name = 'Demo · Centro Alona' and lat is null;
update public.centers set locality = 'Danao', lat = 9.553, lng = 123.79
 where name = 'Demo · Centro Danao' and lat is null;
