-- Generado por worker/gen-schema.mjs a partir de worker/schema.js. No editar a mano.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  email_confirmed_at TEXT,
  last_sign_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_metadata TEXT NOT NULL DEFAULT '{}',
  provider TEXT NOT NULL DEFAULT 'email',
  google_sub TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  aal TEXT NOT NULL DEFAULT 'aal1' CHECK (aal IN ('aal1', 'aal2')),
  recovery INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  ua TEXT
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('confirm', 'recovery')),
  redirect TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS mfa_factors (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified')),
  friendly_name TEXT,
  last_step INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reauth_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS destinations (
  name TEXT PRIMARY KEY,
  province TEXT NOT NULL,
  island_group TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS centers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'Panglao',
  phone TEXT,
  gcash_number TEXT,
  default_divers_per_guide INTEGER NOT NULL DEFAULT 4 CHECK (default_divers_per_guide BETWEEN 1 AND 10),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  locality TEXT,
  website TEXT,
  source_url TEXT,
  lat REAL,
  lng REAL,
  location_precision TEXT NOT NULL DEFAULT 'zona' CHECK (location_precision IN ('zona', 'exacta')),
  listing_status TEXT NOT NULL DEFAULT 'directorio' CHECK (listing_status IN ('directorio', 'invitado', 'socio', 'cerrado')),
  notes TEXT,
  destination TEXT REFERENCES destinations(name) ON UPDATE CASCADE,
  province TEXT,
  languages TEXT NOT NULL DEFAULT '[]',
  course_languages TEXT NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected', 'suspended')),
  claims_center_id TEXT REFERENCES centers(id),
  verified_at TEXT,
  review_note TEXT,
  agencies TEXT NOT NULL DEFAULT '[]',
  agency_detail TEXT,
  directory_check TEXT,
  checked_at TEXT,
  green_fins TEXT CHECK (green_fins IN ('member', 'certified', 'digital')),
  green_fins_verified INTEGER NOT NULL DEFAULT 0,
  eco TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS center_staff (
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager')),
  PRIMARY KEY (center_id, user_id)
);

CREATE TABLE IF NOT EXISTS boats (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 60),
  active INTEGER NOT NULL DEFAULT 1,
  show_to_divers INTEGER NOT NULL DEFAULT 0,
  UNIQUE (center_id, name)
);

CREATE TABLE IF NOT EXISTS dive_sites (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  min_depth_m INTEGER,
  max_depth_m INTEGER,
  recommended_min TEXT NOT NULL DEFAULT 'open_water' CHECK (recommended_min IN ('open_water', 'advanced', 'rescue', 'divemaster', 'instructor')),
  sanctuary_fee_php INTEGER NOT NULL DEFAULT 0 CHECK (sanctuary_fee_php >= 0),
  province TEXT,
  highlight TEXT,
  highlight_es TEXT,
  UNIQUE (area, name),
  CHECK (max_depth_m IS NULL OR min_depth_m IS NULL OR max_depth_m >= min_depth_m)
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  center_id TEXT NOT NULL REFERENCES centers(id),
  boat_id TEXT NOT NULL REFERENCES boats(id),
  departs_at TEXT NOT NULL,
  num_dives INTEGER NOT NULL DEFAULT 3 CHECK (num_dives BETWEEN 1 AND 5),
  min_level TEXT NOT NULL DEFAULT 'open_water' CHECK (min_level IN ('open_water', 'advanced', 'rescue', 'divemaster', 'instructor')),
  price_php INTEGER NOT NULL CHECK (price_php > 0),
  gear_rental_php INTEGER NOT NULL DEFAULT 0 CHECK (gear_rental_php >= 0),
  guides INTEGER NOT NULL DEFAULT 1 CHECK (guides BETWEEN 1 AND 15),
  divers_per_guide INTEGER NOT NULL CHECK (divers_per_guide BETWEEN 1 AND 10),
  seat_override INTEGER CHECK (seat_override >= 0),
  blocked_seats INTEGER NOT NULL DEFAULT 0 CHECK (blocked_seats >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled_weather', 'completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  include_fees INTEGER NOT NULL DEFAULT 0,
  fees_per_diver INTEGER CHECK (fees_per_diver BETWEEN 0 AND 20000),
  last_minute_pct INTEGER NOT NULL DEFAULT 0 CHECK (last_minute_pct BETWEEN 0 AND 50),
  last_minute_at TEXT,
  last_minute_notified_at TEXT,
  early_pct INTEGER NOT NULL DEFAULT 0 CHECK (early_pct BETWEEN 0 AND 30),
  early_days INTEGER NOT NULL DEFAULT 14 CHECK (early_days BETWEEN 2 AND 90),
  kind TEXT NOT NULL DEFAULT 'fun' CHECK (kind IN ('fun', 'course')),
  course_name TEXT CHECK (length(course_name) <= 80),
  course_days INTEGER CHECK (course_days BETWEEN 1 AND 14),
  course_prereq TEXT CHECK (course_prereq IN ('open_water', 'advanced', 'rescue', 'divemaster', 'instructor')),
  activity TEXT NOT NULL DEFAULT 'scuba' CHECK (activity IN ('scuba', 'snorkel', 'freedive', 'try_dive'))
);

CREATE TABLE IF NOT EXISTS trip_sites (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES dive_sites(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  PRIMARY KEY (trip_id, position)
);

CREATE TABLE IF NOT EXISTS divers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  languages TEXT NOT NULL DEFAULT '[]',
  logged_dives INTEGER CHECK (logged_dives >= 0),
  seeks_buddy INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  avatar_url TEXT,
  auth_provider TEXT,
  locale TEXT,
  account_type TEXT NOT NULL DEFAULT 'diver' CHECK (account_type IN ('diver', 'center')),
  country TEXT CHECK (length(country) <= 60),
  bio TEXT CHECK (length(bio) <= 160),
  show_on_trips INTEGER NOT NULL DEFAULT 1,
  wetsuit_size TEXT CHECK (wetsuit_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL')),
  bcd_size TEXT CHECK (bcd_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL')),
  fin_size TEXT CHECK (length(fin_size) <= 12),
  last_dive_date TEXT,
  nitrox INTEGER NOT NULL DEFAULT 0,
  medical_done_at TEXT,
  medical_result TEXT CHECK (medical_result IN ('all_no', 'physician_ok')),
  buddy_ratings_enabled INTEGER NOT NULL DEFAULT 0,
  allergies TEXT CHECK (length(allergies) <= 300),
  alert_destinations TEXT NOT NULL DEFAULT '[]',
  insurance_provider TEXT CHECK (length(insurance_provider) <= 60),
  insurance_expiry TEXT,
  insurance_reminded_for TEXT,
  public_profile INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT CHECK (pay_method IN ('gcash', 'paymaya', 'qrph', 'card', 'grab_pay'))
);

CREATE TABLE IF NOT EXISTS certifications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  diver_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  agency TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('open_water', 'advanced', 'rescue', 'divemaster', 'instructor')),
  card_number TEXT,
  photo_path TEXT,
  verified_by TEXT REFERENCES centers(id),
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  diver_id TEXT REFERENCES divers(id),
  guest_name TEXT,
  seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 20),
  with_gear INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'whatsapp', 'instagram', 'facebook', 'walk_in')),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'confirmed', 'cancelled_by_diver', 'cancelled_by_center')),
  amount_php INTEGER NOT NULL DEFAULT 0 CHECK (amount_php >= 0),
  commission_php INTEGER NOT NULL DEFAULT 0 CHECK (commission_php >= 0),
  refund_php INTEGER NOT NULL DEFAULT 0 CHECK (refund_php >= 0),
  medical_signed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at TEXT,
  cancelled_at TEXT,
  paid_php INTEGER NOT NULL DEFAULT 0 CHECK (paid_php >= 0),
  deposit_php INTEGER NOT NULL DEFAULT 0 CHECK (deposit_php >= 0),
  hold_until TEXT,
  balance_paid_at TEXT,
  checked_in_at TEXT,
  channel TEXT CHECK (channel IN ('marketplace', 'direct')),
  fees_php INTEGER NOT NULL DEFAULT 0 CHECK (fees_php >= 0),
  extras_php INTEGER NOT NULL DEFAULT 0 CHECK (extras_php >= 0),
  discount_php INTEGER NOT NULL DEFAULT 0 CHECK (discount_php >= 0),
  pay_on_site INTEGER NOT NULL DEFAULT 0,
  balance_reminded_at TEXT,
  CHECK ((source = 'app' AND diver_id IS NOT NULL) OR (source <> 'app' AND guest_name IS NOT NULL)),
  CHECK (source = 'app' OR commission_php = 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'full', 'balance')),
  method TEXT NOT NULL CHECK (method IN ('card', 'gcash', 'cash', 'demo')),
  amount_php INTEGER NOT NULL CHECK (amount_php > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  provider TEXT NOT NULL DEFAULT 'paymongo' CHECK (provider IN ('paymongo', 'cash', 'demo')),
  provider_ref TEXT UNIQUE,
  checkout_url TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at TEXT,
  channel_method TEXT
);

CREATE TABLE IF NOT EXISTS trip_waitlist (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  diver_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  seats INTEGER NOT NULL DEFAULT 1,
  with_gear INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'booked', 'left', 'expired')),
  booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  offered_at TEXT,
  CHECK (seats BETWEEN 1 AND 6)
);

CREATE TABLE IF NOT EXISTS trip_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author TEXT NOT NULL,
  is_staff INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS center_reviews (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  diver_id TEXT REFERENCES divers(id) ON DELETE SET NULL,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT CHECK (length(body) <= 600),
  reply TEXT CHECK (length(reply) <= 400),
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS center_packs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  trips INTEGER NOT NULL CHECK (trips BETWEEN 2 AND 20),
  discount_pct INTEGER NOT NULL CHECK (discount_pct BETWEEN 5 AND 40),
  valid_days INTEGER NOT NULL DEFAULT 14 CHECK (valid_days BETWEEN 2 AND 90),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  lang TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS buddy_alerts (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  diver_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (trip_id, diver_id)
);

CREATE TABLE IF NOT EXISTS center_extras (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('insurance', 'course', 'photo', 'video', 'nitrox', 'other')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description TEXT CHECK (length(description) <= 200),
  price_php INTEGER NOT NULL CHECK (price_php BETWEEN 0 AND 200000),
  per_seat INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS booking_extras (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  extra_id TEXT NOT NULL REFERENCES center_extras(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 20),
  price_php INTEGER NOT NULL CHECK (price_php >= 0),
  PRIMARY KEY (booking_id, extra_id)
);

CREATE TABLE IF NOT EXISTS dive_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  diver_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  center_id TEXT REFERENCES centers(id) ON DELETE SET NULL,
  site_id TEXT REFERENCES dive_sites(id) ON DELETE SET NULL,
  site_name TEXT,
  dive_date TEXT NOT NULL,
  entry_time TEXT,
  max_depth_m REAL CHECK (max_depth_m BETWEEN 0 AND 350),
  avg_depth_m REAL CHECK (avg_depth_m BETWEEN 0 AND 350),
  duration_min INTEGER CHECK (duration_min BETWEEN 0 AND 600),
  water_temp_c REAL,
  visibility_m INTEGER CHECK (visibility_m BETWEEN 0 AND 100),
  gas TEXT NOT NULL DEFAULT 'air' CHECK (gas IN ('air', 'nitrox', 'trimix')),
  o2_pct INTEGER CHECK (o2_pct BETWEEN 21 AND 100),
  tank_start_bar INTEGER CHECK (tank_start_bar BETWEEN 0 AND 350),
  tank_end_bar INTEGER CHECK (tank_end_bar BETWEEN 0 AND 350),
  weights_kg REAL,
  suit TEXT,
  buddy TEXT,
  conditions TEXT,
  marine_life TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  notes TEXT,
  share_with_center INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  signed_by_center TEXT,
  signed_at TEXT,
  share_public INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dive_log_photos (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  log_id TEXT NOT NULL REFERENCES dive_logs(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS buddy_ratings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  rater_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  rated_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  buoyancy INTEGER CHECK (buoyancy BETWEEN 1 AND 5),
  air INTEGER CHECK (air BETWEEN 1 AND 5),
  awareness INTEGER CHECK (awareness BETWEEN 1 AND 5),
  safety INTEGER CHECK (safety BETWEEN 1 AND 5),
  reef INTEGER CHECK (reef BETWEEN 1 AND 5),
  dive_again INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (trip_id, rater_id, rated_id),
  CHECK (rater_id <> rated_id),
  CHECK (coalesce(buoyancy, air, awareness, safety, reef) IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS center_invites (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'guide')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS center_guides (
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (center_id, user_id)
);

CREATE TABLE IF NOT EXISTS trip_guides (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('diver', 'center')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (follower_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS sightings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  site_id TEXT NOT NULL REFERENCES dive_sites(id) ON DELETE CASCADE,
  species TEXT NOT NULL CHECK (length(species) BETWEEN 2 AND 40),
  note TEXT CHECK (length(note) <= 200),
  seen_on TEXT NOT NULL,
  center_id TEXT REFERENCES centers(id) ON DELETE SET NULL,
  diver_id TEXT REFERENCES divers(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS platform_admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS center_verifications (
  center_id TEXT PRIMARY KEY REFERENCES centers(id) ON DELETE CASCADE,
  legal_name TEXT,
  business_reg_type TEXT,
  business_reg_number TEXT,
  mayors_permit_number TEXT,
  owner_name TEXT,
  owner_role TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  agency TEXT,
  agency_number TEXT,
  social_url TEXT,
  years_operating INTEGER,
  notes TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS center_documents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('business_permit', 'dti_sec', 'owner_id', 'agency_cert', 'shop_photo', 'other')),
  path TEXT NOT NULL,
  file_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

DROP VIEW IF EXISTS published_trips;
CREATE VIEW published_trips AS
SELECT t.id, t.center_id, t.departs_at, t.num_dives, t.min_level, t.price_php, t.gear_rental_php, c.name AS center_name,
  CASE WHEN bo.show_to_divers THEN bo.name END AS boat_name,
  (SELECT json_group_array(name) FROM (SELECT ds.name FROM trip_sites ts JOIN dive_sites ds ON ds.id = ts.site_id WHERE ts.trip_id = t.id ORDER BY ts.position)) AS sites,
  (CASE WHEN t.status <> 'published' THEN 0 ELSE max(0, max(0, min((SELECT capacity FROM boats WHERE id = t.boat_id), t.guides * t.divers_per_guide, coalesce(t.seat_override, 32767))) - max(t.blocked_seats, (SELECT coalesce(sum(b.seats), 0) FROM bookings b WHERE b.trip_id = t.id AND b.source <> 'app' AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND max(strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at, '+15 minutes'), coalesce(b.hold_until, '')) > (strftime('%Y-%m-%dT%H:%M:%fZ','now')))))) - (SELECT coalesce(sum(b.seats), 0) FROM bookings b WHERE b.trip_id = t.id AND b.source = 'app' AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND max(strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at, '+15 minutes'), coalesce(b.hold_until, '')) > (strftime('%Y-%m-%dT%H:%M:%fZ','now')))))) END) AS available_seats,
  c.area AS center_area, c.locality AS center_locality, c.lat AS center_lat, c.lng AS center_lng,
  (SELECT coalesce(sum(b.seats), 0) FROM bookings b WHERE b.trip_id = t.id AND 1 AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND max(strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at, '+15 minutes'), coalesce(b.hold_until, '')) > (strftime('%Y-%m-%dT%H:%M:%fZ','now'))))) AS booked_seats,
  c.destination AS center_destination, c.province AS center_province, c.languages AS center_languages, c.agencies AS center_agencies, c.course_languages AS center_course_languages,
  t.include_fees, (CASE WHEN t.include_fees THEN coalesce(t.fees_per_diver, (SELECT coalesce(sum(ds.sanctuary_fee_php), 0) FROM trip_sites ts JOIN dive_sites ds ON ds.id = ts.site_id WHERE ts.trip_id = t.id)) ELSE 0 END) AS fees_php,
  CASE WHEN (t.last_minute_pct > 0 AND t.departs_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+48 hours')) THEN t.last_minute_pct ELSE 0 END AS last_minute_pct,
  c.green_fins AS center_green_fins, c.green_fins_verified AS center_green_fins_verified,
  CASE WHEN (t.early_pct > 0 AND t.departs_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || t.early_days || ' days')) THEN t.early_pct ELSE 0 END AS early_pct, t.kind, t.course_name, t.course_days, t.course_prereq,
  (SELECT json_group_array((SELECT ce.level FROM certifications ce WHERE ce.diver_id = d.id ORDER BY CASE ce.level WHEN 'instructor' THEN 4 WHEN 'divemaster' THEN 3 WHEN 'rescue' THEN 2 WHEN 'advanced' THEN 1 ELSE 0 END DESC LIMIT 1))
     FROM bookings b JOIN divers d ON d.id = b.diver_id WHERE b.trip_id = t.id AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND max(strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at, '+15 minutes'), coalesce(b.hold_until, '')) > (strftime('%Y-%m-%dT%H:%M:%fZ','now')))) AND d.seeks_buddy = 1 AND d.show_on_trips = 1) AS buddy_seekers,
  (SELECT count(*) FROM trip_waitlist w WHERE w.trip_id = t.id AND w.status = 'waiting') AS waitlist,
  (SELECT round(avg(r.rating), 1) FROM center_reviews r WHERE r.center_id = c.id) AS center_rating,
  (SELECT count(*) FROM center_reviews r WHERE r.center_id = c.id) AS center_reviews,
  t.activity
FROM trips t JOIN centers c ON c.id = t.center_id JOIN boats bo ON bo.id = t.boat_id
WHERE t.status = 'published' AND c.verification_status = 'verified';

CREATE INDEX IF NOT EXISTS waitlist_trip ON trip_waitlist(trip_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one ON trip_waitlist(trip_id, diver_id) WHERE status IN ('waiting', 'offered');

CREATE INDEX IF NOT EXISTS messages_trip ON trip_messages(trip_id, created_at);

CREATE INDEX IF NOT EXISTS reviews_center ON center_reviews(center_id, created_at);

CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS packs_center ON center_packs(center_id);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id);

CREATE INDEX IF NOT EXISTS mfa_user ON mfa_factors(user_id);

CREATE INDEX IF NOT EXISTS centers_destination ON centers(destination);

CREATE INDEX IF NOT EXISTS centers_status ON centers(verification_status, listing_status);

CREATE INDEX IF NOT EXISTS staff_user ON center_staff(user_id);

CREATE INDEX IF NOT EXISTS boats_center ON boats(center_id);

CREATE INDEX IF NOT EXISTS trips_center_departs ON trips(center_id, departs_at);

CREATE INDEX IF NOT EXISTS trips_status_departs ON trips(status, departs_at);

CREATE INDEX IF NOT EXISTS trip_sites_site ON trip_sites(site_id);

CREATE INDEX IF NOT EXISTS bookings_trip ON bookings(trip_id);

CREATE INDEX IF NOT EXISTS bookings_diver ON bookings(diver_id);

CREATE INDEX IF NOT EXISTS payments_booking ON payments(booking_id);

CREATE INDEX IF NOT EXISTS certs_diver ON certifications(diver_id);

CREATE INDEX IF NOT EXISTS logs_diver ON dive_logs(diver_id, dive_date);

CREATE INDEX IF NOT EXISTS buddy_rated ON buddy_ratings(rated_id);

CREATE INDEX IF NOT EXISTS buddy_rater ON buddy_ratings(rater_id);

CREATE INDEX IF NOT EXISTS logs_center ON dive_logs(center_id);

CREATE INDEX IF NOT EXISTS photos_log ON dive_log_photos(log_id);

CREATE INDEX IF NOT EXISTS docs_center ON center_documents(center_id);

CREATE INDEX IF NOT EXISTS audit_at ON admin_audit(at);

CREATE INDEX IF NOT EXISTS extras_center ON center_extras(center_id);

CREATE INDEX IF NOT EXISTS invites_center ON center_invites(center_id);

CREATE INDEX IF NOT EXISTS guides_user ON center_guides(user_id);

CREATE INDEX IF NOT EXISTS trip_guides_user ON trip_guides(user_id);

CREATE INDEX IF NOT EXISTS follows_target ON follows(target_type, target_id);

CREATE INDEX IF NOT EXISTS sightings_site ON sightings(site_id, seen_on);

CREATE INDEX IF NOT EXISTS sightings_seen ON sightings(seen_on);

CREATE INDEX IF NOT EXISTS logs_public ON dive_logs(share_public, created_at);

INSERT OR IGNORE INTO app_config (key, value) VALUES ('payments_mode', 'demo'), ('deposit_pct', '50'), ('marketplace_fee_php', '250'), ('dan_url', 'https://world.dan.org/membership-coverage/asia-pacific/'), ('dan_affiliate', '0');
