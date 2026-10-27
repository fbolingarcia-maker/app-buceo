-- 032: valoraciones entre buddies (opcionales).
--
-- Reglas (ver claude/valoraciones-buddies-y-ux.md):
--   * Cada buceador decide si le pueden valorar: divers.buddy_ratings_enabled (apagado por defecto).
--   * Solo valora quien buceó contigo: los dos con check-in en la misma salida, desde la salida hasta 14 días después.
--   * Cinco criterios de 1 a 5 (o «No lo vi» = null) y «¿Volverías a bucear con…?» opcional.
--   * Anónimo: nadie lee la tabla; solo hay medias. Una valoración cuenta cuando los dos se han valorado
--     en esa salida o cuando se cierra el plazo. La media se muestra a partir de 3 valoraciones.
--   * Si se elimina la cuenta (buceador anonimizado), se borran las valoraciones recibidas.

alter table public.divers add column if not exists buddy_ratings_enabled boolean not null default false;

create table if not exists public.buddy_ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  rater_id uuid not null references public.divers(id) on delete cascade,
  rated_id uuid not null references public.divers(id) on delete cascade,
  buoyancy smallint check (buoyancy between 1 and 5),
  air smallint check (air between 1 and 5),
  awareness smallint check (awareness between 1 and 5),
  safety smallint check (safety between 1 and 5),
  reef smallint check (reef between 1 and 5),
  dive_again boolean,
  created_at timestamptz not null default now(),
  unique (trip_id, rater_id, rated_id),
  check (rater_id <> rated_id),
  check (coalesce(buoyancy, air, awareness, safety, reef) is not null)
);
create index if not exists buddy_ratings_rated_idx on public.buddy_ratings (rated_id);
create index if not exists buddy_ratings_rater_idx on public.buddy_ratings (rater_id);

alter table public.buddy_ratings enable row level security;
revoke all on public.buddy_ratings from public, anon, authenticated;
grant select on public.buddy_ratings to authenticated;
-- Cada uno solo ve las que ha dado él (las recibidas solo como media, por RPC)
create policy buddy_ratings_own on public.buddy_ratings for select to authenticated
  using (rater_id = (select public.my_diver_id()));
create policy mfa_required on public.buddy_ratings as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Una valoración cuenta si es mutua en esa salida o si ya se cerró el plazo (14 días)
create or replace function private.buddy_revealed(p_trip uuid, p_rater uuid, p_rated uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select t.departs_at + interval '14 days' from public.trips t where t.id = p_trip) < now()
      or exists (select 1 from public.buddy_ratings x
                  where x.trip_id = p_trip and x.rater_id = p_rated and x.rated_id = p_rater)
$$;
revoke all on function private.buddy_revealed(uuid, uuid, uuid) from public, anon, authenticated;

-- Resumen de un buceador con las valoraciones que ya cuentan
create or replace function private.buddy_stats(p_diver uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (select * from public.buddy_ratings b where b.rated_id = p_diver),
  shown as (select * from r where private.buddy_revealed(r.trip_id, r.rater_id, r.rated_id)),
  vals as (select v from shown, unnest(array[buoyancy, air, awareness, safety, reef]) v where v is not null)
  select jsonb_build_object(
    'count', (select count(*) from shown),
    'raters', (select count(distinct rater_id) from shown),
    'overall', (select round(avg(v), 2) from vals),
    'scores', jsonb_strip_nulls(jsonb_build_object(
      'buoyancy', (select round(avg(buoyancy), 2) from shown),
      'air', (select round(avg(air), 2) from shown),
      'awareness', (select round(avg(awareness), 2) from shown),
      'safety', (select round(avg(safety), 2) from shown),
      'reef', (select round(avg(reef), 2) from shown))),
    'dive_again', (select round(avg(case when dive_again then 1 else 0 end), 2) from shown where dive_again is not null),
    'pending_reveal', (select count(*) from r) - (select count(*) from shown))
$$;
revoke all on function private.buddy_stats(uuid) from public, anon, authenticated;

-- Lo que ven los demás (en «¿Quién va?»): nada si no lo tiene activado o tiene menos de 3
create or replace function private.buddy_public(p_diver uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb;
begin
  if not coalesce((select d.buddy_ratings_enabled from public.divers d where d.id = p_diver), false) then return null; end if;
  s := private.buddy_stats(p_diver);
  if (s->>'count')::int < 3 then return null; end if;
  return jsonb_build_object('count', s->'count', 'score', s->'overall', 'raters', s->'raters',
                            'scores', s->'scores', 'dive_again', s->'dive_again');
end $$;
revoke all on function private.buddy_public(uuid) from public, anon, authenticated;

-- ¿Estuvo a bordo? (reserva no cancelada con check-in)
create or replace function private.on_board(p_trip uuid, p_diver uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b where b.trip_id = p_trip and b.diver_id = p_diver
                   and b.checked_in_at is not null and b.status = 'confirmed')
$$;
revoke all on function private.on_board(uuid, uuid) from public, anon, authenticated;

-- Compañeros que puedo valorar en una salida
create or replace function public.buddy_rating_targets(p_trip uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.my_diver_id();
  dep timestamptz;
  cname text;
begin
  if not public.mfa_ok() then raise exception 'MFA_REQUIRED: introduce el código de verificación en dos pasos'; end if;
  if me is null then raise exception 'FORBIDDEN: inicia sesión para valorar'; end if;
  select t.departs_at, c.name into dep, cname from public.trips t join public.centers c on c.id = t.center_id where t.id = p_trip;
  if dep is null then raise exception 'NOT_FOUND: no encontramos esta salida'; end if;
  if not private.on_board(p_trip, me) then
    raise exception 'FORBIDDEN: solo puedes valorar a compañeros de salidas en las que hiciste check-in';
  end if;
  return jsonb_build_object(
    'trip_id', p_trip, 'departs_at', dep, 'center_name', cname, 'closes_at', dep + interval '14 days',
    'divers', coalesce((
      select jsonb_agg(x order by x->>'name') from (
        select jsonb_build_object(
          'diver_id', d.id,
          'name', trim(split_part(coalesce(nullif(trim(d.full_name), ''), 'Buceador'), ' ', 1)
                  || case when position(' ' in trim(coalesce(d.full_name, ''))) > 0
                          then ' ' || left(regexp_replace(trim(d.full_name), '^.*\s', ''), 1) || '.' else '' end),
          'level', (select c.level::text from public.certifications c where c.diver_id = d.id order by c.level desc limit 1),
          'dives', coalesce(d.logged_dives, 0) + (select count(*) from public.dive_logs g where g.diver_id = d.id)::int,
          'rated', exists (select 1 from public.buddy_ratings r where r.trip_id = p_trip and r.rater_id = me and r.rated_id = d.id)
        ) x
        from public.divers d
        where now() between dep and dep + interval '14 days'
          and d.id <> me and d.user_id is not null and d.buddy_ratings_enabled
          and private.on_board(p_trip, d.id)
      ) s), '[]'::jsonb));
end $$;

-- Valorar a un compañero
create or replace function public.rate_buddy(p_trip uuid, p_diver uuid, p_scores jsonb, p_dive_again boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.my_diver_id();
  dep timestamptz;
  k text;
  v int;
  s jsonb := coalesce(p_scores, '{}'::jsonb);
begin
  if not public.mfa_ok() then raise exception 'MFA_REQUIRED: introduce el código de verificación en dos pasos'; end if;
  if me is null then raise exception 'FORBIDDEN: inicia sesión para valorar'; end if;
  if p_diver = me then raise exception 'FORBIDDEN: no puedes valorarte a ti mismo'; end if;
  select t.departs_at into dep from public.trips t where t.id = p_trip;
  if dep is null then raise exception 'NOT_FOUND: no encontramos esta salida'; end if;
  if now() < dep then raise exception 'TOO_EARLY: podrás valorar cuando haya salido el barco'; end if;
  if now() > dep + interval '14 days' then raise exception 'CLOSED: el plazo para valorar esta salida terminó'; end if;
  if not private.on_board(p_trip, me) or not private.on_board(p_trip, p_diver) then
    raise exception 'FORBIDDEN: solo puedes valorar a quien estuvo a bordo contigo';
  end if;
  if not exists (select 1 from public.divers d where d.id = p_diver and d.buddy_ratings_enabled and d.user_id is not null) then
    raise exception 'FORBIDDEN: este buceador no tiene activadas las valoraciones';
  end if;
  for k in select jsonb_object_keys(s) loop
    if k not in ('buoyancy', 'air', 'awareness', 'safety', 'reef') then raise exception 'INVALID: criterio desconocido'; end if;
    begin v := (s->>k)::int; exception when others then raise exception 'INVALID: las notas van del 1 al 5'; end;
    if v is null or v not between 1 and 5 then raise exception 'INVALID: las notas van del 1 al 5'; end if;
  end loop;
  if s = '{}'::jsonb then raise exception 'INVALID: puntúa al menos un criterio'; end if;
  insert into public.buddy_ratings (trip_id, rater_id, rated_id, buoyancy, air, awareness, safety, reef, dive_again)
  values (p_trip, me, p_diver, (s->>'buoyancy')::int, (s->>'air')::int, (s->>'awareness')::int,
          (s->>'safety')::int, (s->>'reef')::int, p_dive_again)
  on conflict (trip_id, rater_id, rated_id) do nothing;
  if not found then raise exception 'ALREADY_RATED: ya valoraste a este buddy en esta salida'; end if;
end $$;

-- Mi resumen (en el Perfil)
create or replace function public.my_buddy_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.my_diver_id();
  s jsonb;
begin
  if not public.mfa_ok() then raise exception 'MFA_REQUIRED: introduce el código de verificación en dos pasos'; end if;
  if me is null then return jsonb_build_object('count', 0); end if;
  s := private.buddy_stats(me);
  if (s->>'count')::int < 3 then
    return jsonb_build_object('count', s->'count', 'pending_reveal', s->'pending_reveal');
  end if;
  return s;
end $$;

-- Salidas recientes con compañeros por valorar (aviso en Reservas y Bitácora)
create or replace function public.my_pending_buddy_ratings() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select public.my_diver_id() as id),
  mine as (
    select t.id as trip_id, t.departs_at, c.name as center_name, t.departs_at + interval '14 days' as closes_at
      from public.bookings b join public.trips t on t.id = b.trip_id join public.centers c on c.id = t.center_id, me
     where public.mfa_ok() and b.diver_id = me.id and b.checked_in_at is not null and b.status = 'confirmed'
       and now() between t.departs_at and t.departs_at + interval '14 days'),
  p as (
    select m.*, (select count(distinct d.id) from public.bookings b2 join public.divers d on d.id = b2.diver_id, me
                  where b2.trip_id = m.trip_id and b2.checked_in_at is not null and b2.status = 'confirmed'
                    and d.id <> me.id and d.user_id is not null and d.buddy_ratings_enabled
                    and not exists (select 1 from public.buddy_ratings r
                                     where r.trip_id = m.trip_id and r.rater_id = me.id and r.rated_id = d.id))::int as pending
      from mine m)
  select coalesce(jsonb_agg(to_jsonb(p) order by p.departs_at desc), '[]'::jsonb) from p where p.pending > 0
$$;

revoke execute on function public.buddy_rating_targets(uuid) from public, anon;
revoke execute on function public.rate_buddy(uuid, uuid, jsonb, boolean) from public, anon;
revoke execute on function public.my_buddy_summary() from public, anon;
revoke execute on function public.my_pending_buddy_ratings() from public, anon;
grant execute on function public.buddy_rating_targets(uuid) to authenticated;
grant execute on function public.rate_buddy(uuid, uuid, jsonb, boolean) to authenticated;
grant execute on function public.my_buddy_summary() to authenticated;
grant execute on function public.my_pending_buddy_ratings() to authenticated;

-- Al eliminar la cuenta (buceador anonimizado): fuera las valoraciones recibidas y los datos del perfil de buceo
create or replace function private.divers_on_anonymize() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is not null and new.user_id is null then
    new.buddy_ratings_enabled := false;
    new.wetsuit_size := null; new.bcd_size := null; new.fin_size := null;
    new.last_dive_date := null; new.nitrox := false;
    new.medical_done_at := null; new.medical_result := null;
    delete from public.buddy_ratings where rated_id = new.id;
  end if;
  return new;
end $$;
revoke all on function private.divers_on_anonymize() from public, anon, authenticated;
create or replace trigger divers_on_anonymize before update of user_id on public.divers
  for each row execute function private.divers_on_anonymize();

-- «¿Quién va?»: añade la media como buddy (solo si la tiene activada y con 3 o más valoraciones)
create or replace function public.trip_divers(p_trip uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with live as (
    select b.*
      from bookings b
      join trips t on t.id = b.trip_id
     where b.trip_id = p_trip
       and t.status in ('published', 'completed')
       and holds_seat(b)
  ),
  shown as (
    select l.diver_id, sum(l.seats)::int as seats
      from live l
      join divers d on d.id = l.diver_id
     where auth.uid() is not null
       and d.show_on_trips
     group by l.diver_id
  ),
  info as (
    select
      d.id = (select id from divers where user_id = auth.uid()) as is_me,
      trim(split_part(coalesce(nullif(trim(d.full_name), ''), 'Buceador'), ' ', 1)
        || case when position(' ' in trim(coalesce(d.full_name, ''))) > 0
                then ' ' || left(regexp_replace(trim(d.full_name), '^.*\s', ''), 1) || '.' else '' end) as name,
      (select c.level::text from certifications c where c.diver_id = d.id
        order by c.level desc, c.verified_at nulls last limit 1) as level,
      exists (select 1 from certifications c where c.diver_id = d.id and c.verified_at is not null) as verified,
      coalesce(d.logged_dives, 0) + (select count(*) from dive_logs g where g.diver_id = d.id)::int as dives,
      coalesce(d.languages, '{}') as languages,
      d.country,
      d.bio,
      d.seeks_buddy,
      (select g.site_name from dive_logs g where g.diver_id = d.id and g.site_name is not null
        group by g.site_name order by count(*) desc, max(g.dive_date) desc limit 1) as fav_site,
      private.buddy_public(d.id) as buddy,
      s.seats
    from shown s
    join divers d on d.id = s.diver_id
  )
  select jsonb_build_object(
    'divers', coalesce((select jsonb_agg(to_jsonb(i) order by i.is_me desc, i.dives desc) from info i), '[]'::jsonb),
    'others', coalesce((select sum(seats) from live), 0) - coalesce((select sum(seats) from shown), 0)
  )
$function$;
