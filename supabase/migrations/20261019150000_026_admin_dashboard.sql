-- 026: cuadro de mando de la plataforma (solo administradores).
-- admin_dashboard(p_days, p_demo) devuelve en un solo JSON los datos de usuarios, centros, salidas, reservas,
-- cobros y alertas del periodo (últimos p_days días; las salidas «próximas» son los p_days días siguientes).
-- Por defecto excluye los centros de demostración (nombre «Demo…») para que las cifras sean reales.

create or replace function public.admin_dashboard(p_days int default 30, p_demo boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d int := greatest(1, least(coalesce(p_days, 30), 366));
  since timestamptz := now() - make_interval(days => d);
  until timestamptz := now() + make_interval(days => d);
  res jsonb;
begin
  if not is_platform_admin() then raise exception 'FORBIDDEN: no autorizado'; end if;

  with
  ctr as (select * from centers c where p_demo or c.name not like 'Demo%'),
  trp as (select t.* from trips t join ctr on ctr.id = t.center_id),
  bk  as (select b.*, t.center_id, t.departs_at from bookings b join trp t on t.id = b.trip_id),
  pay as (select p.* from payments p join bk on bk.id = p.booking_id),
  usr as (select u.id, u.created_at, u.last_sign_in_at, u.email_confirmed_at, dv.account_type, dv.country
            from auth.users u left join divers dv on dv.user_id = u.id),
  days as (select generate_series((now() at time zone 'Asia/Manila')::date - (d - 1), (now() at time zone 'Asia/Manila')::date, '1 day')::date as day),
  up as (select t.*, trip_booked_seats(t.id) as booked, app_available_seats(t.id) as free
           from trp t where t.status = 'published' and t.departs_at > now() and t.departs_at <= until)
  select jsonb_build_object(
    'days', d,
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', (select count(*) from usr),
      'divers', (select count(*) from usr where coalesce(account_type, 'diver') = 'diver'),
      'center_accounts', (select count(*) from usr where account_type = 'center'),
      'new', (select count(*) from usr where created_at >= since),
      'active', (select count(*) from usr where last_sign_in_at >= since),
      'unconfirmed', (select count(*) from usr where email_confirmed_at is null),
      'countries', coalesce((select jsonb_agg(x order by x.n desc) from (select coalesce(nullif(country, ''), '—') as country, count(*) n from usr group by 1 order by 2 desc limit 6) x), '[]'),
      'signups', (select jsonb_agg(jsonb_build_object('day', days.day, 'n',
                    (select count(*) from usr where (usr.created_at at time zone 'Asia/Manila')::date = days.day)) order by days.day) from days)
    ),
    'centers', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(verification_status, n) from (select verification_status, count(*) n from ctr where listing_status <> 'directorio' group by 1) x), '{}'),
      'directory', (select count(*) from ctr where listing_status = 'directorio'),
      'claims_pending', (select count(*) from ctr where claims_center_id is not null and verification_status = 'pending'),
      'new', (select count(*) from ctr where listing_status <> 'directorio' and created_at >= since),
      'top', coalesce((select jsonb_agg(x order by x.revenue desc, x.bookings desc) from (
                 select c.id, c.name, c.destination,
                        count(b.id) filter (where b.status in ('confirmed', 'pending_payment')) as bookings,
                        coalesce(sum(b.seats) filter (where b.status = 'confirmed'), 0) as divers,
                        coalesce(sum(b.amount_php) filter (where b.status = 'confirmed'), 0) as revenue
                   from ctr c join bk b on b.center_id = c.id
                  where b.created_at >= since
                  group by c.id, c.name, c.destination
                  order by revenue desc, bookings desc limit 8) x), '[]'),
      'by_destination', coalesce((select jsonb_agg(x order by x.n desc) from (select coalesce(destination, '—') as destination, count(*) n from ctr where verification_status = 'verified' group by 1 order by 2 desc limit 8) x), '[]')
    ),
    'trips', jsonb_build_object(
      'upcoming', (select count(*) from up),
      'seats_total', (select coalesce(sum(booked + free), 0) from up),
      'seats_booked', (select coalesce(sum(booked), 0) from up),
      'empty_upcoming', (select count(*) from up where booked = 0),
      'completed', (select count(*) from trp where status = 'completed' and departs_at >= since and departs_at <= now()),
      'cancelled_weather', (select count(*) from trp where status = 'cancelled_weather' and departs_at >= since),
      'drafts', (select count(*) from trp where status = 'draft' and departs_at > now())
    ),
    'bookings', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from bk where created_at >= since group by 1) x), '{}'),
      'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from bk where created_at >= since and status <> 'cancelled_by_diver' group by 1) x), '{}'),
      'divers', (select coalesce(sum(seats), 0) from bk where created_at >= since and status = 'confirmed'),
      'gross', (select coalesce(sum(amount_php), 0) from bk where created_at >= since and status = 'confirmed'),
      'collected', (select coalesce(sum(paid_php), 0) from bk where created_at >= since and status = 'confirmed'),
      'outstanding', (select coalesce(sum(amount_php - coalesce(paid_php, 0)), 0) from bk where status = 'confirmed' and departs_at > now()),
      'commission', (select coalesce(sum(commission_php), 0) from bk where created_at >= since and status = 'confirmed'),
      'refunds', (select coalesce(sum(refund_php), 0) from bk where cancelled_at >= since),
      'per_day', (select jsonb_agg(jsonb_build_object('day', days.day,
                    'n', (select count(*) from bk where (bk.created_at at time zone 'Asia/Manila')::date = days.day and bk.status in ('confirmed', 'pending_payment')),
                    'php', (select coalesce(sum(amount_php), 0) from bk where (bk.created_at at time zone 'Asia/Manila')::date = days.day and bk.status = 'confirmed')) order by days.day) from days)
    ),
    'payments', jsonb_build_object(
      'by_method', coalesce((select jsonb_object_agg(method, x.php) from (select method, sum(amount_php) php from pay where status = 'paid' and coalesce(paid_at, created_at) >= since group by 1) x), '{}'),
      'failed', (select count(*) from pay where status = 'failed' and created_at >= since),
      'pending_online', (select count(*) from pay where status = 'pending' and created_at >= since)
    ),
    'activity', jsonb_build_object(
      'dive_logs', (select count(*) from dive_logs where created_at >= since),
      'certs_unverified', (select count(*) from certifications where verified_at is null)
    ),
    'alerts', jsonb_build_object(
      'centers_pending', (select count(*) from ctr where verification_status = 'pending'),
      'expired_holds', (select count(*) from bk where status = 'pending_payment' and hold_until < now()),
      'unpaid_soon', (select count(*) from bk where status = 'confirmed' and coalesce(paid_php, 0) < amount_php and departs_at between now() and now() + interval '48 hours')
    )
  ) into res;
  return res;
end $$;
revoke execute on function public.admin_dashboard(int, boolean) from public, anon;
grant execute on function public.admin_dashboard(int, boolean) to authenticated;
