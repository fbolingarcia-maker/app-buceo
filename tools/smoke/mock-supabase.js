// Supabase simulado para pruebas de humo (sin red). Rol en localStorage 'mockRole': anon|diver|center|centerv|admin
const rawRole = (() => { try { return localStorage.getItem('mockRole') || 'anon' } catch { return 'anon' } })()
// admind / adminc: administrador en «Ver como buceador / centro»; mfa: buceador al que le falta el código de dos pasos
try {
  if (rawRole.startsWith('admin')) localStorage.setItem('adminView', rawRole === 'admind' ? 'diver' : rawRole === 'adminc' ? 'center' : 'admin')
  if (rawRole === 'adminc') localStorage.setItem('adminCenter', '4ec918c7-1b17-477e-acb7-2c33276224ac'); else localStorage.removeItem('adminCenter')
} catch { /* sin almacenamiento */ }
// vacio: visitante sin sesión en una semana sin salidas publicadas
const role = rawRole.startsWith('admin') ? 'admin' : rawRole === 'mfa' ? 'diver' : rawRole === 'vacio' ? 'anon' : rawRole
const H = 3600e3, D = 24 * H
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const day0 = Math.floor((now + 8 * H) / D) * D - 8 * H // medianoche Manila
const C1 = '4ec918c7-1b17-477e-acb7-2c33276224ac', C2 = 'b8a7b4ba-bf90-4534-a87f-57852c72d6c7', MY = '0f71356a-b6a2-4846-8855-8a7f8956ade4'
const UID = '03a20db7-3776-4425-b95c-56f2144b5cee'
const pubTrips = []
for (let d = 0; d < 8; d++) {
  pubTrips.push({ id: 't1-' + d, center_id: C1, departs_at: iso(day0 + d * D + 7.5 * H), num_dives: 3, min_level: 'open_water', price_php: 5800, gear_rental_php: 800, center_name: 'Demo · Centro Alona', boat_name: d % 2 ? 'Banca Uno' : null, sites: ['Balicasag – Black Forest', 'Pamilacan'], available_seats: d === 2 ? 0 : 10, center_area: 'Panglao', center_locality: 'Alona Beach', center_lat: 9.5487, center_lng: 123.7745, booked_seats: d % 3, center_destination: 'Panglao', center_province: 'Bohol', center_languages: ['en', 'es'], center_agencies: ['PADI'], center_course_languages: ['en', 'es'] })
  // Más horarios del mismo centro: última plaza (Advanced) y completa (Divemaster)
  pubTrips.push({ ...pubTrips[pubTrips.length - 1], id: 't3-' + d, departs_at: iso(day0 + d * D + 13.5 * H), min_level: 'advanced', price_php: 6200, available_seats: 1, booked_seats: 5 })
  pubTrips.push({ ...pubTrips[pubTrips.length - 1], id: 't4-' + d, departs_at: iso(day0 + d * D + 18 * H), min_level: 'divemaster', price_php: 3500, available_seats: 0, booked_seats: 6, sites: ['Alona House Reef'] })
  pubTrips.push({ id: 't2-' + d, center_id: C2, departs_at: iso(day0 + d * D + 13.5 * H), num_dives: 2, min_level: 'advanced', price_php: 4500, gear_rental_php: 0, center_name: 'Demo · Centro Danao', boat_name: null, sites: [], available_seats: 2, center_area: 'Panglao', center_locality: 'Danao', center_lat: 9.553, center_lng: 123.79, booked_seats: 4, center_destination: 'Panglao', center_province: 'Bohol', center_languages: ['en', 'tl'], center_agencies: ['SSI'], center_course_languages: ['en'] })
}
const centerRow = (st) => ({ id: MY, name: 'PRUEBA', area: 'Panglao', destination: 'Panglao', province: 'Bohol', phone: '+63 900', lat: null, lng: null, languages: [], course_languages: [], agencies: [], verification_status: st, listing_status: 'socio', review_note: st === 'rejected' ? 'Documento ilegible' : null, default_divers_per_guide: 4, created_at: iso(now - 3 * D) })
const myCenter = role === 'center' ? centerRow('unverified') : role === 'centerv' || role === 'admin' ? centerRow('verified') : role === 'centerr' ? centerRow('rejected') : null
const diverRow = role === 'anon' ? null : { id: 'dv1', user_id: UID, full_name: 'Fernando B', account_type: myCenter ? 'center' : 'diver', languages: ['es'], logged_dives: 40, country: 'España', bio: '', seeks_buddy: false, show_on_trips: true, buddy_ratings_enabled: rawRole !== 'vacio', wetsuit_size: 'M', bcd_size: 'L', fin_size: '42', last_dive_date: '2025-06-10', nitrox: true, medical_done_at: null, medical_result: null }
const booking = (id, st, paid, ci) => ({ id, status: st, seats: 1, amount_php: 5800, deposit_php: 2900, paid_php: paid, with_gear: false, source: 'app', checked_in_at: ci, created_at: iso(now - H), guest_name: null, divers: { full_name: 'Ana López', logged_dives: 25, languages: 'es', wetsuit_size: 'S', bcd_size: 'S', fin_size: '38', last_dive_date: '2026-09-20', nitrox: false, medical_done_at: '2026-03-01', medical_result: 'all_no', certifications: [{ id: 'c1', agency: 'PADI', level: 'advanced', verified_at: null }] } })
const myTrips = myCenter ? [0, 1, 2].map((d) => ({ id: 'mt' + d, center_id: MY, boat_id: 'b1', departs_at: iso(day0 + d * D + 7.5 * H), num_dives: 3, min_level: 'open_water', price_php: 5800, gear_rental_php: 800, guides: 2, divers_per_guide: 4, seat_override: null, blocked_seats: 0, status: d === 2 ? 'draft' : 'published', boats: { name: 'Banca Uno', capacity: 12 }, trip_sites: [{ position: 1, dive_sites: { name: 'Napaling' } }], bookings: d === 0 ? [booking('bk1', 'confirmed', 5800, null), booking('bk2', 'pending_payment', 0, null)] : [] })) : []
const T = {
  published_trips: rawRole === 'vacio' ? [] : pubTrips,
  destinations: [{ name: 'Panglao', province: 'Bohol', island_group: 'Visayas', lat: 9.58, lng: 123.75 }, { name: 'Moalboal', province: 'Cebu', island_group: 'Visayas', lat: 9.94, lng: 123.39 }, { name: 'Apo Reef', province: 'Occidental Mindoro', island_group: 'Mindoro', lat: 12.66, lng: 120.43 }],
  dive_sites: [{ id: 's1', name: 'Napaling', area: 'Panglao', province: 'Bohol', max_depth_m: 25, min_depth_m: 5, recommended_min: 'open_water', highlight: 'Sardines', highlight_es: 'Sardinas' },
    { id: 's2', name: 'Balicasag – Black Forest', area: 'Panglao', province: 'Bohol', max_depth_m: 40, min_depth_m: 8, recommended_min: 'advanced', highlight: 'Black coral, jacks', highlight_es: 'Coral negro, jureles' },
    { id: 's3', name: 'Alona House Reef', area: 'Panglao', province: 'Bohol', max_depth_m: 14, min_depth_m: 3, recommended_min: 'open_water', highlight: 'Night dive', highlight_es: 'Inmersión nocturna' },
    { id: 's4', name: 'Balicasag – Turtle Point', area: 'Balicasag', province: 'Bohol', max_depth_m: 25, min_depth_m: 5, recommended_min: 'open_water', highlight: 'Turtles', highlight_es: 'Tortugas' },
    { id: 's5', name: 'Pescador Island', area: 'Moalboal', province: 'Cebu', max_depth_m: 30, min_depth_m: 5, recommended_min: 'open_water', highlight: 'Sardines and wall', highlight_es: 'Sardinas y pared' },
    { id: 's6', name: 'Shark Ridge', area: 'Apo Reef', province: 'Occidental Mindoro', max_depth_m: 40, min_depth_m: 5, recommended_min: 'advanced', highlight: 'Reef sharks', highlight_es: 'Tiburones de arrecife' }],
  centers: [{ id: C1, name: 'Demo · Centro Alona', area: 'Panglao', destination: 'Panglao', province: 'Bohol', listing_status: 'socio', verification_status: 'verified', languages: ['en', 'es'], course_languages: ['es'], agencies: ['PADI', 'SSI'], agency_detail: 'PADI 5★ IDC', phone: '+63 912', website: 'https://example.com', lat: 9.5, lng: 123.7, location_precision: 'zona' },
    { id: 'dir1', name: 'Directorio Divers', area: 'Moalboal', destination: 'Moalboal', province: 'Cebu', listing_status: 'directorio', verification_status: 'unverified', languages: [], agencies: ['SSI'], source_url: 'https://example.org' },
    ...(role === 'admin' ? [{ ...centerRow('pending'), id: 'pend1', name: 'Nuevo Centro Pendiente', claims_center_id: 'dir1' }] : [])],
  divers: diverRow ? [diverRow] : [],
  center_staff: myCenter ? [{ role: 'owner', centers: myCenter }] : [],
  certifications: role === 'diver' ? [{ id: 'c1', level: 'open_water', agency: 'PADI', card_number: null, verified_at: null }] : [],
  boats: myCenter ? [{ id: 'b1', name: 'Banca Uno', capacity: 12, active: true, show_to_divers: false, center_id: MY }] : [],
  trips: myTrips,
  bookings: role === 'diver' ? [
    { ...booking('bk9', 'pending_payment', 0, null), trip_id: 't1-1', hold_until: iso(now + 10 * 60e3), trips: { departs_at: iso(day0 + D + 7.5 * H), num_dives: 3, status: 'published', centers: { name: 'Demo · Centro Alona', phone: '+63 912', destination: 'Panglao' }, boats: { name: 'Banca', show_to_divers: false } } },
    { ...booking('bk8', 'confirmed', 2900, null), trip_id: 't1-3', trips: { departs_at: iso(day0 + 3 * D + 7.5 * H), num_dives: 3, status: 'published', centers: { name: 'Demo · Centro Alona', phone: '+63 912', destination: 'Panglao' }, boats: { name: 'Banca', show_to_divers: true } } },
    { ...booking('bk6', 'confirmed', 5800, null), trip_id: 't1-x', trips: { departs_at: iso(day0 - 2 * D + 7.5 * H), num_dives: 2, status: 'completed', centers: { name: 'Demo · Centro Alona', phone: '+63 912', destination: 'Panglao' }, boats: null } },
    { ...booking('bk7', 'cancelled_by_center', 2900, null), trip_id: 't2-4', refund_php: 2900, trips: { departs_at: iso(day0 + 4 * D + 13.5 * H), num_dives: 2, status: 'cancelled_weather', centers: { name: 'Demo · Centro Danao', phone: '+63 913', destination: 'Panglao' }, boats: null } },
  ] : [],
  app_config: [{ key: 'payments_mode', value: 'demo' }],
  center_verifications: role === 'admin' ? [{ center_id: 'pend1', legal_name: 'Nuevo SA', owner_name: 'Juan', contact_email: 'j@x.com', contact_phone: '1', address: 'Panglao', business_reg_type: 'DTI', business_reg_number: '123', submitted_at: iso(now - D) }] : [],
  center_documents: role === 'admin' ? [{ id: 'd1', center_id: 'pend1', kind: 'owner_id', path: 'pend1/a.pdf', file_name: 'id.pdf' }] : [],
  dive_logs: role === 'diver' ? [
    { id: 'lg5', diver_id: 'dv1', site_name: 'Napaling', dive_date: '2026-10-18', entry_time: '08:10', max_depth_m: 24, avg_depth_m: 14, duration_min: 52, water_temp_c: 28, rating: 5, marine_life: 'Sardinas, tortugas', centers: { name: 'Casa Azul Divers' }, dive_log_photos: [] },
    { id: 'lg4', diver_id: 'dv1', site_name: 'Balicasag – Black Forest', dive_date: '2026-10-17', entry_time: '10:30', max_depth_m: 31, avg_depth_m: 19, duration_min: 45, water_temp_c: 28, rating: 4, centers: { name: 'Casa Azul Divers' }, dive_log_photos: [] },
    { id: 'lg3', diver_id: 'dv1', site_name: 'Balicasag – Turtle Point', dive_date: '2026-10-17', entry_time: '08:00', max_depth_m: 18, duration_min: 48, centers: { name: 'Casa Azul Divers' }, dive_log_photos: [] },
    { id: 'lg2', diver_id: 'dv1', site_name: 'Alona House Reef', dive_date: '2026-10-12', entry_time: '19:00', max_depth_m: 14, duration_min: 55, centers: { name: 'Napaling Dive Co.' }, dive_log_photos: [] },
    { id: 'lg1', diver_id: 'dv1', site_name: 'Doljo Point', dive_date: '2026-09-28', entry_time: '09:00', max_depth_m: 22, duration_min: 50, centers: null, dive_log_photos: [] },
  ] : [], dive_log_photos: [], payments: [], trip_sites: [],
  admin_audit: role === 'admin' ? [{ id: 1, at: iso(now - H), action: 'center_status', target: C1, detail: { name: 'Demo · Centro Alona', from: 'pending', to: 'verified' } }, { id: 2, at: iso(now - 2 * H), action: 'admin_grant', detail: { email: 'admin@example.com' } }] : [],
}
const RPC = {
  is_platform_admin: role === 'admin', center_ratings: [{ center_id: C1, rating: 4.7, reviews: 12 }],
  delete_my_account: { ok: role !== 'centerv', blockers: role === 'centerv' ? ['Tu centro tiene 2 reserva(s) en salidas futuras. Cancélalas o avisa a los buceadores antes de eliminar la cuenta.'] : [], centers: role.startsWith('center') ? [C1] : [], dive_logs: 3, bookings_kept: 2 },
  center_private: [{ gcash_number: '0917 000 0000', review_note: role === 'centerr' ? 'Falta el permiso de negocio' : null, notes: null }],
  admin_users: [
    { diver_id: 'dv1', user_id: UID, full_name: 'Fernando B', email: 'fernando@example.com', account_type: 'center', country: 'España', languages: ['es', 'en'], logged_dives: 40, bio: null, seeks_buddy: false, show_on_trips: false, signed_up_at: '2026-10-15T03:46:26Z', last_sign_in_at: '2026-10-19T11:42:30Z', email_confirmed: true, auth_provider: 'email', certifications: [{ agency: 'PADI', level: 'advanced', verified: true }], bookings_total: 0, bookings_upcoming: 0, centers: [{ id: MY, name: 'PRUEBA', role: 'owner', status: 'verified' }], is_admin: true },
    { diver_id: 'dv2', user_id: 'u2', full_name: 'Ana López', email: 'ana@example.com', account_type: 'diver', country: 'Filipinas', languages: ['en'], logged_dives: 12, bio: 'Me encantan los tiburones', seeks_buddy: true, show_on_trips: true, signed_up_at: '2026-10-15T09:20:06Z', last_sign_in_at: null, email_confirmed: true, auth_provider: 'google', certifications: [], bookings_total: 2, bookings_upcoming: 1, centers: [], is_admin: false },
  ],
  admin_dashboard: (() => {
    const days = [...Array(30)].map((_, i) => new Date(now - (29 - i) * D + 8 * H).toISOString().slice(0, 10))
    return {
      days: 30, generated_at: iso(now),
      users: { total: 48, divers: 41, center_accounts: 7, new: 12, active: 30, unconfirmed: 3, countries: [{ country: 'Filipinas', n: 14 }, { country: 'España', n: 11 }, { country: 'Alemania', n: 6 }, { country: '—', n: 17 }],
        signups: days.map((day, i) => ({ day, n: [0, 1, 0, 2, 0, 0, 1, 3, 0, 1][i % 10] })) },
      centers: { by_status: { verified: 6, pending: 2, unverified: 3, rejected: 1 }, directory: 186, claims_pending: 1, new: 3,
        top: [{ id: C1, name: 'Demo · Centro Alona', destination: 'Panglao', bookings: 18, divers: 31, revenue: 179800 }, { id: C2, name: 'Demo · Centro Danao', destination: 'Panglao', bookings: 9, divers: 12, revenue: 54000 }],
        by_destination: [{ destination: 'Panglao', n: 3 }, { destination: 'Moalboal', n: 2 }, { destination: 'Anilao', n: 1 }] },
      trips: { upcoming: 77, seats_total: 497, seats_booked: 121, empty_upcoming: 30, completed: 41, cancelled_weather: 2, drafts: 4 },
      bookings: { by_status: { confirmed: 27, pending_payment: 3, cancelled_by_diver: 4, cancelled_by_center: 1 }, by_source: { app: 22, walk_in: 5, phone: 3 }, divers: 43,
        gross: 233800, collected: 190200, outstanding: 43600, commission: 11690, refunds: 5800,
        per_day: days.map((day, i) => ({ day, n: [1, 0, 2, 3, 1, 0, 0, 4, 2, 1][i % 10], php: [5800, 0, 11600, 17400, 5800, 0, 0, 23200, 9000, 4500][i % 10] })) },
      payments: { by_method: { gcash: 98000, card: 52200, cash: 40000 }, failed: 1, pending_online: 2 },
      activity: { dive_logs: 37, certs_unverified: 9 },
      alerts: { centers_pending: 2, expired_holds: 1, unpaid_soon: 2 },
    }
  })(),
  admin_list: [{ user_id: 'u1', email: 'admin@example.com', created_at: '2026-10-01T00:00:00Z', is_me: true }],
  trip_divers: { divers: [
    { name: 'Ana L.', level: 'advanced', seats: 1, dives: 25, languages: ['es'], country: 'ES', seeks_buddy: true,
      buddy: { score: 4.7, count: 9, raters: 7, scores: { buoyancy: 4.8, air: 4.6, awareness: 4.9, safety: 4.7, reef: 4.5 }, dive_again: 0.94 } },
    { name: 'Marco R.', level: 'open_water', seats: 1, dives: 12, languages: ['en', 'it'], country: 'IT' },
  ] },
  // Valoraciones como buddy
  my_buddy_summary: { count: 6, raters: 5, overall: 4.6, scores: { buoyancy: 4.3, air: 4.7, awareness: 4.8, safety: 4.6, reef: 4.9 }, dive_again: 0.92, pending_reveal: 1 },
  my_pending_buddy_ratings: [{ trip_id: 't1-1', departs_at: iso(now - 2 * D + 7.5 * H), center_name: 'Demo · Centro Alona', pending: 2, closes_at: iso(now + 12 * D) }],
  buddy_rating_targets: { departs_at: iso(now - 2 * D + 7.5 * H), center_name: 'Demo · Centro Alona', closes_at: iso(now + 12 * D), divers: [
    { diver_id: 'd2', name: 'Ana L.', level: 'advanced', dives: 25, rated: false },
    { diver_id: 'd3', name: 'Marco R.', level: 'open_water', dives: 12, rated: false },
  ] },
  rate_buddy: { ok: true },
}
function builder(table) {
  let rows = T[table] ? [...T[table]] : []
  let single = false, head = false, count = null
  const b = {
    select(_s, o) { if (o?.head) head = true; if (o?.count) count = rows.length; return b },
    eq(k, v) { if (rows.length && k in rows[0] && !['center_id', 'diver_id', 'user_id'].includes(k)) rows = rows.filter((r) => r[k] === v); return b },
    neq: () => b, gte: () => b, lt: () => b, lte: () => b, gt: () => b, in: () => b, not: () => b, like: () => b, ilike: () => b, or: () => b, is: () => b,
    order: () => b, limit: () => b, range: () => b,
    maybeSingle() { single = true; return b }, single() { single = true; return b },
    insert() { rows = [{ id: 'new' + Math.random() }]; return b }, update() { return b }, upsert() { return b }, delete() { return b },
    then(res, rej) { const data = head ? null : single ? rows[0] || null : rows; return Promise.resolve({ data, error: null, count: count ?? rows.length }).then(res, rej) },
  }
  return b
}
const session = role === 'anon' ? null : { user: { id: UID, email: 'fernando@example.com', user_metadata: { account_type: myCenter ? 'center' : 'diver' } }, access_token: 'x' }
export function createClient() {
  return {
    from: builder,
    rpc: (name) => Promise.resolve({ data: name in RPC ? RPC[name] : null, error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: () => Promise.resolve({}), signInWithPassword: () => Promise.resolve({ error: { message: 'Invalid login credentials' } }),
      signUp: () => Promise.resolve({ data: { user: { id: 'n' }, session: null }, error: null }), resetPasswordForEmail: () => Promise.resolve({}), updateUser: () => Promise.resolve({}),
      reauthenticate: () => Promise.resolve({ data: {}, error: null }),
      refreshSession: () => Promise.resolve({ data: { session } }), resend: () => Promise.resolve({ error: null }), signInWithOAuth: () => Promise.resolve({ error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: rawRole === 'mfa' ? 'aal2' : 'aal1' } }),
        listFactors: () => Promise.resolve({ data: { all: [], totp: rawRole === 'mfa' ? [{ id: 'f1', status: 'verified', factor_type: 'totp' }] : [] } }),
        enroll: () => Promise.resolve({ data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', secret: 'JBSWY3DPEHPK3PXP' } } }),
        challengeAndVerify: () => Promise.resolve({ error: { message: 'Invalid TOTP code entered', code: 'mfa_verification_failed' } }),
        unenroll: () => Promise.resolve({}),
      },
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), remove: () => Promise.resolve({}), createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'about:blank' } }), createSignedUrls: () => Promise.resolve({ data: [] }) }) },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  }
}
