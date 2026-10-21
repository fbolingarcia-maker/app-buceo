// Datos de ejemplo para probar la app contra el Worker (e2e.mjs). Contraseña de todas las cuentas: Clave1234
import { hashPassword } from '../lib/crypto.js'

export async function seed(db) {
  const pw = await hashPassword('Clave1234', 1000)
  const now = Date.now(), H = 36e5, D = 24 * H
  const iso = (ms) => new Date(ms).toISOString()
  const day0 = Date.parse(new Date(now + 8 * H).toISOString().slice(0, 10) + 'T00:00:00+08:00')
  const conf = iso(now - 30 * D)
  const U = { admin: 'u-admin', centro: 'u-centro', nuevo: 'u-nuevo', buzo: 'u-buzo', otro: 'u-otro' }
  const s = []
  const q = (sql, ...p) => s.push(db.prepare(sql).bind(...p))
  for (const [k, id] of Object.entries(U)) {
    q('INSERT INTO users (id, email, password_hash, email_confirmed_at, last_sign_in_at, created_at, user_metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, `${k}@diveslot.test`, pw, conf, iso(now - D), conf, JSON.stringify(k === 'nuevo' ? { account_type: 'center', center_name: 'Nuevo Centro' } : {}))
  }
  q("INSERT INTO destinations VALUES ('Panglao', 'Bohol', 'Visayas', 9.55, 123.77), ('Moalboal', 'Cebu', 'Visayas', 9.95, 123.4)")
  q(`INSERT INTO dive_sites (id, name, area, province, min_depth_m, max_depth_m, recommended_min, highlight, highlight_es) VALUES
    ('s1', 'Napaling', 'Panglao', 'Bohol', 5, 25, 'open_water', 'Sardines', 'Sardinas'),
    ('s2', 'Balicasag – Black Forest', 'Panglao', 'Bohol', 8, 40, 'advanced', 'Black coral', 'Coral negro'),
    ('s3', 'Alona House Reef', 'Panglao', 'Bohol', 3, 14, 'open_water', 'Night dive', 'Nocturna')`)
  q(`INSERT INTO centers (id, name, area, destination, province, listing_status, verification_status, verified_at, phone, website, lat, lng, languages, course_languages, agencies, gcash_number, created_at) VALUES
    ('c1', 'Casa Azul Divers', 'Panglao', 'Panglao', 'Bohol', 'socio', 'verified', ?, '+63 912 000 0001', 'https://casaazul.example', 9.55, 123.77, '["es","en"]', '["es"]', '["PADI","SSI"]', '0917 000', ?),
    ('c2', 'Napaling Dive Co.', 'Panglao', 'Panglao', 'Bohol', 'directorio', 'unverified', NULL, '+63 912 000 0002', NULL, 9.56, 123.75, '["en"]', '[]', '["padi"]', NULL, ?),
    ('c3', 'Moalboal Reef Divers', 'Moalboal', 'Moalboal', 'Cebu', 'directorio', 'unverified', NULL, NULL, NULL, 9.95, 123.4, '[]', '[]', '[]', NULL, ?),
    ('c4', 'Nuevo Centro', 'Panglao', 'Panglao', 'Bohol', 'socio', 'unverified', NULL, '+63 912 000 0004', NULL, NULL, NULL, '[]', '[]', '[]', NULL, ?)`,
  conf, conf, conf, conf, conf)
  q("INSERT INTO center_staff VALUES ('c1', ?, 'owner'), ('c4', ?, 'owner')", U.centro, U.nuevo)
  q('INSERT INTO platform_admins (user_id) VALUES (?)', U.admin)
  q("INSERT INTO admin_audit (actor, action, target, detail) VALUES (?, 'center_status', 'c1', ?)", U.admin, JSON.stringify({ name: 'Casa Azul Divers', from: 'pending', to: 'verified', note: null }))
  q(`INSERT INTO divers (id, user_id, full_name, email, account_type, languages, country, bio, logged_dives, show_on_trips) VALUES
    ('d-admin', ?, 'Admin DiveSlot', 'admin@diveslot.test', 'diver', '[]', NULL, NULL, NULL, 0),
    ('d-centro', ?, 'Ana Centro', 'centro@diveslot.test', 'center', '["es"]', 'España', NULL, NULL, 1),
    ('d-nuevo', ?, 'Nico Nuevo', 'nuevo@diveslot.test', 'center', '[]', NULL, NULL, NULL, 1),
    ('d-buzo', ?, 'Bea Buceadora López', 'buzo@diveslot.test', 'diver', '["es","en"]', 'España', 'Fotografía macro', 40, 1),
    ('d-otro', ?, 'Omar Otro', 'otro@diveslot.test', 'diver', '["en"]', 'Philippines', NULL, 12, 1)`, U.admin, U.centro, U.nuevo, U.buzo, U.otro)
  q("INSERT INTO certifications (id, diver_id, agency, level, card_number) VALUES ('ce1', 'd-buzo', 'PADI', 'advanced', 'P-123'), ('ce2', 'd-otro', 'SSI', 'open_water', NULL)")
  q("INSERT INTO boats (id, center_id, name, capacity, show_to_divers) VALUES ('b1', 'c1', 'Banca Azul', 12, 1), ('b4', 'c4', 'Banca Nueva', 8, 0)")
  for (let d = 0; d < 8; d++) {
    q(`INSERT INTO trips (id, center_id, boat_id, departs_at, num_dives, min_level, price_php, gear_rental_php, guides, divers_per_guide, status) VALUES
      (?, 'c1', 'b1', ?, 3, 'open_water', 2900, 600, 2, 4, 'published'), (?, 'c1', 'b1', ?, 2, 'advanced', 3500, 600, 1, 4, 'published')`,
    `t1-${d}`, iso(day0 + d * D + 7.5 * H), `t2-${d}`, iso(day0 + d * D + 13.5 * H))
    q("INSERT INTO trip_sites VALUES (?, 's1', 1), (?, 's3', 2), (?, 's2', 1)", `t1-${d}`, `t1-${d}`, `t2-${d}`)
  }
  q("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, status) VALUES ('t-past', 'c1', 'b1', ?, 2900, 4, 'completed'), ('t-draft', 'c4', 'b4', ?, 2500, 4, 'draft')", iso(day0 - 3 * D + 7.5 * H), iso(day0 + 2 * D + 8 * H))
  q("INSERT INTO trip_sites VALUES ('t-past', 's1', 1)")
  q(`INSERT INTO bookings (id, trip_id, diver_id, guest_name, seats, with_gear, source, status, amount_php, commission_php, deposit_php, paid_php, medical_signed, created_at, hold_until, paid_at) VALUES
    ('bk1', 't1-1', 'd-buzo', NULL, 1, 0, 'app', 'pending_payment', 2900, 250, 1450, 0, 1, ?, ?, NULL),
    ('bk2', 't1-3', 'd-buzo', NULL, 2, 1, 'app', 'confirmed', 7000, 500, 3500, 3500, 1, ?, NULL, ?),
    ('bk3', 't-past', 'd-buzo', NULL, 1, 0, 'app', 'confirmed', 2900, 250, 1450, 2900, 1, ?, NULL, ?),
    ('bk4', 't1-1', NULL, 'Juan WhatsApp', 2, 0, 'whatsapp', 'confirmed', 5800, 0, 0, 0, 0, ?, NULL, NULL),
    ('bk5', 't1-3', 'd-otro', NULL, 1, 0, 'app', 'confirmed', 2900, 250, 1450, 1450, 1, ?, NULL, ?)`,
  iso(now - 5 * 60e3), iso(now + 10 * 60e3), iso(now - 2 * D), iso(now - 2 * D), iso(now - 6 * D), iso(now - 6 * D), iso(now - D), iso(now - D), iso(now - D))
  q(`INSERT INTO payments (id, booking_id, kind, method, amount_php, status, provider, created_at, paid_at) VALUES
    ('p1', 'bk2', 'deposit', 'demo', 3500, 'paid', 'demo', ?, ?), ('p2', 'bk3', 'full', 'cash', 2900, 'paid', 'cash', ?, ?), ('p3', 'bk5', 'deposit', 'gcash', 1450, 'paid', 'paymongo', ?, ?)`,
  iso(now - 2 * D), iso(now - 2 * D), iso(now - 3 * D), iso(now - 3 * D), iso(now - D), iso(now - D))
  q(`INSERT INTO dive_logs (id, diver_id, booking_id, center_id, site_id, site_name, dive_date, entry_time, max_depth_m, avg_depth_m, duration_min, water_temp_c, rating, marine_life, share_with_center) VALUES
    ('lg1', 'd-buzo', 'bk3', 'c1', 's1', 'Napaling', ?, '08:10', 24, 14, 52, 28, 5, 'Sardinas, tortugas', 1),
    ('lg2', 'd-buzo', NULL, 'c1', 's2', 'Balicasag – Black Forest', ?, '10:30', 31, 19, 45, 28, 4, NULL, 1),
    ('lg3', 'd-buzo', NULL, NULL, NULL, 'Doljo Point', ?, '09:00', 22, NULL, 50, NULL, NULL, NULL, 0)`,
  iso(day0 - 3 * D).slice(0, 10), iso(day0 - 10 * D).slice(0, 10), iso(day0 - 40 * D).slice(0, 10))
  q(`INSERT INTO center_verifications (center_id, legal_name, owner_name, contact_email, contact_phone, address, mayors_permit_number) VALUES ('c4', 'Nuevo Centro Inc', 'Nico', 'nuevo@diveslot.test', '+63', 'Alona Beach', 'MP-9')`)
  await db.batch(s)
  return U
}
