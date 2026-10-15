CREATE OR REPLACE FUNCTION app_setting(key TEXT) RETURNS INTEGER
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE key
    WHEN 'commission_per_diver_php' THEN 250
    WHEN 'hold_minutes' THEN 15
    WHEN 'min_lead_minutes' THEN 60
    WHEN 'full_refund_hours' THEN 24
  END
$$;

CREATE OR REPLACE FUNCTION holds_seat(b bookings) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT b.status = 'confirmed'
      OR (b.status = 'pending_payment' AND b.created_at > now() - make_interval(mins => app_setting('hold_minutes')))
$$;

CREATE OR REPLACE FUNCTION operative_seats(t trips) RETURNS INTEGER
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT GREATEST(0, LEAST(
    (SELECT capacity FROM boats WHERE id = t.boat_id),
    t.guides * t.divers_per_guide,
    COALESCE(t.seat_override, 32767)))
$$;

CREATE OR REPLACE FUNCTION app_available_seats(p_trip UUID) RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN t.status <> 'published' THEN 0 ELSE GREATEST(0,
    operative_seats(t)
    - GREATEST(t.blocked_seats, (SELECT COALESCE(SUM(b.seats), 0) FROM bookings b
                                  WHERE b.trip_id = t.id AND b.source <> 'app' AND holds_seat(b)))
    - (SELECT COALESCE(SUM(b.seats), 0) FROM bookings b
        WHERE b.trip_id = t.id AND b.source = 'app' AND holds_seat(b)))::INTEGER END
  FROM trips t
  WHERE t.id = p_trip
$$;

CREATE OR REPLACE FUNCTION book_trip(p_trip UUID, p_seats INTEGER, p_with_gear BOOLEAN, p_medical_signed BOOLEAN)
RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t trips;
  d divers;
  best cert_level;
  free INTEGER;
  result bookings;
BEGIN
  SELECT * INTO d FROM divers WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_PROFILE: crea tu perfil de buceador'; END IF;
  IF p_seats IS NULL OR p_seats < 1 THEN RAISE EXCEPTION 'BAD_SEATS: número de plazas no válido'; END IF;

  SELECT * INTO t FROM trips WHERE id = p_trip FOR UPDATE;
  IF NOT FOUND OR t.status <> 'published' THEN RAISE EXCEPTION 'NOT_BOOKABLE: la salida no está abierta'; END IF;
  IF t.departs_at - now() < make_interval(mins => app_setting('min_lead_minutes')) THEN
    RAISE EXCEPTION 'TOO_LATE: ya no se puede reservar por la app'; END IF;
  IF NOT COALESCE(p_medical_signed, false) THEN RAISE EXCEPTION 'NO_MEDICAL: falta la declaración médica'; END IF;

  SELECT MAX(level) INTO best FROM certifications WHERE diver_id = d.id;
  IF best IS NULL OR best < t.min_level THEN RAISE EXCEPTION 'LEVEL: tu certificación no alcanza el mínimo'; END IF;

  IF EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id AND b.diver_id = d.id AND holds_seat(b)) THEN
    RAISE EXCEPTION 'DUPLICATE: ya tienes una reserva en esta salida'; END IF;

  free := app_available_seats(t.id);
  IF p_seats > free THEN RAISE EXCEPTION 'NO_SEATS: solo quedan % plazas', free; END IF;

  INSERT INTO bookings (trip_id, diver_id, seats, with_gear, source, status, amount_php, commission_php, medical_signed)
  VALUES (t.id, d.id, p_seats, COALESCE(p_with_gear, false), 'app', 'pending_payment',
          p_seats * t.price_php + CASE WHEN p_with_gear THEN p_seats * t.gear_rental_php ELSE 0 END,
          p_seats * app_setting('commission_per_diver_php'), true)
  RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION add_manual_booking(p_trip UUID, p_guest TEXT, p_seats INTEGER, p_with_gear BOOLEAN, p_source booking_source)
RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t trips;
  used INTEGER;
  result bookings;
BEGIN
  SELECT * INTO t FROM trips WHERE id = p_trip FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM center_staff WHERE center_id = t.center_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_source = 'app' THEN RAISE EXCEPTION 'BAD_SOURCE'; END IF;
  IF COALESCE(trim(p_guest), '') = '' THEN RAISE EXCEPTION 'NO_NAME: indica el nombre'; END IF;
  IF p_seats IS NULL OR p_seats < 1 THEN RAISE EXCEPTION 'BAD_SEATS'; END IF;

  SELECT COALESCE(SUM(b.seats), 0) INTO used FROM bookings b WHERE b.trip_id = t.id AND holds_seat(b);
  IF used + p_seats > operative_seats(t) THEN
    RAISE EXCEPTION 'NO_SEATS: solo quedan % plazas en el barco', operative_seats(t) - used; END IF;

  INSERT INTO bookings (trip_id, guest_name, seats, with_gear, source, status, amount_php)
  VALUES (t.id, trim(p_guest), p_seats, COALESCE(p_with_gear, false), p_source, 'confirmed',
          p_seats * t.price_php + CASE WHEN p_with_gear THEN p_seats * t.gear_rental_php ELSE 0 END)
  RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION cancel_trip_weather(p_trip UUID) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t trips;
  n INTEGER;
BEGIN
  SELECT * INTO t FROM trips WHERE id = p_trip FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM center_staff WHERE center_id = t.center_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF t.status <> 'published' THEN RAISE EXCEPTION 'BAD_STATE'; END IF;

  UPDATE trips SET status = 'cancelled_weather' WHERE id = t.id;
  UPDATE bookings
     SET status = 'cancelled_by_center',
         refund_php = CASE WHEN status = 'confirmed' THEN amount_php ELSE 0 END,
         commission_php = 0,
         cancelled_at = now()
   WHERE trip_id = t.id AND status IN ('pending_payment', 'confirmed');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

ALTER TABLE centers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE center_staff   ENABLE ROW LEVEL SECURITY;
ALTER TABLE boats          ENABLE ROW LEVEL SECURITY;
ALTER TABLE dive_sites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips          ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_sites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE divers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings       ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_staff(p_center UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM center_staff WHERE center_id = p_center AND user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION my_diver_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM divers WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION trip_center(p_trip UUID) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT center_id FROM trips WHERE id = p_trip
$$;

CREATE OR REPLACE FUNCTION staff_sees_diver(p_diver UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM bookings b JOIN trips t ON t.id = b.trip_id
                 JOIN center_staff cs ON cs.center_id = t.center_id
                 WHERE b.diver_id = p_diver AND cs.user_id = auth.uid())
$$;

CREATE POLICY centers_read    ON centers    FOR SELECT USING (true);
CREATE POLICY sites_read      ON dive_sites FOR SELECT USING (true);
CREATE POLICY boats_read      ON boats      FOR SELECT USING (true);
CREATE POLICY trips_read      ON trips      FOR SELECT USING (status = 'published' OR is_staff(center_id));
CREATE POLICY trip_sites_read ON trip_sites FOR SELECT USING (true);

CREATE POLICY staff_self       ON center_staff FOR SELECT USING (user_id = auth.uid());
CREATE POLICY centers_write    ON centers FOR UPDATE USING (is_staff(id)) WITH CHECK (is_staff(id));
CREATE POLICY boats_write      ON boats   FOR ALL USING (is_staff(center_id)) WITH CHECK (is_staff(center_id));
CREATE POLICY trips_write      ON trips   FOR ALL USING (is_staff(center_id)) WITH CHECK (is_staff(center_id));
CREATE POLICY trip_sites_write ON trip_sites FOR ALL
  USING (is_staff(trip_center(trip_id))) WITH CHECK (is_staff(trip_center(trip_id)));

CREATE POLICY divers_self   ON divers FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY divers_center ON divers FOR SELECT USING (staff_sees_diver(id));

CREATE POLICY certs_self   ON certifications FOR ALL
  USING (diver_id = my_diver_id())
  WITH CHECK (diver_id = my_diver_id() AND verified_by IS NULL AND verified_at IS NULL);
CREATE POLICY certs_center ON certifications FOR SELECT USING (staff_sees_diver(diver_id));

CREATE POLICY bookings_diver  ON bookings FOR SELECT USING (diver_id = my_diver_id());
CREATE POLICY bookings_center ON bookings FOR SELECT USING (is_staff(trip_center(trip_id)));
