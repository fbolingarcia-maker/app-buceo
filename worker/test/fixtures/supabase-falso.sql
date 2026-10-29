-- Imitación mínima de Supabase (auth, vault, pg_net) y de las tablas de public para ensayar la exportación en un Postgres local.
-- La usa worker/migrate/ensayo-local.sh. Tipos copiados de information_schema de Supabase (los enum como text).
create extension if not exists pgcrypto;
create role anon; create role authenticated;
create schema auth; create schema vault; create schema net; create schema extensions;
create table auth.users (id uuid primary key, email text, encrypted_password text, email_confirmed_at timestamptz, last_sign_in_at timestamptz,
  created_at timestamptz default now(), raw_user_meta_data jsonb, raw_app_meta_data jsonb, deleted_at timestamptz);
create table auth.identities (user_id uuid, provider text, provider_id text);
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('divingslot_notify_key', 'clave-avisos'), ('divingslot_notify_url', 'https://divingslot.test/api/notify');
create table net.reqs (id bigserial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language sql as
  $$ insert into net.reqs (url, body, headers) values (url, body, headers) returning id $$;
create table public.admin_audit (id bigint, at timestamptz, actor uuid, action text, target uuid, detail jsonb);
create table public.app_config (key text, value text);
create table public.boats (id uuid, center_id uuid, name text, capacity smallint, active boolean, show_to_divers boolean);
create table public.bookings (id uuid, trip_id uuid, diver_id uuid, guest_name text, seats smallint, with_gear boolean, source text, status text, amount_php integer, commission_php integer, refund_php integer, medical_signed boolean, created_at timestamptz, paid_at timestamptz, cancelled_at timestamptz, paid_php integer, deposit_php integer, hold_until timestamptz, balance_paid_at timestamptz, checked_in_at timestamptz);
create table public.buddy_ratings (id uuid, trip_id uuid, rater_id uuid, rated_id uuid, buoyancy smallint, air smallint, awareness smallint, safety smallint, reef smallint, dive_again boolean, created_at timestamptz);
create table public.center_documents (id uuid, center_id uuid, kind text, path text, file_name text, created_at timestamptz);
create table public.center_staff (center_id uuid, user_id uuid, role text);
create table public.center_verifications (center_id uuid, legal_name text, business_reg_type text, business_reg_number text, mayors_permit_number text, owner_name text, owner_role text, contact_email text, contact_phone text, address text, agency text, agency_number text, social_url text, years_operating integer, notes text, submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid, updated_at timestamptz);
create table public.centers (id uuid, name text, area text, phone text, gcash_number text, default_divers_per_guide smallint, created_at timestamptz, locality text, website text, source_url text, lat double precision, lng double precision, location_precision text, listing_status text, notes text, destination text, province text, languages text[], course_languages text[], verification_status text, claims_center_id uuid, verified_at timestamptz, review_note text, agencies text[], agency_detail text, directory_check text, checked_at date);
create table public.certifications (id uuid, diver_id uuid, agency text, level text, card_number text, photo_path text, verified_by uuid, verified_at timestamptz);
create table public.destinations (name text, province text, island_group text, lat double precision, lng double precision);
create table public.dive_log_photos (id uuid, log_id uuid, path text, caption text, created_at timestamptz);
create table public.dive_logs (id uuid, diver_id uuid, booking_id uuid, center_id uuid, site_id uuid, site_name text, dive_date date, entry_time time, max_depth_m numeric, avg_depth_m numeric, duration_min integer, water_temp_c numeric, visibility_m integer, gas text, o2_pct integer, tank_start_bar integer, tank_end_bar integer, weights_kg numeric, suit text, buddy text, conditions text, marine_life text, rating smallint, notes text, share_with_center boolean, created_at timestamptz, updated_at timestamptz);
create table public.dive_sites (id uuid, name text, area text, min_depth_m smallint, max_depth_m smallint, recommended_min text, sanctuary_fee_php integer, province text, highlight text, highlight_es text);
create table public.divers (id uuid, user_id uuid, full_name text, languages text[], logged_dives integer, seeks_buddy boolean, email text, avatar_url text, auth_provider text, locale text, account_type text, country text, bio text, show_on_trips boolean, wetsuit_size text, bcd_size text, fin_size text, last_dive_date date, nitrox boolean, medical_done_at date, medical_result text, buddy_ratings_enabled boolean);
create table public.payments (id uuid, booking_id uuid, kind text, method text, amount_php integer, status text, provider text, provider_ref text, checkout_url text, recorded_by uuid, created_at timestamptz, paid_at timestamptz);
create table public.platform_admins (user_id uuid, created_at timestamptz);
create table public.trip_sites (trip_id uuid, site_id uuid, position smallint);
create table public.trips (id uuid, center_id uuid, boat_id uuid, departs_at timestamptz, num_dives smallint, min_level text, price_php integer, gear_rental_php integer, guides smallint, divers_per_guide smallint, seat_override smallint, blocked_seats smallint, status text, created_at timestamptz);
