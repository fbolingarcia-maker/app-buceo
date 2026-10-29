// Esquema de DivingSlot en D1 (SQLite): una sola fuente para el SQL (`node worker/gen-schema.mjs`)
// y para la API (tipos de columna, columnas privadas y relaciones para los `select('*, tabla(...)')`).
//
// Tipos: uuid · text · int · real · bool (0/1) · json (arrays y jsonb, texto JSON) · ts (ISO UTC «…Z») · date · time
// Columna: [nombre, tipo, opciones]  opciones: { nn, pk, def (SQL), check (SQL), ref: 'tabla(col)', onDelete, unique }

export const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
const UUID = "(lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))))"
const ENUM = (col, vals) => `${col} IN (${vals.map((v) => `'${v}'`).join(', ')})`

export const CERT_LEVELS = ['open_water', 'advanced', 'rescue', 'divemaster', 'instructor']
export const BOOKING_SOURCES = ['app', 'whatsapp', 'instagram', 'facebook', 'walk_in']
export const BOOKING_STATUSES = ['pending_payment', 'confirmed', 'cancelled_by_diver', 'cancelled_by_center']
export const TRIP_STATUSES = ['draft', 'published', 'cancelled_weather', 'completed']

export const TABLES = {
  // ── Cuentas (sustituyen a auth.users / auth.sessions / auth.mfa_factors de Supabase) ──
  users: { internal: true, cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['email', 'text', { nn: true, unique: true }],
    ['password_hash', 'text'],                    // pbkdf2$<iter>$<salt b64>$<hash b64> o bcrypt$<hash de Supabase>
    ['email_confirmed_at', 'ts'],
    ['last_sign_in_at', 'ts'],
    ['created_at', 'ts', { nn: true, def: NOW }],
    ['user_metadata', 'json', { nn: true, def: "'{}'" }],
    ['provider', 'text', { nn: true, def: "'email'" }],
    ['google_sub', 'text', { unique: true }],     // id de la cuenta de Google (acceso con Google, google.js)
  ] },
  sessions: { internal: true, cols: [
    ['id', 'text', { pk: true }],                 // SHA-256 del token de la cookie
    ['user_id', 'uuid', { nn: true, ref: 'users(id)', onDelete: 'CASCADE' }],
    ['aal', 'text', { nn: true, def: "'aal1'", check: ENUM('aal', ['aal1', 'aal2']) }],
    ['recovery', 'bool', { nn: true, def: '0' }],  // entró con el enlace de «nueva contraseña»
    ['created_at', 'ts', { nn: true, def: NOW }],
    ['last_seen_at', 'ts', { nn: true, def: NOW }],
    ['expires_at', 'ts', { nn: true }],
    ['ua', 'text'],
  ] },
  auth_tokens: { internal: true, cols: [
    ['id', 'text', { pk: true }],                 // SHA-256 del token del email
    ['user_id', 'uuid', { nn: true, ref: 'users(id)', onDelete: 'CASCADE' }],
    ['kind', 'text', { nn: true, check: ENUM('kind', ['confirm', 'recovery']) }],
    ['redirect', 'text'],
    ['created_at', 'ts', { nn: true, def: NOW }],
    ['expires_at', 'ts', { nn: true }],
    ['used_at', 'ts'],
  ] },
  mfa_factors: { internal: true, cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['user_id', 'uuid', { nn: true, ref: 'users(id)', onDelete: 'CASCADE' }],
    ['secret_enc', 'text', { nn: true }],         // secreto TOTP cifrado con AES-GCM (MFA_ENC_KEY)
    ['status', 'text', { nn: true, def: "'unverified'", check: ENUM('status', ['unverified', 'verified']) }],
    ['friendly_name', 'text'],
    ['last_step', 'int', { nn: true, def: '0' }], // último intervalo TOTP usado (evita reutilizar un código)
    ['created_at', 'ts', { nn: true, def: NOW }],
  ] },
  reauth_codes: { internal: true, cols: [            // código de 6 cifras para cambiar la contraseña (como reauthenticate de Supabase)
    ['user_id', 'uuid', { pk: true, ref: 'users(id)', onDelete: 'CASCADE' }],
    ['code_hash', 'text', { nn: true }],         // SHA-256 de user_id + código
    ['sent_at', 'ts', { nn: true, def: NOW }],
    ['expires_at', 'ts', { nn: true }],
    ['attempts', 'int', { nn: true, def: '0' }],
  ] },
  rate_limits: { internal: true, cols: [
    ['key', 'text', { pk: true }],
    ['window_start', 'int', { nn: true }],
    ['count', 'int', { nn: true, def: '0' }],
  ] },

  // ── Datos de la app (mismas columnas que en Supabase) ──
  destinations: { cols: [
    ['name', 'text', { pk: true }],
    ['province', 'text', { nn: true }],
    ['island_group', 'text', { nn: true }],
    ['lat', 'real', { nn: true }],
    ['lng', 'real', { nn: true }],
  ] },
  centers: { private: ['gcash_number', 'notes', 'review_note'], cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['name', 'text', { nn: true }],
    ['area', 'text', { nn: true, def: "'Panglao'" }],
    ['phone', 'text'],
    ['gcash_number', 'text'],
    ['default_divers_per_guide', 'int', { nn: true, def: '4', check: 'default_divers_per_guide BETWEEN 1 AND 10' }],
    ['created_at', 'ts', { nn: true, def: NOW }],
    ['locality', 'text'],
    ['website', 'text'],
    ['source_url', 'text'],
    ['lat', 'real'],
    ['lng', 'real'],
    ['location_precision', 'text', { nn: true, def: "'zona'", check: ENUM('location_precision', ['zona', 'exacta']) }],
    ['listing_status', 'text', { nn: true, def: "'directorio'", check: ENUM('listing_status', ['directorio', 'invitado', 'socio', 'cerrado']) }],
    ['notes', 'text'],
    ['destination', 'text', { ref: 'destinations(name)', onUpdate: 'CASCADE' }],
    ['province', 'text'],
    ['languages', 'json', { nn: true, def: "'[]'" }],
    ['course_languages', 'json', { nn: true, def: "'[]'" }],
    ['verification_status', 'text', { nn: true, def: "'unverified'", check: ENUM('verification_status', ['unverified', 'pending', 'verified', 'rejected', 'suspended']) }],
    ['claims_center_id', 'uuid', { ref: 'centers(id)' }],
    ['verified_at', 'ts'],
    ['review_note', 'text'],
    ['agencies', 'json', { nn: true, def: "'[]'" }],
    ['agency_detail', 'text'],
    ['directory_check', 'text'],
    ['checked_at', 'date'],
  ] },
  center_staff: { pk: ['center_id', 'user_id'], cols: [
    ['center_id', 'uuid', { nn: true, ref: 'centers(id)', onDelete: 'CASCADE' }],
    ['user_id', 'uuid', { nn: true, ref: 'users(id)', onDelete: 'CASCADE' }],
    ['role', 'text', { nn: true, def: "'manager'", check: ENUM('role', ['owner', 'manager']) }],
  ] },
  boats: { unique: [['center_id', 'name']], cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['center_id', 'uuid', { nn: true, ref: 'centers(id)', onDelete: 'CASCADE' }],
    ['name', 'text', { nn: true }],
    ['capacity', 'int', { nn: true, check: 'capacity BETWEEN 1 AND 60' }],
    ['active', 'bool', { nn: true, def: '1' }],
    ['show_to_divers', 'bool', { nn: true, def: '0' }],
  ] },
  dive_sites: { unique: [['area', 'name']], checks: ['max_depth_m IS NULL OR min_depth_m IS NULL OR max_depth_m >= min_depth_m'], cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['name', 'text', { nn: true }],
    ['area', 'text', { nn: true }],
    ['min_depth_m', 'int'],
    ['max_depth_m', 'int'],
    ['recommended_min', 'text', { nn: true, def: "'open_water'", check: ENUM('recommended_min', CERT_LEVELS) }],
    ['sanctuary_fee_php', 'int', { nn: true, def: '0', check: 'sanctuary_fee_php >= 0' }],
    ['province', 'text'],
    ['highlight', 'text'],
    ['highlight_es', 'text'],
  ] },
  trips: { cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['center_id', 'uuid', { nn: true, ref: 'centers(id)' }],
    ['boat_id', 'uuid', { nn: true, ref: 'boats(id)' }],
    ['departs_at', 'ts', { nn: true }],
    ['num_dives', 'int', { nn: true, def: '3', check: 'num_dives BETWEEN 1 AND 5' }],
    ['min_level', 'text', { nn: true, def: "'open_water'", check: ENUM('min_level', CERT_LEVELS) }],
    ['price_php', 'int', { nn: true, check: 'price_php > 0' }],
    ['gear_rental_php', 'int', { nn: true, def: '0', check: 'gear_rental_php >= 0' }],
    ['guides', 'int', { nn: true, def: '1', check: 'guides BETWEEN 1 AND 15' }],
    ['divers_per_guide', 'int', { nn: true, check: 'divers_per_guide BETWEEN 1 AND 10' }],
    ['seat_override', 'int', { check: 'seat_override >= 0' }],
    ['blocked_seats', 'int', { nn: true, def: '0', check: 'blocked_seats >= 0' }],
    ['status', 'text', { nn: true, def: "'draft'", check: ENUM('status', TRIP_STATUSES) }],
    ['created_at', 'ts', { nn: true, def: NOW }],
  ] },
  trip_sites: { pk: ['trip_id', 'position'], cols: [
    ['trip_id', 'uuid', { nn: true, ref: 'trips(id)', onDelete: 'CASCADE' }],
    ['site_id', 'uuid', { nn: true, ref: 'dive_sites(id)' }],
    ['position', 'int', { nn: true, check: 'position BETWEEN 1 AND 5' }],
  ] },
  divers: { cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['user_id', 'uuid', { unique: true, ref: 'users(id)', onDelete: 'SET NULL' }],
    ['full_name', 'text', { nn: true }],
    ['languages', 'json', { nn: true, def: "'[]'" }],
    ['logged_dives', 'int', { check: 'logged_dives >= 0' }],
    ['seeks_buddy', 'bool', { nn: true, def: '0' }],
    ['email', 'text'],
    ['avatar_url', 'text'],
    ['auth_provider', 'text'],
    ['locale', 'text'],
    ['account_type', 'text', { nn: true, def: "'diver'", check: ENUM('account_type', ['diver', 'center']) }],
    ['country', 'text', { check: 'length(country) <= 60' }],
    ['bio', 'text', { check: 'length(bio) <= 160' }],
    ['show_on_trips', 'bool', { nn: true, def: '1' }],
    // Perfil de buceo para el centro y resultado del cuestionario médico (migración 031)
    ['wetsuit_size', 'text', { check: ENUM('wetsuit_size', ['XS', 'S', 'M', 'L', 'XL', 'XXL']) }],
    ['bcd_size', 'text', { check: ENUM('bcd_size', ['XS', 'S', 'M', 'L', 'XL', 'XXL']) }],
    ['fin_size', 'text', { check: 'length(fin_size) <= 12' }],
    ['last_dive_date', 'date'],
    ['nitrox', 'bool', { nn: true, def: '0' }],
    ['medical_done_at', 'date'],
    ['medical_result', 'text', { check: ENUM('medical_result', ['all_no', 'physician_ok']) }],
    // Valoraciones entre buddies (migración 032): el buceador decide si le pueden valorar
    ['buddy_ratings_enabled', 'bool', { nn: true, def: '0' }],
  ] },
  certifications: { cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['diver_id', 'uuid', { nn: true, ref: 'divers(id)', onDelete: 'CASCADE' }],
    ['agency', 'text', { nn: true }],
    ['level', 'text', { nn: true, check: ENUM('level', CERT_LEVELS) }],
    ['card_number', 'text'],
    ['photo_path', 'text'],
    ['verified_by', 'uuid', { ref: 'centers(id)' }],
    ['verified_at', 'ts'],
  ] },
  bookings: { checks: [
    "(source = 'app' AND diver_id IS NOT NULL) OR (source <> 'app' AND guest_name IS NOT NULL)",
    "source = 'app' OR commission_php = 0",
  ], cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['trip_id', 'uuid', { nn: true, ref: 'trips(id)' }],
    ['diver_id', 'uuid', { ref: 'divers(id)' }],
    ['guest_name', 'text'],
    ['seats', 'int', { nn: true, check: 'seats BETWEEN 1 AND 20' }],
    ['with_gear', 'bool', { nn: true, def: '0' }],
    ['source', 'text', { nn: true, def: "'app'", check: ENUM('source', BOOKING_SOURCES) }],
    ['status', 'text', { nn: true, def: "'pending_payment'", check: ENUM('status', BOOKING_STATUSES) }],
    ['amount_php', 'int', { nn: true, def: '0', check: 'amount_php >= 0' }],
    ['commission_php', 'int', { nn: true, def: '0', check: 'commission_php >= 0' }],
    ['refund_php', 'int', { nn: true, def: '0', check: 'refund_php >= 0' }],
    ['medical_signed', 'bool', { nn: true, def: '0' }],
    ['created_at', 'ts', { nn: true, def: NOW }],
    ['paid_at', 'ts'],
    ['cancelled_at', 'ts'],
    ['paid_php', 'int', { nn: true, def: '0', check: 'paid_php >= 0' }],
    ['deposit_php', 'int', { nn: true, def: '0', check: 'deposit_php >= 0' }],
    ['hold_until', 'ts'],
    ['balance_paid_at', 'ts'],
    ['checked_in_at', 'ts'],
  ] },
  payments: { cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['booking_id', 'uuid', { nn: true, ref: 'bookings(id)' }],
    ['kind', 'text', { nn: true, check: ENUM('kind', ['deposit', 'full', 'balance']) }],
    ['method', 'text', { nn: true, check: ENUM('method', ['card', 'gcash', 'cash', 'demo']) }],
    ['amount_php', 'int', { nn: true, check: 'amount_php > 0' }],
    ['status', 'text', { nn: true, def: "'pending'", check: ENUM('status', ['pending', 'paid', 'failed', 'expired']) }],
    ['provider', 'text', { nn: true, def: "'paymongo'", check: ENUM('provider', ['paymongo', 'cash', 'demo']) }],
    ['provider_ref', 'text', { unique: true }],
    ['checkout_url', 'text'],
    ['recorded_by', 'uuid'],
    ['created_at', 'ts', { nn: true, def: NOW }],
    ['paid_at', 'ts'],
  ] },
  dive_logs: { cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['diver_id', 'uuid', { nn: true, ref: 'divers(id)', onDelete: 'CASCADE' }],
    ['booking_id', 'uuid', { ref: 'bookings(id)', onDelete: 'SET NULL' }],
    ['center_id', 'uuid', { ref: 'centers(id)', onDelete: 'SET NULL' }],
    ['site_id', 'uuid', { ref: 'dive_sites(id)', onDelete: 'SET NULL' }],
    ['site_name', 'text'],
    ['dive_date', 'date', { nn: true }],
    ['entry_time', 'time'],
    ['max_depth_m', 'real', { check: 'max_depth_m BETWEEN 0 AND 350' }],
    ['avg_depth_m', 'real', { check: 'avg_depth_m BETWEEN 0 AND 350' }],
    ['duration_min', 'int', { check: 'duration_min BETWEEN 0 AND 600' }],
    ['water_temp_c', 'real'],
    ['visibility_m', 'int', { check: 'visibility_m BETWEEN 0 AND 100' }],
    ['gas', 'text', { nn: true, def: "'air'", check: ENUM('gas', ['air', 'nitrox', 'trimix']) }],
    ['o2_pct', 'int', { check: 'o2_pct BETWEEN 21 AND 100' }],
    ['tank_start_bar', 'int', { check: 'tank_start_bar BETWEEN 0 AND 350' }],
    ['tank_end_bar', 'int', { check: 'tank_end_bar BETWEEN 0 AND 350' }],
    ['weights_kg', 'real'],
    ['suit', 'text'],
    ['buddy', 'text'],
    ['conditions', 'text'],
    ['marine_life', 'text'],
    ['rating', 'int', { check: 'rating BETWEEN 1 AND 5' }],
    ['notes', 'text'],
    ['share_with_center', 'bool', { nn: true, def: '0' }],
    ['created_at', 'ts', { nn: true, def: NOW }],
    ['updated_at', 'ts', { nn: true, def: NOW }],
  ] },
  dive_log_photos: { cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['log_id', 'uuid', { nn: true, ref: 'dive_logs(id)', onDelete: 'CASCADE' }],
    ['path', 'text', { nn: true }],
    ['caption', 'text'],
    ['created_at', 'ts', { nn: true, def: NOW }],
  ] },
  // Valoraciones entre buddies (migración 032): solo por RPC; cada uno lee solo las que ha dado
  buddy_ratings: { unique: [['trip_id', 'rater_id', 'rated_id']], checks: ['rater_id <> rated_id', 'coalesce(buoyancy, air, awareness, safety, reef) IS NOT NULL'], cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['trip_id', 'uuid', { nn: true, ref: 'trips(id)', onDelete: 'CASCADE' }],
    ['rater_id', 'uuid', { nn: true, ref: 'divers(id)', onDelete: 'CASCADE' }],
    ['rated_id', 'uuid', { nn: true, ref: 'divers(id)', onDelete: 'CASCADE' }],
    ['buoyancy', 'int', { check: 'buoyancy BETWEEN 1 AND 5' }],
    ['air', 'int', { check: 'air BETWEEN 1 AND 5' }],
    ['awareness', 'int', { check: 'awareness BETWEEN 1 AND 5' }],
    ['safety', 'int', { check: 'safety BETWEEN 1 AND 5' }],
    ['reef', 'int', { check: 'reef BETWEEN 1 AND 5' }],
    ['dive_again', 'bool'],
    ['created_at', 'ts', { nn: true, def: NOW }],
  ] },
  platform_admins: { cols: [
    ['user_id', 'uuid', { pk: true, ref: 'users(id)', onDelete: 'CASCADE' }],
    ['created_at', 'ts', { nn: true, def: NOW }],
  ] },
  admin_audit: { cols: [
    ['id', 'int', { pk: true }],                  // INTEGER PRIMARY KEY = autoincremental en SQLite
    ['at', 'ts', { nn: true, def: NOW }],
    ['actor', 'uuid'],
    ['action', 'text', { nn: true }],
    ['target', 'uuid'],
    ['detail', 'json'],
  ] },
  app_config: { cols: [
    ['key', 'text', { pk: true }],
    ['value', 'text', { nn: true }],
  ] },
  center_verifications: { cols: [
    ['center_id', 'uuid', { pk: true, ref: 'centers(id)', onDelete: 'CASCADE' }],
    ['legal_name', 'text'], ['business_reg_type', 'text'], ['business_reg_number', 'text'], ['mayors_permit_number', 'text'],
    ['owner_name', 'text'], ['owner_role', 'text'], ['contact_email', 'text'], ['contact_phone', 'text'], ['address', 'text'],
    ['agency', 'text'], ['agency_number', 'text'], ['social_url', 'text'], ['years_operating', 'int'], ['notes', 'text'],
    ['submitted_at', 'ts'], ['reviewed_at', 'ts'], ['reviewed_by', 'uuid'],
    ['updated_at', 'ts', { nn: true, def: NOW }],
  ] },
  center_documents: { cols: [
    ['id', 'uuid', { pk: true, def: UUID }],
    ['center_id', 'uuid', { nn: true, ref: 'centers(id)', onDelete: 'CASCADE' }],
    ['kind', 'text', { nn: true, check: ENUM('kind', ['business_permit', 'dti_sec', 'owner_id', 'agency_cert', 'shop_photo', 'other']) }],
    ['path', 'text', { nn: true }],
    ['file_name', 'text'],
    ['created_at', 'ts', { nn: true, def: NOW }],
  ] },
}

// Una reserva ocupa plaza si está confirmada o pendiente de pago dentro de su retención (15 min o hold_until)
export const HOLDS = (b) => `(${b}.status = 'confirmed' OR (${b}.status = 'pending_payment' AND max(strftime('%Y-%m-%dT%H:%M:%fZ', ${b}.created_at, '+15 minutes'), coalesce(${b}.hold_until, '')) > ${NOW}))`
// Plazas operativas: barco, guías × buceadores por guía y tope manual
export const OPERATIVE = (t) => `max(0, min((SELECT capacity FROM boats WHERE id = ${t}.boat_id), ${t}.guides * ${t}.divers_per_guide, coalesce(${t}.seat_override, 32767)))`
const SUM_HOLD = (t, cond) => `(SELECT coalesce(sum(b.seats), 0) FROM bookings b WHERE b.trip_id = ${t}.id AND ${cond} AND ${HOLDS('b')})`
export const APP_AVAILABLE = (t) => `(CASE WHEN ${t}.status <> 'published' THEN 0 ELSE max(0, ${OPERATIVE(t)} - max(${t}.blocked_seats, ${SUM_HOLD(t, "b.source <> 'app'")}) - ${SUM_HOLD(t, "b.source = 'app'")}) END)`
export const BOOKED = (t) => SUM_HOLD(t, '1')

// Vistas (solo lectura)
export const VIEWS = {
  published_trips: {
    cols: [['id', 'uuid'], ['center_id', 'uuid'], ['departs_at', 'ts'], ['num_dives', 'int'], ['min_level', 'text'], ['price_php', 'int'],
      ['gear_rental_php', 'int'], ['center_name', 'text'], ['boat_name', 'text'], ['sites', 'json'], ['available_seats', 'int'],
      ['center_area', 'text'], ['center_locality', 'text'], ['center_lat', 'real'], ['center_lng', 'real'], ['booked_seats', 'int'],
      ['center_destination', 'text'], ['center_province', 'text'], ['center_languages', 'json'], ['center_agencies', 'json'], ['center_course_languages', 'json']],
    sql: `SELECT t.id, t.center_id, t.departs_at, t.num_dives, t.min_level, t.price_php, t.gear_rental_php, c.name AS center_name,
  CASE WHEN bo.show_to_divers THEN bo.name END AS boat_name,
  (SELECT json_group_array(name) FROM (SELECT ds.name FROM trip_sites ts JOIN dive_sites ds ON ds.id = ts.site_id WHERE ts.trip_id = t.id ORDER BY ts.position)) AS sites,
  ${APP_AVAILABLE('t')} AS available_seats,
  c.area AS center_area, c.locality AS center_locality, c.lat AS center_lat, c.lng AS center_lng,
  ${BOOKED('t')} AS booked_seats,
  c.destination AS center_destination, c.province AS center_province, c.languages AS center_languages, c.agencies AS center_agencies, c.course_languages AS center_course_languages
FROM trips t JOIN centers c ON c.id = t.center_id JOIN boats bo ON bo.id = t.boat_id
WHERE t.status = 'published' AND c.verification_status = 'verified'`,
  },
}

export const INDEXES = [
  'CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id)',
  'CREATE INDEX IF NOT EXISTS mfa_user ON mfa_factors(user_id)',
  'CREATE INDEX IF NOT EXISTS centers_destination ON centers(destination)',
  'CREATE INDEX IF NOT EXISTS centers_status ON centers(verification_status, listing_status)',
  'CREATE INDEX IF NOT EXISTS staff_user ON center_staff(user_id)',
  'CREATE INDEX IF NOT EXISTS boats_center ON boats(center_id)',
  'CREATE INDEX IF NOT EXISTS trips_center_departs ON trips(center_id, departs_at)',
  'CREATE INDEX IF NOT EXISTS trips_status_departs ON trips(status, departs_at)',
  'CREATE INDEX IF NOT EXISTS trip_sites_site ON trip_sites(site_id)',
  'CREATE INDEX IF NOT EXISTS bookings_trip ON bookings(trip_id)',
  'CREATE INDEX IF NOT EXISTS bookings_diver ON bookings(diver_id)',
  'CREATE INDEX IF NOT EXISTS payments_booking ON payments(booking_id)',
  'CREATE INDEX IF NOT EXISTS certs_diver ON certifications(diver_id)',
  'CREATE INDEX IF NOT EXISTS logs_diver ON dive_logs(diver_id, dive_date)',
  'CREATE INDEX IF NOT EXISTS buddy_rated ON buddy_ratings(rated_id)',
  'CREATE INDEX IF NOT EXISTS buddy_rater ON buddy_ratings(rater_id)',
  'CREATE INDEX IF NOT EXISTS logs_center ON dive_logs(center_id)',
  'CREATE INDEX IF NOT EXISTS photos_log ON dive_log_photos(log_id)',
  'CREATE INDEX IF NOT EXISTS docs_center ON center_documents(center_id)',
  'CREATE INDEX IF NOT EXISTS audit_at ON admin_audit(at)',
]

// Relaciones para incrustar tablas en un select: tabla.columna → tabla(col)
export const FKS = []
for (const [t, def] of Object.entries(TABLES)) {
  for (const [c, , o = {}] of def.cols) if (o.ref) { const [, rt, rc] = o.ref.match(/^(\w+)\((\w+)\)$/); FKS.push({ from: t, col: c, to: rt, toCol: rc }) }
}

// Tipo de cada columna (tablas y vistas)
export const TYPES = {}
for (const [t, def] of [...Object.entries(TABLES), ...Object.entries(VIEWS)]) TYPES[t] = Object.fromEntries(def.cols.map(([c, ty]) => [c, ty]))
export const pkOf = (t) => TABLES[t]?.pk || [TABLES[t]?.cols.find(([, , o]) => o?.pk)?.[0]].filter(Boolean)

// SQL completo (lo usa gen-schema.mjs y las pruebas)
export function schemaSql() {
  const out = ['-- Generado por worker/gen-schema.mjs a partir de worker/schema.js. No editar a mano.', 'PRAGMA foreign_keys = ON;']
  const SQLT = { uuid: 'TEXT', text: 'TEXT', int: 'INTEGER', real: 'REAL', bool: 'INTEGER', json: 'TEXT', ts: 'TEXT', date: 'TEXT', time: 'TEXT' }
  for (const [t, def] of Object.entries(TABLES)) {
    const lines = def.cols.map(([c, ty, o = {}]) => {
      let s = `  ${c} ${SQLT[ty]}`
      if (o.pk && !def.pk) s += ' PRIMARY KEY'
      if (o.nn) s += ' NOT NULL'
      if (o.unique) s += ' UNIQUE'
      if (o.def) s += ` DEFAULT ${o.def}`
      if (o.check) s += ` CHECK (${o.check})`
      if (o.ref) s += ` REFERENCES ${o.ref}${o.onDelete ? ' ON DELETE ' + o.onDelete : ''}${o.onUpdate ? ' ON UPDATE ' + o.onUpdate : ''}`
      return s
    })
    if (def.pk) lines.push(`  PRIMARY KEY (${def.pk.join(', ')})`)
    for (const u of def.unique || []) lines.push(`  UNIQUE (${u.join(', ')})`)
    for (const c of def.checks || []) lines.push(`  CHECK (${c})`)
    out.push(`CREATE TABLE IF NOT EXISTS ${t} (\n${lines.join(',\n')}\n);`)
  }
  for (const [v, def] of Object.entries(VIEWS)) out.push(`DROP VIEW IF EXISTS ${v};\nCREATE VIEW ${v} AS\n${def.sql};`)
  out.push(...INDEXES.map((i) => i + ';'))
  out.push("INSERT OR IGNORE INTO app_config (key, value) VALUES ('payments_mode', 'demo'), ('deposit_pct', '50');")
  return out.join('\n\n') + '\n'
}
