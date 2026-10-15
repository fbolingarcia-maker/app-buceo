-- 013: valoración pública de los centros
-- Media de las valoraciones (1–5) que los buceadores comparten con el centro desde su bitácora.
-- Solo se publican datos agregados: nunca quién valoró ni sus notas.
create or replace function public.center_ratings()
returns table (center_id uuid, rating numeric, reviews integer)
language sql
stable
security definer
set search_path = public
as $$
  select l.center_id, round(avg(l.rating)::numeric, 1), count(*)::int
  from dive_logs l
  where l.share_with_center and l.rating is not null and l.center_id is not null
  group by l.center_id
$$;

revoke execute on function public.center_ratings() from public;
grant execute on function public.center_ratings() to anon, authenticated;
