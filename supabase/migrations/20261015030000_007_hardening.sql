-- 007 · Seguridad, meteo, demo y alta de centros (aplicada el 2026-10-15)

-- 1) Las acciones solo se pueden llamar con sesión iniciada
revoke execute on function public.book_trip(uuid, integer, boolean, boolean) from public, anon;
revoke execute on function public.add_manual_booking(uuid, text, integer, boolean, public.booking_source) from public, anon;
revoke execute on function public.cancel_trip_weather(uuid) from public, anon;
revoke execute on function public.cancel_my_booking(uuid) from public, anon;
revoke execute on function public.confirm_payment_demo(uuid) from public, anon;
revoke execute on function public.register_center(text, text) from public, anon;
revoke execute on function public.verify_certification(uuid, uuid) from public, anon;
grant execute on function public.book_trip(uuid, integer, boolean, boolean) to authenticated;
grant execute on function public.add_manual_booking(uuid, text, integer, boolean, public.booking_source) to authenticated;
grant execute on function public.cancel_trip_weather(uuid) to authenticated;
grant execute on function public.cancel_my_booking(uuid) to authenticated;
grant execute on function public.confirm_payment_demo(uuid) to authenticated;
grant execute on function public.register_center(text, text) to authenticated;
grant execute on function public.verify_certification(uuid, uuid) to authenticated;
-- Nota: is_staff, my_diver_id, trip_center, staff_sees_diver, has_booking_on y app_available_seats
-- siguen ejecutables por anon porque las usan las políticas RLS y la vista published_trips
-- (para anon devuelven false/null). El aviso del linter sobre ellas es esperado.

-- 2) Cancelación por meteo también si el staff cambia el estado de la salida directamente
create or replace function public.trips_on_weather_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled_weather' and old.status is distinct from 'cancelled_weather' then
    update bookings
       set status = 'cancelled_by_center',
           refund_php = case when status = 'confirmed' then amount_php else 0 end,
           commission_php = 0,
           cancelled_at = now()
     where trip_id = new.id and status in ('pending_payment', 'confirmed');
  end if;
  return new;
end $$;
revoke execute on function public.trips_on_weather_cancel() from public, anon, authenticated;
create or replace trigger trips_on_weather_cancel after update of status on public.trips
  for each row execute function public.trips_on_weather_cancel();

-- 3) Salidas de demo: siempre hay salidas los próximos 7 días (cron diario 00:05 Manila)
create or replace function public.refresh_demo_trips() returns integer
language plpgsql security definer set search_path = public as $$
declare c1 uuid; c2 uuid; b1 uuid; b2 uuid; b3 uuid; n integer;
begin
  select id into c1 from centers where name = 'Demo · Centro Alona';
  select id into c2 from centers where name = 'Demo · Centro Danao';
  if c1 is null or c2 is null then return 0; end if;
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
  get diagnostics n = row_count;
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
  return n;
end $$;
revoke execute on function public.refresh_demo_trips() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('refresh-demo-trips', '5 16 * * *', 'select public.refresh_demo_trips()');
select public.refresh_demo_trips();

-- 4) Alta de centro: si el centro ya está en el directorio y nadie lo gestiona, se reclama su ficha
create or replace function public.register_center(p_name text, p_phone text) returns centers
language plpgsql security definer set search_path = public as $$
declare c centers;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: inicia sesión'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NO_NAME: indica el nombre del centro'; end if;
  if exists (select 1 from center_staff where user_id = auth.uid()) then
    raise exception 'BAD_STATE: ya gestionas un centro'; end if;
  select * into c from centers
   where lower(name) = lower(trim(p_name)) and area = 'Panglao'
     and not exists (select 1 from center_staff s where s.center_id = centers.id)
   limit 1 for update;
  if found then
    update centers set listing_status = 'socio', phone = coalesce(nullif(trim(p_phone), ''), phone)
     where id = c.id returning * into c;
  elsif exists (select 1 from centers where lower(name) = lower(trim(p_name)) and area = 'Panglao') then
    raise exception 'BAD_STATE: ese centro ya tiene responsable. Pide acceso a su dueño';
  else
    insert into centers (name, phone, listing_status) values (trim(p_name), nullif(trim(p_phone), ''), 'socio') returning * into c;
  end if;
  insert into center_staff (center_id, user_id, role) values (c.id, auth.uid(), 'owner');
  return c;
end $$;
