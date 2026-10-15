-- 011: "¿Quién va?" — ver qué buceadores ya han reservado una salida
-- Perfil público corto del buceador (opcional) y si quiere aparecer en las salidas.
alter table public.divers
  add column if not exists country text check (char_length(country) <= 60),
  add column if not exists bio text check (char_length(bio) <= 160),
  add column if not exists show_on_trips boolean not null default true;

comment on column public.divers.show_on_trips is 'Si es true, los demás buceadores de la salida ven su resumen (nombre corto, nivel, inmersiones, idiomas, país, bio)';

-- Devuelve {"divers": [...], "others": n}
--  divers: buceadores con plaza que aceptan mostrarse (solo si quien pregunta ha iniciado sesión)
--  others: plazas ocupadas por gente que no se muestra (reservas manuales, perfiles ocultos o sin sesión)
create or replace function public.trip_divers(p_trip uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
      -- Nombre corto: "Ana G."
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
      s.seats
    from shown s
    join divers d on d.id = s.diver_id
  )
  select jsonb_build_object(
    'divers', coalesce((select jsonb_agg(to_jsonb(i) order by i.is_me desc, i.dives desc) from info i), '[]'::jsonb),
    'others', coalesce((select sum(seats) from live), 0) - coalesce((select sum(seats) from shown), 0)
  )
$$;

revoke execute on function public.trip_divers(uuid) from public;
grant execute on function public.trip_divers(uuid) to anon, authenticated;
