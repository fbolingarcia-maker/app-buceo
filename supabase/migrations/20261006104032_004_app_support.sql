CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO divers (user_id, full_name)
  VALUES (NEW.id, COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), split_part(NEW.email, '@', 1)))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION register_center(p_name TEXT, p_phone TEXT) RETURNS centers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c centers;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: inicia sesión'; END IF;
  IF COALESCE(trim(p_name), '') = '' THEN RAISE EXCEPTION 'NO_NAME: indica el nombre del centro'; END IF;
  IF EXISTS (SELECT 1 FROM center_staff WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'BAD_STATE: ya gestionas un centro'; END IF;
  INSERT INTO centers (name, phone) VALUES (trim(p_name), NULLIF(trim(p_phone), '')) RETURNING * INTO c;
  INSERT INTO center_staff (center_id, user_id, role) VALUES (c.id, auth.uid(), 'owner');
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION confirm_payment_demo(p_booking UUID) RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b bookings;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.diver_id IS DISTINCT FROM my_diver_id() THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF b.status <> 'pending_payment' THEN RAISE EXCEPTION 'BAD_STATE: la reserva no está pendiente de pago'; END IF;
  IF NOT holds_seat(b) THEN RAISE EXCEPTION 'HOLD_EXPIRED: la reserva ha caducado'; END IF;
  UPDATE bookings SET status = 'confirmed', paid_at = now() WHERE id = b.id RETURNING * INTO b;
  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION has_booking_on(p_trip UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM bookings WHERE trip_id = p_trip AND diver_id = my_diver_id())
$$;
DROP POLICY IF EXISTS trips_read_booked ON trips;
CREATE POLICY trips_read_booked ON trips FOR SELECT USING (has_booking_on(id));

-- Centros y salidas de demo
DO $$
DECLARE c1 UUID; c2 UUID; b1 UUID; b2 UUID; b3 UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM centers WHERE name LIKE 'Demo · %') THEN RETURN; END IF;
  INSERT INTO centers (name, area) VALUES ('Demo · Centro Alona', 'Panglao') RETURNING id INTO c1;
  INSERT INTO centers (name, area) VALUES ('Demo · Centro Danao', 'Panglao') RETURNING id INTO c2;
  INSERT INTO boats (center_id, name, capacity) VALUES (c1, 'Banca grande', 12) RETURNING id INTO b1;
  INSERT INTO boats (center_id, name, capacity) VALUES (c1, 'Banca pequeña', 8) RETURNING id INTO b2;
  INSERT INTO boats (center_id, name, capacity) VALUES (c2, 'Banca Danao', 10) RETURNING id INTO b3;
END $$;
