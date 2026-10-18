// Supabase simulado para pruebas de humo (sin red). Rol en localStorage 'mockRole': anon|diver|center|centerv|admin
const role = (() => { try { return localStorage.getItem('mockRole') || 'anon' } catch { return 'anon' } })()
const H = 3600e3, D = 24 * H
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const day0 = Math.floor((now + 8 * H) / D) * D - 8 * H // medianoche Manila
const C1 = '4ec918c7-1b17-477e-acb7-2c33276224ac', C2 = 'b8a7b4ba-bf90-4534-a87f-57852c72d6c7', MY = '0f71356a-b6a2-4846-8855-8a7f8956ade4'
const UID = '03a20db7-3776-4425-b95c-56f2144b5cee'
const pubTrips = []
for (let d = 0; d < 8; d++) {
  pubTrips.push({ id: 't1-' + d, center_id: C1, departs_at: iso(day0 + d * D + 7.5 * H), num_dives: 3, min_level: 'open_water', price_php: 5800, gear_rental_php: 800, center_name: 'Demo · Centro Alona', boat_name: d % 2 ? 'Banca Uno' : null, sites: ['Balicasag – Black Forest', 'Pamilacan'], available_seats: d === 2 ? 0 : 10, center_area: 'Panglao', center_locality: 'Alona Beach', center_lat: 9.5487, center_lng: 123.7745, booked_seats: d % 3, center_destination: 'Panglao', center_province: 'Bohol', center_languages: ['en', 'es'], center_agencies: ['PADI'], center_course_languages: ['en', 'es'] })
  pubTrips.push({ id: 't2-' + d, center_id: C2, departs_at: iso(day0 + d * D + 13.5 * H), num_dives: 2, min_level: 'advanced', price_php: 4500, gear_rental_php: 0, center_name: 'Demo · Centro Danao', boat_name: null, sites: [], available_seats: 2, center_area: 'Panglao', center_locality: 'Danao', center_lat: 9.553, center_lng: 123.79, booked_seats: 4, center_destination: 'Panglao', center_province: 'Bohol', center_languages: ['en', 'tl'], center_agencies: ['SSI'], center_course_languages: ['en'] })
}
const centerRow = (st) => ({ id: MY, name: 'PRUEBA', area: 'Panglao', destination: 'Panglao', province: 'Bohol', phone: '+63 900', lat: null, lng: null, languages: [], course_languages: [], agencies: [], verification_status: st, listing_status: 'socio', review_note: st === 'rejected' ? 'Documento ilegible' : null, default_divers_per_guide: 4, created_at: iso(now - 3 * D) })
const myCenter = role === 'center' ? centerRow('unverified') : role === 'centerv' || role === 'admin' ? centerRow('verified') : role === 'centerr' ? centerRow('rejected') : null
const diverRow = role === 'anon' ? null : { id: 'dv1', user_id: UID, full_name: 'Fernando B', account_type: myCenter ? 'center' : 'diver', languages: ['es'], logged_dives: 40, country: 'España', bio: '', seeks_buddy: false, show_on_trips: true }
const booking = (id, st, paid, ci) => ({ id, status: st, seats: 1, amount_php: 5800, deposit_php: 2900, paid_php: paid, with_gear: false, source: 'app', checked_in_at: ci, created_at: iso(now - H), guest_name: null, divers: { full_name: 'Ana López', logged_dives: 25, languages: 'es', certifications: [{ id: 'c1', agency: 'PADI', level: 'advanced', verified_at: null }] } })
const myTrips = myCenter ? [0, 1, 2].map((d) => ({ id: 'mt' + d, center_id: MY, boat_id: 'b1', departs_at: iso(day0 + d * D + 7.5 * H), num_dives: 3, min_level: 'open_water', price_php: 5800, gear_rental_php: 800, guides: 2, divers_per_guide: 4, seat_override: null, blocked_seats: 0, status: d === 2 ? 'draft' : 'published', boats: { name: 'Banca Uno', capacity: 12 }, trip_sites: [{ position: 1, dive_sites: { name: 'Napaling' } }], bookings: d === 0 ? [booking('bk1', 'confirmed', 5800, null), booking('bk2', 'pending_payment', 0, null)] : [] })) : []
const T = {
  published_trips: pubTrips,
  destinations: [{ name: 'Panglao', province: 'Bohol', island_group: 'Visayas', lat: 9.58, lng: 123.75 }, { name: 'Moalboal', province: 'Cebu', island_group: 'Visayas', lat: 9.94, lng: 123.39 }],
  dive_sites: [{ id: 's1', name: 'Napaling', area: 'Panglao', province: 'Bohol', max_depth_m: 25, min_depth_m: 5, recommended_min: 'open_water', highlight: 'Sardines', highlight_es: 'Sardinas' }],
  centers: [{ id: C1, name: 'Demo · Centro Alona', area: 'Panglao', destination: 'Panglao', province: 'Bohol', listing_status: 'socio', verification_status: 'verified', languages: ['en', 'es'], course_languages: ['es'], agencies: ['PADI', 'SSI'], agency_detail: 'PADI 5★ IDC', phone: '+63 912', website: 'https://example.com', lat: 9.5, lng: 123.7, location_precision: 'zona' },
    { id: 'dir1', name: 'Directorio Divers', area: 'Moalboal', destination: 'Moalboal', province: 'Cebu', listing_status: 'directorio', verification_status: 'unverified', languages: [], agencies: ['SSI'], source_url: 'https://example.org' },
    ...(role === 'admin' ? [{ ...centerRow('pending'), id: 'pend1', name: 'Nuevo Centro Pendiente', claims_center_id: 'dir1' }] : [])],
  divers: diverRow ? [diverRow] : [],
  center_staff: myCenter ? [{ role: 'owner', centers: myCenter }] : [],
  certifications: role === 'diver' ? [{ id: 'c1', level: 'open_water', agency: 'PADI', card_number: null, verified_at: null }] : [],
  boats: myCenter ? [{ id: 'b1', name: 'Banca Uno', capacity: 12, active: true, show_to_divers: false, center_id: MY }] : [],
  trips: myTrips,
  bookings: role === 'diver' ? [{ ...booking('bk9', 'pending_payment', 0, null), trips: { departs_at: iso(day0 + D + 7.5 * H), num_dives: 3, status: 'published', centers: { name: 'Demo · Centro Alona', phone: '+63 912' }, boats: { name: 'Banca', show_to_divers: false } } }] : [],
  app_config: [{ key: 'payments_mode', value: 'demo' }],
  center_verifications: role === 'admin' ? [{ center_id: 'pend1', legal_name: 'Nuevo SA', owner_name: 'Juan', contact_email: 'j@x.com', contact_phone: '1', address: 'Panglao', business_reg_type: 'DTI', business_reg_number: '123', submitted_at: iso(now - D) }] : [],
  center_documents: role === 'admin' ? [{ id: 'd1', center_id: 'pend1', kind: 'owner_id', path: 'pend1/a.pdf', file_name: 'id.pdf' }] : [],
  dive_logs: [], dive_log_photos: [], payments: [], trip_sites: [],
}
const RPC = {
  is_platform_admin: role === 'admin', center_ratings: [{ center_id: C1, rating: 4.7, reviews: 12 }],
  trip_divers: { divers: [{ name: 'Ana L.', level: 'advanced', seats: 1, dives: 25, languages: ['es'], country: 'ES' }] },
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
      signUp: () => Promise.resolve({ data: {}, error: null }), resetPasswordForEmail: () => Promise.resolve({}), updateUser: () => Promise.resolve({}),
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), remove: () => Promise.resolve({}), createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'about:blank' } }), createSignedUrls: () => Promise.resolve({ data: [] }) }) },
    functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  }
}
