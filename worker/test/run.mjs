// Pruebas del Worker en Node (sin red): node --no-warnings worker/test/run.mjs
// Recorre la prueba de aceptación de claude/prompt-cloudflare.md, la matriz de autorización,
// 20 reservas a la vez sobre 6 plazas, dos pasos, webhook de PayMongo y ficheros.
import { D1, R2 } from './shim.mjs'
import { handleApi } from '../index.js'
import { totpAt } from '../lib/crypto.js'
import { hmacHex } from '../lib/crypto.js'
import { sniff } from '../storage.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', DIVE_PHOTOS: new R2(), CENTER_DOCS: new R2(),
  PAYMONGO_SECRET_KEY: 'sk_test_x', PAYMONGO_WEBHOOK_SECRET: 'whsk_x' }

let fails = 0, passes = 0
const ok = (cond, name, extra) => { if (cond) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') } }
const section = (s) => console.log('·', s)

// Emails: se capturan los enlaces que escribe sendEmail en modo prueba
const mails = []
const log = console.log
console.log = (...a) => { if (a[0] === 'EMAIL (modo prueba)') mails.push({ to: a[1], url: a[3] }); else log(...a) }
console.error = (...a) => { if (process.env.DEBUG) log(...a) }

// PayMongo simulado
const pmSessions = new Map()
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url)
  if (u === 'https://api.paymongo.com/v1/checkout_sessions' && opt.method === 'POST') {
    const id = 'cs_' + Math.random().toString(36).slice(2)
    pmSessions.set(id, { paid: false, body: JSON.parse(opt.body) })
    return new Response(JSON.stringify({ data: { id, attributes: { checkout_url: 'https://checkout.paymongo.com/' + id } } }), { status: 200 })
  }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u)
  if (m) { const s = pmSessions.get(m[1]); return new Response(JSON.stringify({ data: { attributes: { payments: s?.paid ? [{ attributes: { status: 'paid' } }] : [] } } }), { status: s ? 200 : 404 }) }
  throw new Error('fetch no simulado ' + u)
}

// Cliente con su cookie
class Client {
  constructor(name) { this.name = name; this.cookie = ''; this.ip = '10.0.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }
  async raw(method, path, body, headers = {}) {
    const h = { Origin: ORIGIN, 'X-DivingSlot': '1', 'CF-Connecting-IP': this.ip, ...headers }
    if (this.cookie) h.Cookie = this.cookie
    if (body !== undefined && !(body instanceof Uint8Array)) h['Content-Type'] = 'application/json'
    const req = new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body), redirect: 'manual' })
    const res = await handleApi(req, env, { waitUntil: (p) => p })
    const sc = res.headers.get('Set-Cookie')
    if (sc) { const v = sc.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v }
    return res
  }
  async call(method, path, body) { const r = await this.raw(method, path, body); const j = await r.json().catch(() => null); return { status: r.status, ...j } }
  rest(q) { return this.call('POST', '/api/rest', q) }
  rpc(name, args) { return this.call('POST', '/api/rpc/' + name, args) }
  async signup(email, data = {}) {
    const r = await this.call('POST', '/api/auth/signup', { email, password: 'Clave1234', data })
    const mail = mails.filter((m) => m.to === email).pop()
    const link = new URL(mail.url)
    const v = await this.raw('GET', link.pathname + link.search)
    return { r, v }
  }
  login(email, password = 'Clave1234') { return this.call('POST', '/api/auth/login', { email, password }) }
}
const errCode = (r) => r.error?.message?.split(':')[0]

// ── Datos base ──
section('datos base')
await db.batch([
  db.prepare("INSERT INTO destinations VALUES ('Panglao', 'Bohol', 'Visayas', 9.55, 123.77)"),
  db.prepare("INSERT INTO dive_sites (id, name, area, min_depth_m, max_depth_m) VALUES ('s1', 'Napaling', 'Panglao', 5, 25), ('s2', 'Balicasag', 'Panglao', 8, 40)"),
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, phone, gcash_number, notes) VALUES ('dir1', 'Casa Azul Divers', 'Panglao', 'directorio', '+63 900', '0917 SECRETO', 'nota interna')"),
])

// ── Prueba de aceptación ──
section('alta del centro, documentos y aprobación')
const admin = new Client('admin'), centro = new Client('centro'), A = new Client('A'), B = new Client('B'), anon = new Client('anon')
await admin.signup('admin@divingslot.test')
const adminUser = await db.prepare("SELECT id FROM users WHERE email = 'admin@divingslot.test'").first()
await db.prepare('INSERT INTO platform_admins (user_id) VALUES (?)').bind(adminUser.id).run()

const s1 = await centro.signup('centro@divingslot.test', { full_name: 'Ana Centro', account_type: 'center', center_name: 'Casa Azul Divers' })
ok(s1.r.status === 200 && s1.r.session === null, 'signup devuelve sin sesión (pide confirmar)', s1.r)
ok(s1.v.status === 302 && centro.cookie, 'el enlace del email confirma y abre sesión')
const sess = await centro.call('GET', '/api/auth/session')
ok(sess.session?.user?.email === 'centro@divingslot.test' && sess.session.user.user_metadata.center_name === 'Casa Azul Divers', 'sesión con user_metadata', sess)

const reg = await centro.rpc('register_center', { p_name: 'casa azul divers', p_phone: '' })
ok(reg.data?.claims_center_id === 'dir1' && reg.data?.listing_status === 'socio' && reg.data?.phone === '+63 900', 'reclama la ficha del directorio', reg)
ok(reg.data && !('gcash_number' in reg.data), 'register_center no devuelve columnas privadas')
const CID = reg.data.id
ok(errCode(await centro.rpc('register_center', { p_name: 'Otro', p_phone: '' })) === 'BAD_STATE', 'no puede registrar dos centros')

// el centro no puede cambiar su propio estado
let r = await centro.rest({ table: 'centers', op: 'update', values: { verification_status: 'verified' }, filters: [['id', 'eq', CID]] })
ok(r.status === 403, 'protect_center_columns: el centro no se autoverifica', r)
r = await centro.rest({ table: 'centers', op: 'update', values: { gcash_number: '0917 111', languages: ['es', 'en'] }, filters: [['id', 'eq', CID]], returning: true, select: 'id, languages' })
ok(r.data?.[0]?.languages?.[1] === 'en', 'el centro edita sus datos (arrays como JSON)', r)
r = await centro.rest({ table: 'centers', select: '*', filters: [['id', 'eq', CID]], single: 'maybe' })
ok(r.data?.id === CID && !('gcash_number' in r.data), 'select * no expone gcash_number', r)
r = await centro.rest({ table: 'centers', select: 'id, gcash_number', filters: [['id', 'eq', CID]] })
ok(r.status === 403, 'pedir gcash_number por REST está prohibido', r)
r = await centro.rpc('center_private', { p_center: CID })
ok(r.data?.[0]?.gcash_number === '0917 111', 'center_private al equipo', r)
ok((await A.rpc('center_private', { p_center: CID })).status === 403, 'center_private a otros: prohibido')

// trips en borrador sí, publicar no hasta verificar
r = await centro.rest({ table: 'boats', op: 'insert', values: { center_id: CID, name: 'Banca Azul', capacity: 6, show_to_divers: true }, returning: true, select: 'id' })
const BOAT = r.data?.[0]?.id
ok(!!BOAT, 'crea un barco', r)
const dep = (h) => new Date(Date.now() + h * 36e5).toISOString()
r = await centro.rest({ table: 'trips', op: 'insert', values: { center_id: CID, boat_id: BOAT, departs_at: dep(48), price_php: 3000, gear_rental_php: 500, divers_per_guide: 4, guides: 2, status: 'published' }, returning: true, select: 'id' })
ok(errCode(r) === 'NOT_VERIFIED', 'enforce_trip_publish', r)

// verificación
r = await centro.rest({ table: 'center_verifications', op: 'upsert', values: { center_id: CID, legal_name: 'Casa Azul Inc', owner_name: 'Ana', contact_phone: '+63', contact_email: 'a@b.c', address: 'Alona', mayors_permit_number: 'MP-1' } })
ok(r.status === 200, 'upsert de la verificación', r)
r = await centro.rest({ table: 'center_verifications', op: 'upsert', values: { center_id: CID, years_operating: 5 } })
ok(r.status === 200 && (await db.prepare('SELECT years_operating, legal_name FROM center_verifications').first()).legal_name === 'Casa Azul Inc', 'upsert actualiza sin perder datos', r)
ok(errCode(await centro.rpc('submit_center_verification')) === 'MISSING_DOCS', 'sin documentos no se envía')
const pdf = new TextEncoder().encode('%PDF-1.4 prueba')
const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
ok((await centro.raw('PUT', `/api/storage/upload/center-docs/${CID}/owner_id-1.pdf`, pdf)).status === 200, 'sube el documento de identidad')
ok((await centro.raw('PUT', `/api/storage/upload/center-docs/${CID}/x.pdf`, new TextEncoder().encode('<html>'))).status === 415, 'rechaza un fichero que no es PDF/imagen')
ok((await A.raw('PUT', `/api/storage/upload/center-docs/${CID}/y.pdf`, pdf)).status === 401, 'otro usuario sin sesión no sube')
ok((await centro.raw('PUT', `/api/storage/upload/center-docs/${CID}/dti_sec-1.jpg`, jpg)).status === 200, 'sube el permiso')
for (const [kind, path] of [['owner_id', `${CID}/owner_id-1.pdf`], ['dti_sec', `${CID}/dti_sec-1.jpg`]]) {
  r = await centro.rest({ table: 'center_documents', op: 'insert', values: { center_id: CID, kind, path, file_name: 'f' } })
  ok(r.status === 200, 'registra el documento ' + kind, r)
}
r = await centro.rpc('submit_center_verification')
ok(r.data?.verification_status === 'pending', 'envía la verificación', r)

await admin.login('admin@divingslot.test')
r = await admin.call('POST', '/api/storage/sign', { bucket: 'center-docs', paths: [`${CID}/owner_id-1.pdf`], expiresIn: 300 })
const signed = r.data?.[0]?.signedUrl
ok(!!signed, 'el admin obtiene un enlace firmado de 5 min', r)
const dl = await anon.raw('GET', new URL(signed).pathname + new URL(signed).search)
ok(dl.status === 200 && (await dl.text()).startsWith('%PDF'), 'el enlace firmado descarga el documento')
const bad = new URL(signed); bad.searchParams.set('sig', '0'.repeat(64))
ok((await anon.raw('GET', bad.pathname + bad.search)).status === 403, 'firma manipulada: 403')
r = await A.call('POST', '/api/storage/sign', { bucket: 'center-docs', paths: [`${CID}/owner_id-1.pdf`] })
ok(r.status === 401 || r.data?.[0]?.signedUrl === null, 'otro usuario no firma documentos ajenos')

r = await admin.rpc('review_center', { p_center: CID, p_decision: 'rejected' })
ok(errCode(r) === 'NO_NOTE', 'rechazar exige motivo')
r = await admin.rpc('review_center', { p_center: CID, p_decision: 'verified' })
ok(r.data?.verification_status === 'verified', 'el admin aprueba', r)
ok((await db.prepare("SELECT listing_status FROM centers WHERE id = 'dir1'").first()).listing_status === 'cerrado', 'la ficha reclamada se cierra')
ok(mails.some((m) => m.to === 'centro@divingslot.test' && m.url?.includes('#/centro')), 'email al centro aprobado')
await centro.login('centro@divingslot.test') // vuelve a cargar permisos

section('salida, reservas y retención')
r = await centro.rest({ table: 'trips', op: 'insert', values: { center_id: CID, boat_id: BOAT, departs_at: dep(48), price_php: 3000, gear_rental_php: 500, divers_per_guide: 4, guides: 2, status: 'published' }, returning: true, select: 'id' })
const T1 = r.data?.[0]?.id
ok(!!T1, 'publica la salida tras verificar', r)
await centro.rest({ table: 'trip_sites', op: 'insert', values: [{ trip_id: T1, site_id: 's1', position: 1 }, { trip_id: T1, site_id: 's2', position: 2 }] })
r = await anon.rest({ table: 'published_trips', select: '*', filters: [['center_id', 'eq', CID]] })
ok(r.data?.[0]?.available_seats === 6 && r.data[0].sites?.[1] === 'Balicasag' && r.data[0].boat_name === 'Banca Azul', 'published_trips: 6 plazas (barco 6 < 2×4), sitios ordenados', r.data?.[0])

for (const [c, e] of [[A, 'a@divingslot.test'], [B, 'b@divingslot.test']]) {
  await c.signup(e, { full_name: e[0].toUpperCase() + ' Buceador Pérez' })
}
ok(errCode(await A.rpc('book_trip', { p_trip: T1, p_seats: 2, p_with_gear: true, p_medical_signed: true })) === 'LEVEL', 'sin certificación no reserva')
for (const c of [A, B]) {
  const d = await c.rest({ table: 'divers', select: 'id', single: 'single' })
  r = await c.rest({ table: 'certifications', op: 'insert', values: { diver_id: d.data?.id ?? d.data?.[0]?.id, agency: 'PADI', level: 'advanced' } })
  ok(r.status === 200, 'añade su certificación', r)
}
r = await A.rest({ table: 'certifications', op: 'insert', values: { diver_id: 'x', agency: 'PADI', level: 'instructor' } })
ok(r.status === 403, 'no añade certificaciones a otro buceador', r)
const dA = (await A.rest({ table: 'divers', select: 'id', single: 'single' })).data
r = await A.rest({ table: 'certifications', op: 'insert', values: { diver_id: dA.id, agency: 'SSI', level: 'instructor', verified_at: new Date().toISOString() } })
ok(r.status === 403, 'no puede autoverificarse la certificación', r)

r = await A.rpc('book_trip', { p_trip: T1, p_seats: 2, p_with_gear: true, p_medical_signed: true })
const BA = r.data
ok(BA?.amount_php === 7000 && BA.deposit_php === 3500 && BA.commission_php === 500 && BA.status === 'pending_payment' && BA.with_gear === true, 'A reserva 2 plazas: 7000, señal 3500, comisión 500', r)
ok(errCode(await A.rpc('book_trip', { p_trip: T1, p_seats: 1, p_with_gear: false, p_medical_signed: true })) === 'DUPLICATE', 'no duplica reserva')
r = await A.rpc('confirm_payment_demo', { p_booking: BA.id, p_kind: 'deposit' })
ok(r.data?.status === 'confirmed' && r.data.paid_php === 3500, 'A paga la señal demo y queda confirmada', r)

r = await B.rpc('book_trip', { p_trip: T1, p_seats: 4, p_with_gear: false, p_medical_signed: true })
const BB = r.data
ok(BB?.seats === 4, 'B reserva las 4 plazas restantes', r)
r = await anon.rest({ table: 'published_trips', select: 'available_seats, booked_seats', filters: [['id', 'eq', T1]], single: 'single' })
ok(r.data?.available_seats === 0 && r.data.booked_seats === 6, 'salida completa', r)
// B deja caducar la retención (simulamos 16 min)
await db.prepare("UPDATE bookings SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-16 minutes') WHERE id = ?").bind(BB.id).run()
r = await anon.rest({ table: 'published_trips', select: 'available_seats', filters: [['id', 'eq', T1]], single: 'single' })
ok(r.data?.available_seats === 4, 'al caducar la retención, la plaza se libera', r)
ok(errCode(await B.rpc('confirm_payment_demo', { p_booking: BB.id, p_kind: 'deposit' })) === 'HOLD_EXPIRED', 'no se paga una retención caducada')

section('centro: reserva por WhatsApp, check-in, efectivo')
r = await centro.rpc('add_manual_booking', { p_trip: T1, p_guest: 'Juan WhatsApp', p_seats: 1, p_with_gear: false, p_source: 'whatsapp' })
ok(r.data?.status === 'confirmed' && r.data.commission_php === 0 && r.data.amount_php === 3000, 'reserva manual sin comisión', r)
ok(errCode(await centro.rpc('add_manual_booking', { p_trip: T1, p_guest: 'X', p_seats: 9, p_with_gear: false, p_source: 'walk_in' })) === 'NO_SEATS', 'reserva manual respeta el barco')
ok(errCode(await A.rpc('add_manual_booking', { p_trip: T1, p_guest: 'X', p_seats: 1, p_with_gear: false, p_source: 'walk_in' })) === 'FORBIDDEN', 'un buceador no añade reservas manuales')
r = await centro.rpc('set_checkin', { p_booking: BA.id, p_in: true })
ok(!!r.data?.checked_in_at, 'check-in de A', r)
r = await centro.rpc('record_cash_payment', { p_booking: BA.id })
ok(r.data?.paid_php === 7000 && !!r.data.balance_paid_at, 'cobra el resto en efectivo', r)
ok(errCode(await centro.rpc('record_cash_payment', { p_booking: BA.id })) === 'BAD_AMOUNT', 'no cobra dos veces')

// el centro ve a sus clientes y sus certificaciones, con la relación incrustada
r = await centro.rest({ table: 'bookings', select: 'id, seats, status, divers(full_name, certifications(level, agency, verified_at)), trips!inner(id, departs_at, center_id, status)', filters: [['trips.center_id', 'eq', CID]], order: [{ col: 'created_at', ascending: false }] })
ok(r.data?.length === 3 && r.data.some((b) => b.divers?.certifications?.[0]?.level === 'advanced') && r.data.every((b) => b.trips?.center_id === CID), 'agenda del centro con tablas incrustadas', r)
r = await centro.rpc('verify_certification', { p_cert: (await db.prepare('SELECT id FROM certifications WHERE diver_id = ?').bind(dA.id).first()).id, p_center: CID })
ok(!!r.data?.verified_at, 'el centro verifica la certificación de su cliente', r)

section('cancelaciones')
// A cancela a menos de 24 h: se queda el 50 %
await db.prepare('UPDATE trips SET departs_at = ? WHERE id = ?').bind(dep(10), T1).run()
r = await A.rpc('cancel_my_booking', { p_booking: BA.id })
ok(r.data?.status === 'cancelled_by_diver' && r.data.refund_php === 3500 && r.data.commission_php === 500, 'A cancela a <24 h: devuelve 7000 − 3500, mantiene comisión', r)
// otra salida cancelada por meteo: devuelve el 100 %
r = await centro.rest({ table: 'trips', op: 'insert', values: { center_id: CID, boat_id: BOAT, departs_at: dep(72), price_php: 2500, divers_per_guide: 4, status: 'published' }, returning: true, select: 'id' })
const T2 = r.data[0].id
const bB2 = (await B.rpc('book_trip', { p_trip: T2, p_seats: 1, p_with_gear: false, p_medical_signed: true })).data
await B.rpc('confirm_payment_demo', { p_booking: bB2.id, p_kind: 'full' })
r = await centro.rpc('cancel_trip_weather', { p_trip: T2 })
ok(r.data === 1, 'cancelación por meteo', r)
r = await B.rest({ table: 'bookings', select: 'status, refund_php, commission_php', filters: [['id', 'eq', bB2.id]], single: 'single' })
ok(r.data?.status === 'cancelled_by_center' && r.data.refund_php === 2500 && r.data.commission_php === 0, 'meteo: 100 % y sin comisión', r)

section('informes del centro (cifras)')
r = await centro.rest({ table: 'payments', select: 'amount_php, method, kind, paid_at', filters: [['status', 'eq', 'paid']] })
const byMethod = {}
for (const p of r.data || []) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount_php
ok(byMethod.demo === 6000 && byMethod.cash === 3500, 'cobros: 3500 + 2500 demo y 3500 en efectivo', byMethod)

section('admin: ver como centro y registro')
r = await admin.rest({ table: 'bookings', select: 'id', filters: [['trip_id', 'eq', T1]] })
ok(r.data?.length === 3, 'el admin lee las reservas del centro', r)
r = await admin.rest({ table: 'trips', op: 'update', values: { price_php: 1 }, filters: [['id', 'eq', T1]] })
ok(r.status === 403 || r.data === null && (await db.prepare('SELECT price_php FROM trips WHERE id = ?').bind(T1).first()).price_php === 3000, 'el admin no escribe en el centro (solo lectura)', r)
r = await admin.rest({ table: 'admin_audit', select: '*', order: [{ col: 'at', ascending: true }] })
ok(r.data?.some((a) => a.action === 'center_status' && a.detail?.to === 'verified'), 'el registro muestra la aprobación', r.data)
r = await admin.rpc('admin_dashboard', { p_days: 30, p_demo: false })
ok(r.data?.bookings?.commission === 0 && r.data.bookings.by_status.cancelled_by_diver === 1 && r.data.bookings.refunds === 6000 && r.data.centers.by_status.verified === 1 && r.data.users.total === 4, 'admin_dashboard', r.data && { b: r.data.bookings, c: r.data.centers, u: r.data.users.total })
r = await admin.rpc('admin_users')
ok(r.data?.length === 4 && r.data.find((u) => u.email === 'a@divingslot.test')?.certifications?.[0]?.verified === true, 'admin_users', r.data?.[0])
ok(errCode(await admin.rpc('admin_revoke', { p_user: adminUser.id })) === 'LAST_ADMIN', 'no se quita el último admin')
ok((await A.rpc('admin_users')).status === 403, 'admin_users solo admin')

section('autorización (lecturas)')
r = await anon.rest({ table: 'bookings', select: '*' })
ok(r.data?.length === 0, 'anónimo no ve reservas', r)
r = await B.rest({ table: 'bookings', select: 'id, diver_id' })
ok(r.data?.every((b) => b.diver_id !== dA.id), 'B no ve las reservas de A', r)
r = await anon.rest({ table: 'trips', op: 'update', values: { price_php: 1 }, filters: [['id', 'eq', T1]] })
ok(r.status === 401, 'anónimo no escribe', r)
r = await B.rest({ table: 'divers', select: 'id, full_name' })
ok(r.data?.length === 1, 'un buceador solo ve su perfil', r)
r = await centro.rest({ table: 'divers', select: 'id, full_name' })
ok(r.data?.length === 3, 'el centro ve a sus clientes (y su propio perfil)', r)
r = await anon.rest({ table: 'users', select: '*' })
ok(r.status === 404, 'tablas internas no existen para la API', r)
r = await anon.rest({ table: 'centers', select: 'id, name', filters: [['listing_status', 'neq', 'cerrado']], or: 'listing_status.neq.socio,verification_status.eq.verified', order: [{ col: 'name' }] })
ok(r.data?.length === 1 && r.data[0].id === CID, 'directorio con .or()', r)
r = await anon.rest({ table: 'centers', select: 'id', count: 'exact', head: true, filters: [['verification_status', 'eq', 'verified']] })
ok(r.count === 1 && r.data === null, 'count exact head', r)
r = await anon.rest({ table: 'centers', select: 'id', filters: [['name', 'not.like', 'Demo%']] })
ok(r.data?.length >= 1, 'not like', r)
r = await anon.rpc('trip_divers', { p_trip: T1 })
ok(r.data?.divers?.length === 0 && r.data.others === 1, 'trip_divers anónimo: solo el número', r)
r = await B.rpc('trip_divers', { p_trip: T1 })
ok(r.data?.divers?.length === 0, 'trip_divers: A canceló', r)

section('concurrencia: 20 reservas a la vez en 6 plazas')
r = await centro.rest({ table: 'trips', op: 'insert', values: { center_id: CID, boat_id: BOAT, departs_at: dep(96), price_php: 2000, divers_per_guide: 6, status: 'published' }, returning: true, select: 'id' })
const T3 = r.data[0].id
const many = []
for (let i = 0; i < 20; i++) many.push(new Client('d' + i))
for (const [i, c] of many.entries()) {
  await c.signup(`d${i}@divingslot.test`)
  const d = (await c.rest({ table: 'divers', select: 'id', single: 'single' })).data
  await c.rest({ table: 'certifications', op: 'insert', values: { diver_id: d.id, agency: 'PADI', level: 'open_water' } })
}
const results = await Promise.all(many.map((c) => c.rpc('book_trip', { p_trip: T3, p_seats: 1, p_with_gear: false, p_medical_signed: true })))
const okN = results.filter((x) => x.data?.id).length
const seats = (await db.prepare(`SELECT sum(seats) AS n FROM bookings WHERE trip_id = ?`).bind(T3).first()).n
ok(okN === 6 && seats === 6 && results.filter((x) => errCode(x) === 'NO_SEATS').length === 14, '6 reservas y 14 NO_SEATS', { okN, seats })

section('verificación en dos pasos')
await A.login('a@divingslot.test')
r = await A.call('POST', '/api/auth/mfa/enroll', { friendlyName: 'Móvil' })
ok(r.totp?.qr_code?.startsWith('data:image/svg+xml') && r.totp.secret.length === 32, 'alta TOTP con QR', r)
const fid = r.id, secret = r.totp.secret
const code = await totpAt(secret, Math.floor(Date.now() / 30000))
r = await A.call('POST', '/api/auth/mfa/verify', { factorId: fid, code })
ok(r.ok, 'activa el factor', r)
ok((await A.call('POST', '/api/auth/mfa/verify', { factorId: fid, code })).error?.code === 'mfa_verification_failed', 'el mismo código no vale dos veces')
await A.login('a@divingslot.test')
r = await A.call('GET', '/api/auth/session')
ok(r.aal?.currentLevel === 'aal1' && r.aal.nextLevel === 'aal2', 'tras la contraseña falta el segundo paso', r.aal)
r = await A.rest({ table: 'bookings', select: 'id' })
ok(r.data?.length === 0, 'sin el código no ve nada privado', r)
r = await A.rest({ table: 'published_trips', select: 'id' })
ok(r.data?.length === 0, 'sin el código tampoco lee datos públicos (como mfa_required)', r)
ok(errCode(await A.rpc('book_trip', { p_trip: T3, p_seats: 1, p_with_gear: false, p_medical_signed: true })) === 'MFA_REQUIRED', 'RPC exige el código')
const code2 = await totpAt(secret, Math.floor(Date.now() / 30000) + 1)
r = await A.call('POST', '/api/auth/mfa/verify', { factorId: fid, code: code2 })
ok(r.ok, 'introduce el código', r)
r = await A.rest({ table: 'bookings', select: 'id' })
ok(r.data?.length >= 1, 'con el código vuelve a ver sus reservas', r)

section('contraseñas y emails')
r = await anon.login('a@divingslot.test', 'mala1234')
ok(r.error?.message === 'Invalid login credentials', 'contraseña incorrecta', r)
r = await anon.call('POST', '/api/auth/signup', { email: 'c@divingslot.test', password: 'corta' })
ok(r.error?.code === 'weak_password', 'contraseña débil', r)
await anon.call('POST', '/api/auth/signup', { email: 'c@divingslot.test', password: 'Clave1234' })
r = await anon.login('c@divingslot.test')
ok(r.error?.code === 'email_not_confirmed', 'sin confirmar no entra', r)
r = await anon.call('POST', '/api/auth/signup', { email: 'a@divingslot.test', password: 'Clave1234' })
ok(r.status === 200 && r.session === null, 'no revela si el email ya existe', r)
// contraseña migrada de Supabase (bcrypt) → entra y se guarda en PBKDF2
const legacyId = crypto.randomUUID()
await db.prepare("INSERT INTO users (id, email, password_hash, email_confirmed_at) VALUES (?, 'old@divingslot.test', 'bcrypt$$2b$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW', '2026-01-01T00:00:00.000Z')").bind(legacyId).run()
const old = new Client('old')
r = await old.login('old@divingslot.test', 'U*U')
ok(r.user?.id === legacyId && (await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(legacyId).first()).password_hash.startsWith('pbkdf2$'), 'login con hash bcrypt de Supabase y rehash', r)
// recuperar contraseña
await anon.call('POST', '/api/auth/recover', { email: 'b@divingslot.test' })
const rec = new Client('rec')
const recLink = new URL(mails.filter((m) => m.to === 'b@divingslot.test').pop().url)
const rv = await rec.raw('GET', recLink.pathname + recLink.search)
ok(rv.headers.get('Location')?.endsWith('/#/perfil'), 'el enlace de recuperación lleva al perfil')
r = await rec.call('GET', '/api/auth/session')
ok(r.session?.recovery === true, 'sesión de recuperación', r.session)
r = await rec.call('POST', '/api/auth/update', { password: 'Nueva12345' })
ok(r.user, 'cambia la contraseña', r)
ok((await rec.raw('GET', recLink.pathname + recLink.search)).headers.get('Location')?.includes('error_description'), 'el enlace no sirve dos veces')
ok((await new Client('x').login('b@divingslot.test', 'Nueva12345')).user, 'entra con la contraseña nueva')

section('CSRF')
const req = new Request(ORIGIN + '/api/rpc/book_trip', { method: 'POST', headers: { Origin: 'https://malo.example', 'X-DivingSlot': '1', Cookie: B.cookie, 'Content-Type': 'application/json' }, body: '{}' })
ok((await handleApi(req, env, {})).status === 403, 'otro origen: 403')
const req2 = new Request(ORIGIN + '/api/rpc/book_trip', { method: 'POST', headers: { Cookie: B.cookie, 'Content-Type': 'application/json' }, body: '{}' })
ok((await handleApi(req2, env, {})).status === 403, 'sin cabecera X-DivingSlot: 403')

section('PayMongo')
await B.login('b@divingslot.test', 'Nueva12345') // cambiar la contraseña cerró sus otras sesiones
r = await centro.rest({ table: 'trips', op: 'insert', values: { center_id: CID, boat_id: BOAT, departs_at: dep(120), price_php: 2000, divers_per_guide: 4, status: 'published' }, returning: true, select: 'id' })
const T4 = r.data[0].id
const bk = (await B.rpc('book_trip', { p_trip: T4, p_seats: 1, p_with_gear: false, p_medical_signed: true })).data
r = await B.call('POST', '/api/functions/crear-pago', { booking_id: bk.id, kind: 'deposit', method: 'gcash', return_url: ORIGIN + '/' })
ok(r.checkout_url?.startsWith('https://checkout.paymongo.com/') && r.payment_id, 'crea la sesión de pago', r)
const pay = await db.prepare('SELECT * FROM payments WHERE id = ?').bind(r.payment_id).first()
const evt = JSON.stringify({ data: { attributes: { type: 'checkout_session.payment.paid', livemode: false, data: { id: pay.provider_ref } } } })
const ts = Math.floor(Date.now() / 1000)
const wh = (sig) => handleApi(new Request(ORIGIN + '/api/webhooks/paymongo', { method: 'POST', headers: { 'Paymongo-Signature': sig }, body: evt }), env, {})
ok((await wh(`t=${ts},te=${'0'.repeat(64)},li=`)).status === 401, 'webhook con firma falsa: 401')
const goodSig = `t=${ts},te=${await hmacHex('whsk_x', `${ts}.${evt}`)},li=`
ok((await (await wh(goodSig)).text()) === 'ok' && (await db.prepare('SELECT status FROM payments WHERE id = ?').bind(pay.id).first()).status === 'pending', 'firma buena pero PayMongo dice no pagado: no liquida')
pmSessions.get(pay.provider_ref).paid = true
await wh(goodSig); await wh(goodSig) // dos veces: idempotente
const after = await db.prepare('SELECT status, paid_php FROM bookings WHERE id = ?').bind(bk.id).first()
ok(after.status === 'confirmed' && after.paid_php === 1000, 'webhook liquida una sola vez', after)
r = await B.call('POST', '/api/functions/crear-pago', { action: 'check', payment_id: pay.id })
ok(r.status === 'paid', 'comprobación al volver', r)
ok((await A.call('POST', '/api/functions/crear-pago', { action: 'check', payment_id: pay.id })).error, 'otro usuario no consulta pagos ajenos')

section('fotos de la bitácora')
const uid = (await db.prepare("SELECT id FROM users WHERE email = 'b@divingslot.test'").first()).id
const bLogin = new Client('b2'); await bLogin.login('b@divingslot.test', 'Nueva12345')
const dB = (await bLogin.rest({ table: 'divers', select: 'id', single: 'single' })).data
r = await bLogin.rest({ table: 'dive_logs', op: 'insert', values: { diver_id: dB.id, dive_date: '2026-10-18', site_name: 'Napaling', max_depth_m: 24, rating: 5, share_with_center: true, center_id: CID }, returning: true, select: 'id' })
const LOG = r.data?.[0]?.id
ok(!!LOG, 'crea una inmersión', r)
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])
ok((await bLogin.raw('PUT', `/api/storage/upload/dive-photos/${uid}/${LOG}/1.png`, png)).status === 200, 'sube su foto')
ok((await A.raw('PUT', `/api/storage/upload/dive-photos/${uid}/${LOG}/2.png`, png)).status === 403, 'no sube en la carpeta de otro')
r = await bLogin.rest({ table: 'dive_log_photos', op: 'insert', values: { log_id: LOG, path: `${uid}/${LOG}/1.png` } })
ok(r.status === 200, 'registra la foto', r)
r = await bLogin.rest({ table: 'dive_logs', select: '*, centers(name), dive_log_photos(id, path)', filters: [['id', 'eq', LOG]], single: 'single' })
ok(r.data?.centers?.name === 'Casa Azul Divers' && r.data.dive_log_photos?.length === 1, 'bitácora con centro y fotos incrustados', r)
r = await anon.rpc('center_ratings')
ok(r.data?.[0]?.rating === 5, 'valoración agregada', r)
ok(sniff(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])) === 'image/heic', 'reconoce HEIC')

section('eliminar cuenta')
const del = many[19]
r = await del.rpc('delete_my_account', { p_dry_run: true })
ok(r.data?.ok === false && r.data.blockers?.length === 1 || r.data?.ok === true, 'dry run', r)
const free = many.find((c, i) => !results[i].data)
r = await free.rpc('delete_my_account', { p_dry_run: false })
ok(r.data?.deleted === true, 'borra una cuenta sin reservas', r)
ok((await free.call('GET', '/api/auth/session')).session === null, 'la sesión deja de valer')

console.log = log
console.log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
