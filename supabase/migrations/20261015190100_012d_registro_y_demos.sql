-- 012d: alta de centros de toda Filipinas y salidas demo en varios destinos

-- Reclamar una ficha del directorio ya no depende de Panglao
create or replace function public.register_center(p_name text, p_phone text)
returns centers
language plpgsql
security definer
set search_path = public
as $$
declare c centers;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: inicia sesión'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NO_NAME: indica el nombre del centro'; end if;
  if exists (select 1 from center_staff where user_id = auth.uid()) then
    raise exception 'BAD_STATE: ya gestionas un centro'; end if;
  select * into c from centers
   where lower(name) = lower(trim(p_name)) and name not like 'Demo ·%'
     and not exists (select 1 from center_staff s where s.center_id = centers.id)
   limit 1 for update;
  if found then
    update centers set listing_status = 'socio', phone = coalesce(nullif(trim(p_phone), ''), phone)
     where id = c.id returning * into c;
  elsif exists (select 1 from centers where lower(name) = lower(trim(p_name))) then
    raise exception 'BAD_STATE: ese centro ya tiene responsable. Pide acceso a su dueño';
  else
    insert into centers (name, phone, listing_status) values (trim(p_name), nullif(trim(p_phone), ''), 'socio') returning * into c;
  end if;
  insert into center_staff (center_id, user_id, role) values (c.id, auth.uid(), 'owner');
  update divers set account_type = 'center' where user_id = auth.uid();
  return c;
end $$;

-- Centros demo en otros destinos (para probar la búsqueda por zona)
insert into public.centers (name, area, province, destination, locality, lat, lng, location_precision, listing_status)
select 'Demo · ' || d.name, d.name, d.province, d.name, d.name, d.lat, d.lng, 'zona', 'directorio'
from public.destinations d
where d.name in ('Moalboal', 'Malapascua', 'Anilao', 'Puerto Galera', 'Coron', 'Dauin', 'El Nido', 'Boracay')
  and not exists (select 1 from public.centers c where c.name = 'Demo · ' || d.name);

insert into public.boats (center_id, name, capacity)
select c.id, 'Banca ' || c.destination, 12
from public.centers c
where c.name like 'Demo · %' and c.destination not in ('Panglao')
  and not exists (select 1 from public.boats b where b.center_id = c.id);

update public.centers set destination = 'Panglao', province = 'Bohol' where name in ('Demo · Centro Alona', 'Demo · Centro Danao');

create or replace function public.refresh_demo_trips()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare c1 uuid; c2 uuid; b1 uuid; b2 uuid; b3 uuid; n integer; m integer;
begin
  -- Panglao (como antes)
  select id into c1 from centers where name = 'Demo · Centro Alona';
  select id into c2 from centers where name = 'Demo · Centro Danao';
  if c1 is not null and c2 is not null then
    select id into b1 from boats where center_id = c1 and name = 'Banca grande';
    select id into b2 from boats where center_id = c1 and name = 'Banca pequeña';
    select id into b3 from boats where center_id = c2 and name = 'Banca Danao';
    insert into trips (center_id, boat_id, departs_at, num_dives, min_level, price_php, gear_rental_php, guides, divers_per_guide, blocked_seats, status)
    select x.c, x.b, ((d::date + x.hr) at time zone 'Asia/Manila'), x.nd, x.lvl::cert_level, x.price, 800, x.g, 4, x.blk, 'published'
    from generate_series((now() at time zone 'Asia/Manila')::date + 1, (now() at time zone 'Asia/Manila')::date + 7, interval '1 day') d,
         (values (c1, b1, time '07:30', 3, 'open_water', 5800, 3, 2),
                 (c1, b2, time '13:30', 2, 'open_water', 4500, 2, 1),
                 (c2, b3, time '08:00', 3, 'advanced',   6200, 2, 2)) as x(c, b, hr, nd, lvl, price, g, blk)
    where not exists (select 1 from trips t where t.boat_id = x.b
                        and t.departs_at = ((d::date + x.hr) at time zone 'Asia/Manila'));
    insert into trip_sites (trip_id, site_id, position)
    select t.id, s.id, v.pos
    from trips t
    join (values (7, 'Balicasag – Black Forest', 1), (7, 'Balicasag – Turtle Point', 2), (7, 'Pamilacan', 3),
                 (13, 'Napaling', 1), (13, 'Doljo Point', 2),
                 (8, 'Balicasag – Cathedral Wall', 1), (8, 'Balicasag – Rico''s Wall', 2), (8, 'Balicasag – Divers Heaven', 3)) as v(hr, site, pos)
      on extract(hour from t.departs_at at time zone 'Asia/Manila') = v.hr
    join dive_sites s on s.name = v.site
    where t.center_id in (c1, c2) and t.departs_at > now()
      and not exists (select 1 from trip_sites ts where ts.trip_id = t.id);
  end if;
  get diagnostics n = row_count;

  -- Resto de destinos demo: una salida diaria de 2 inmersiones a las 08:00
  insert into trips (center_id, boat_id, departs_at, num_dives, min_level, price_php, gear_rental_php, guides, divers_per_guide, blocked_seats, status)
  select c.id, b.id, ((d::date + time '08:00') at time zone 'Asia/Manila'), 2, 'open_water', 4200, 700, 2, 4, 2, 'published'
  from centers c join boats b on b.center_id = c.id,
       generate_series((now() at time zone 'Asia/Manila')::date + 1, (now() at time zone 'Asia/Manila')::date + 7, interval '1 day') d
  where c.name like 'Demo · %' and c.destination <> 'Panglao'
    and not exists (select 1 from trips t where t.boat_id = b.id
                      and t.departs_at = ((d::date + time '08:00') at time zone 'Asia/Manila'));
  get diagnostics m = row_count;

  -- Puntos: los dos primeros (por nombre) de la zona del destino, rotando por día
  insert into trip_sites (trip_id, site_id, position)
  select t.id, s.id, s.pos
  from trips t
  join centers c on c.id = t.center_id
  cross join lateral (
    select z.id, row_number() over (order by z.rk) as pos
    from (
      select ds.id, (row_number() over (order by ds.name) + extract(doy from t.departs_at)::int) % greatest(1, count(*) over ()) as rk
      from dive_sites ds
      where ds.area = c.destination
         or (c.destination = 'Dauin' and ds.area = 'Apo Island')
         or (c.destination = 'Puerto Galera' and ds.area = 'Verde Island')
    ) z
    order by z.rk
    limit 2
  ) s
  where c.name like 'Demo · %' and c.destination <> 'Panglao' and t.departs_at > now()
    and not exists (select 1 from trip_sites ts where ts.trip_id = t.id);

  return n + m;
end $$;

select public.refresh_demo_trips();
