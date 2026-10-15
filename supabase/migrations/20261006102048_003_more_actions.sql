CREATE OR REPLACE FUNCTION cancel_my_booking(p_booking UUID) RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b bookings;
  t trips;
  full_refund BOOLEAN;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.diver_id IS DISTINCT FROM my_diver_id() THEN
    RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF b.status NOT IN ('pending_payment', 'confirmed') THEN RAISE EXCEPTION 'BAD_STATE: la reserva ya no está activa'; END IF;
  SELECT * INTO t FROM trips WHERE id = b.trip_id;
  IF t.departs_at <= now() THEN RAISE EXCEPTION 'STARTED: la salida ya ha empezado'; END IF;

  full_refund := t.departs_at - now() >= make_interval(hours => app_setting('full_refund_hours'));
  UPDATE bookings SET
    status = 'cancelled_by_diver',
    refund_php = CASE WHEN b.status = 'pending_payment' THEN 0
                      WHEN full_refund THEN amount_php
                      ELSE round(amount_php * 0.5) END,
    commission_php = CASE WHEN b.status = 'pending_payment' OR full_refund THEN 0 ELSE commission_php END,
    cancelled_at = now()
  WHERE id = b.id
  RETURNING * INTO b;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION verify_certification(p_cert UUID, p_center UUID) RETURNS certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c certifications;
BEGIN
  IF NOT is_staff(p_center) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM certifications ce JOIN bookings b ON b.diver_id = ce.diver_id
                 JOIN trips t ON t.id = b.trip_id WHERE ce.id = p_cert AND t.center_id = p_center) THEN
    RAISE EXCEPTION 'FORBIDDEN: ese buceador no tiene reservas con tu centro'; END IF;
  UPDATE certifications SET verified_by = p_center, verified_at = now() WHERE id = p_cert RETURNING * INTO c;
  RETURN c;
END $$;

CREATE OR REPLACE VIEW published_trips WITH (security_invoker = true) AS
SELECT t.id, t.center_id, t.departs_at, t.num_dives, t.min_level, t.price_php, t.gear_rental_php,
       c.name AS center_name, bo.name AS boat_name,
       ARRAY(SELECT ds.name FROM trip_sites ts JOIN dive_sites ds ON ds.id = ts.site_id
             WHERE ts.trip_id = t.id ORDER BY ts.position) AS sites,
       app_available_seats(t.id) AS available_seats
FROM trips t
JOIN centers c ON c.id = t.center_id
JOIN boats bo ON bo.id = t.boat_id
WHERE t.status = 'published';

INSERT INTO dive_sites (name, area, recommended_min, sanctuary_fee_php) VALUES
  ('Balicasag – Black Forest',   'Balicasag', 'open_water', 0),
  ('Balicasag – Turtle Point',   'Balicasag', 'open_water', 0),
  ('Balicasag – Cathedral Wall', 'Balicasag', 'advanced',   0),
  ('Balicasag – Divers Heaven',  'Balicasag', 'open_water', 0),
  ('Balicasag – Rico''s Wall',   'Balicasag', 'open_water', 0),
  ('Pamilacan',                  'Pamilacan', 'open_water', 0),
  ('Napaling',                   'Panglao',   'open_water', 0),
  ('Doljo Point',                'Panglao',   'open_water', 0),
  ('Arco Point',                 'Panglao',   'open_water', 0),
  ('Kalipayan',                  'Panglao',   'open_water', 0)
ON CONFLICT (area, name) DO NOTHING;
