CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE cert_level AS ENUM ('open_water', 'advanced', 'rescue', 'divemaster', 'instructor');
CREATE TYPE trip_status AS ENUM ('draft', 'published', 'cancelled_weather', 'completed');
CREATE TYPE booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled_by_diver', 'cancelled_by_center');
CREATE TYPE booking_source AS ENUM ('app', 'whatsapp', 'instagram', 'facebook', 'walk_in');

CREATE TABLE centers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  area                  TEXT NOT NULL DEFAULT 'Panglao',
  phone                 TEXT,
  gcash_number          TEXT,
  default_divers_per_guide SMALLINT NOT NULL DEFAULT 4 CHECK (default_divers_per_guide BETWEEN 1 AND 10),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE center_staff (
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL,
  role      TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager')),
  PRIMARY KEY (center_id, user_id)
);

CREATE TABLE boats (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  capacity  SMALLINT NOT NULL CHECK (capacity BETWEEN 1 AND 60),
  active    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (center_id, name)
);

CREATE TABLE dive_sites (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  area              TEXT NOT NULL,
  min_depth_m       SMALLINT,
  max_depth_m       SMALLINT,
  recommended_min   cert_level NOT NULL DEFAULT 'open_water',
  sanctuary_fee_php INTEGER NOT NULL DEFAULT 0 CHECK (sanctuary_fee_php >= 0),
  UNIQUE (area, name),
  CHECK (max_depth_m IS NULL OR min_depth_m IS NULL OR max_depth_m >= min_depth_m)
);

CREATE TABLE trips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id        UUID NOT NULL REFERENCES centers(id),
  boat_id          UUID NOT NULL REFERENCES boats(id),
  departs_at       TIMESTAMPTZ NOT NULL,
  num_dives        SMALLINT NOT NULL DEFAULT 3 CHECK (num_dives BETWEEN 1 AND 5),
  min_level        cert_level NOT NULL DEFAULT 'open_water',
  price_php        INTEGER NOT NULL CHECK (price_php > 0),
  gear_rental_php  INTEGER NOT NULL DEFAULT 0 CHECK (gear_rental_php >= 0),
  guides           SMALLINT NOT NULL DEFAULT 1 CHECK (guides BETWEEN 1 AND 15),
  divers_per_guide SMALLINT NOT NULL CHECK (divers_per_guide BETWEEN 1 AND 10),
  seat_override    SMALLINT CHECK (seat_override >= 0),
  blocked_seats    SMALLINT NOT NULL DEFAULT 0 CHECK (blocked_seats >= 0),
  status           trip_status NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trip_sites (
  trip_id  UUID REFERENCES trips(id) ON DELETE CASCADE,
  site_id  UUID NOT NULL REFERENCES dive_sites(id),
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 5),
  PRIMARY KEY (trip_id, position)
);

CREATE TABLE divers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID UNIQUE,
  full_name    TEXT NOT NULL,
  languages    TEXT[] NOT NULL DEFAULT '{}',
  logged_dives INTEGER CHECK (logged_dives >= 0),
  seeks_buddy  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE certifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diver_id    UUID NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  agency      TEXT NOT NULL,
  level       cert_level NOT NULL,
  card_number TEXT,
  photo_path  TEXT,
  verified_by UUID REFERENCES centers(id),
  verified_at TIMESTAMPTZ
);

CREATE TABLE bookings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        UUID NOT NULL REFERENCES trips(id),
  diver_id       UUID REFERENCES divers(id),
  guest_name     TEXT,
  seats          SMALLINT NOT NULL CHECK (seats BETWEEN 1 AND 20),
  with_gear      BOOLEAN NOT NULL DEFAULT false,
  source         booking_source NOT NULL DEFAULT 'app',
  status         booking_status NOT NULL DEFAULT 'pending_payment',
  amount_php     INTEGER NOT NULL DEFAULT 0 CHECK (amount_php >= 0),
  commission_php INTEGER NOT NULL DEFAULT 0 CHECK (commission_php >= 0),
  refund_php     INTEGER NOT NULL DEFAULT 0 CHECK (refund_php >= 0),
  medical_signed BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at        TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  CHECK ((source = 'app' AND diver_id IS NOT NULL) OR (source <> 'app' AND guest_name IS NOT NULL)),
  CHECK (source = 'app' OR commission_php = 0)
);

CREATE INDEX idx_trips_published ON trips (departs_at) WHERE status = 'published';
CREATE INDEX idx_trips_center ON trips (center_id, departs_at);
CREATE INDEX idx_bookings_trip ON bookings (trip_id) WHERE status IN ('pending_payment', 'confirmed');
CREATE INDEX idx_bookings_diver ON bookings (diver_id);
CREATE INDEX idx_certs_diver ON certifications (diver_id);
