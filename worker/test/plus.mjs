// Pruebas de las mejoras de usabilidad del 9 nov (sin red): node --no-warnings worker/test/plus.mjs
// Enlace propio del centro, extras, tasas de santuario, última hora, pagar en el centro,
// recordatorio del resto 24 h antes, condiciones del mar, Green Fins y alergias en el manifiesto.
import { D1 } from './shim.mjs'
import worker, { handleApi } from '../index.js'
import { RPC } from '../rpc.js'
import { processAllWaitlists } from '../plus.js'
import { encryptPayload } from '../push.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', STAFF_MFA_OPTIONAL: '1', PAYMONGO_SECRET_KEY: 'sk_test_x', PAYMONGO_WEBHOOK_SECRET: 'whsk_x', ASSETS: { fetch: () => new Response('app') } }
let fails = 0, passes = 0
const ok = (c, name, extra) => { if (c) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') } }
const section = (s) => console.log('·', s)
const mails = []
const log = console.log
console.log = (...a) => { if (a[0] === 'EMAIL (modo prueba)') mails.push({ to: a[1], subject: a[2], url: a[3] }); else log(...a) }
console.error = (...a) => { if (process.env.DEBUG) log(...a) }

// Open-Meteo y PayMongo simulados
const seaCalls = [], pushes = [], pending = []
const pm = new Map()
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url)
  const hours = Array.from({ length: 8 * 24 }, (_, i) => new Date(Math.floor(Date.now() / 36e5) * 36e5 + (i - 2) * 36e5).toISOString().slice(0, 13) + ':00')
  if (u.startsWith('https://marine-api.open-meteo.com/')) { seaCalls.push(u); return new Response(JSON.stringify({ hourly: { time: hours, wave_height: hours.map(() => 1.7), swell_wave_height: hours.map(() => 0.9), wave_period: hours.map(() => 6) } })) }
  if (u.startsWith('https://api.open-meteo.com/')) return new Response(JSON.stringify({ hourly: { time: hours, wind_speed_10m: hours.map(() => 18), wind_gusts_10m: hours.map(() => 28), precipitation_probability: hours.map(() => 40) } }))
  if (u === 'https://api.paymongo.com/v1/checkout_sessions') { const id = 'cs_' + pm.size; pm.set(id, JSON.parse(opt.body)); return new Response(JSON.stringify({ data: { id, attributes: { checkout_url: 'https://checkout.paymongo.com/' + id } } })) }
  if (u.startsWith('https://push.example.test/')) { pushes.push(u); return new Response('', { status: 201 }) }
  throw new Error('fetch no simulado ' + u)
}

class Client {
  constructor() { this.cookie = ''; this.ip = '10.1.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }
  async raw(method, path, body) {
    const h = { Origin: ORIGIN, 'X-DivingSlot': '1', 'CF-Connecting-IP': this.ip }
    if (this.cookie) h.Cookie = this.cookie
    if (this.lang) h['X-Lang'] = this.lang
    if (body !== undefined) h['Content-Type'] = 'application/json'
    const res = await handleApi(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), env, { waitUntil: (p) => pending.push(p) })
    await Promise.all(pending.splice(0))
    const sc = res.headers.get('Set-Cookie')
    if (sc) { const v = sc.split(';')[0]; this.cookie = v.endsWith('=') ? '' : v }
    return res
  }
  async call(m, p, b) { const r = await this.raw(m, p, b); const j = await r.json().catch(() => null); return { status: r.status, ...j } }
  rest(q) { return this.call('POST', '/api/rest', q) }
  rpc(n, a) { return this.call('POST', '/api/rpc/' + n, a) }
  async signup(email, data = {}) {
    await this.call('POST', '/api/auth/signup', { email, password: 'Clave1234', data })
    const link = new URL(mails.filter((m) => m.to === email).pop().url)
    await this.raw('GET', link.pathname + link.search)
  }
}
const code = (r) => r.error?.message?.split(':')[0]
const dep = (h) => new Date(Date.now() + h * 36e5).toISOString()


section('datos')
await db.batch([
  db.prepare("INSERT INTO destinations VALUES ('Panglao', 'Bohol', 'Visayas', 9.55, 123.77)"),
  db.prepare("INSERT INTO dive_sites (id, name, area) VALUES ('s1', 'Balicasag', 'Panglao')"),
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, verification_status) VALUES ('c1', 'Azul Divers', 'Panglao', 'socio', 'verified')"),
  db.prepare("INSERT INTO boats (id, center_id, name, capacity) VALUES ('b1', 'c1', 'Banca', 2)"),
])
const staff = new Client(), A = new Client(), B = new Client(), C = new Client(), anon = new Client()
await staff.signup('staff@x.test', { full_name: 'Ana Centro', account_type: 'center' })
const sid = (await db.prepare("SELECT id FROM users WHERE email = 'staff@x.test'").first()).id
await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES ('c1', ?, 'owner')").bind(sid).run()
await staff.call('POST', '/api/auth/login', { email: 'staff@x.test', password: 'Clave1234' })
for (const [c, e] of [[A, 'a@x.test'], [B, 'b@x.test'], [C, 'c@x.test']]) {
  await c.signup(e, { full_name: e[0].toUpperCase() + ' Pérez' })
  const d = (await c.rest({ table: 'divers', select: 'id', single: 'single' })).data
  if (e !== 'c@x.test') await c.rest({ table: 'certifications', op: 'insert', values: { diver_id: d.id, agency: 'PADI', level: 'advanced' } })
}
const diverOf = async (email) => (await db.prepare('SELECT d.id FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = ?').bind(email).first()).id
const mk = async (h, extra = {}) => (await staff.rest({ table: 'trips', op: 'insert', values: { center_id: 'c1', boat_id: 'b1', departs_at: dep(h), price_php: 3000, divers_per_guide: 4, guides: 1, status: 'published', ...extra }, returning: true, select: 'id' })).data[0].id
const T = await mk(48)

section('lista de espera')
let r = await A.rpc('book_trip', { p_trip: T, p_seats: 2, p_with_gear: false, p_medical_signed: true })
const BA = r.data
ok(BA?.status === 'pending_payment', 'A reserva las 2 plazas', r)
ok(code(await B.rpc('join_waitlist', { p_trip: T, p_seats: 1, p_medical_signed: false })) === 'NO_MEDICAL', 'la lista de espera pide la declaración médica')
r = await B.rpc('join_waitlist', { p_trip: T, p_seats: 1, p_medical_signed: true })
ok(r.data?.position === 1, 'B entra en la lista (1.º)', r)
ok(code(await B.rpc('join_waitlist', { p_trip: T, p_seats: 1, p_medical_signed: true })) === 'DUPLICATE', 'no se apunta dos veces')
r = await anon.rest({ table: 'published_trips', select: 'waitlist, available_seats', filters: [['id', 'eq', T]], single: 'single' })
ok(r.data?.waitlist === 1 && r.data.available_seats === 0, 'la ficha muestra 1 en espera', r)
mails.length = 0
r = await A.rpc('cancel_my_booking', { p_booking: BA.id })
ok(r.data?.status === 'cancelled_by_diver', 'A cancela', r)
const wb = await db.prepare("SELECT w.status, b.status AS bstatus, b.hold_until FROM trip_waitlist w JOIN bookings b ON b.id = w.booking_id WHERE w.trip_id = ?").bind(T).first()
ok(wb?.status === 'offered' && wb.bstatus === 'pending_payment' && Date.parse(wb.hold_until) - Date.now() > 25 * 60000, 'B recibe la plaza retenida 30 min', wb)
ok(mails.some((m) => m.to === 'b@x.test' && /A spot opened up/.test(m.subject)), 'y un email', mails)
r = await B.rpc('my_waitlist', {})
ok(r.data?.[0]?.status === 'offered', 'B ve su oferta', r)
const bB = (await db.prepare("SELECT booking_id FROM trip_waitlist WHERE trip_id = ?").bind(T).first()).booking_id
await B.rpc('confirm_payment_demo', { p_booking: bB, p_kind: 'deposit' })
await processAllWaitlists(env, RPC)
ok((await db.prepare("SELECT status FROM trip_waitlist WHERE trip_id = ?").bind(T).first()).status === 'booked', 'al pagar queda como reservada')
ok(code(await C.rpc('join_waitlist', { p_trip: T, p_seats: 1, p_medical_signed: true })) === 'LEVEL', 'sin certificación no entra en la lista')

section('chat de la salida')
ok((await anon.rpc('trip_messages', { p_trip: T })).status >= 400, 'sin sesión no se ve el chat')
ok(code(await C.rpc('post_trip_message', { p_trip: T, p_body: 'hola' })) === 'FORBIDDEN', 'sin plaza no se escribe')
r = await staff.rpc('post_trip_message', { p_trip: T, p_body: 'Quedamos a las 7:00 en el muelle' })
ok(!!r.data?.id, 'el centro escribe', r)
await B.rpc('post_trip_message', { p_trip: T, p_body: 'Perfecto, allí estaré' })
r = await B.rpc('trip_messages', { p_trip: T })
ok(r.data?.length === 2 && r.data[0].is_staff && r.data[0].author === 'Azul Divers' && r.data[1].mine && r.data[1].author === 'B P.', 'B ve los dos mensajes', r)

section('bonos y reserva anticipada')
await staff.rest({ table: 'center_packs', op: 'insert', values: { center_id: 'c1', name: '3 salidas', trips: 2, discount_pct: 10, valid_days: 14 } })
ok((await A.rest({ table: 'center_packs', op: 'insert', values: { center_id: 'c1', name: 'x', trips: 2, discount_pct: 10 } })).status === 403, 'un buceador no crea bonos')
const T2 = await mk(72), T3 = await mk(24 * 20, { early_pct: 10, early_days: 14 })
r = await anon.rest({ table: 'published_trips', select: 'early_pct', filters: [['id', 'eq', T3]], single: 'single' })
ok(r.data?.early_pct === 10, 'la reserva anticipada se ve en la ficha', r)
r = await B.rpc('book_trip', { p_trip: T2, p_seats: 1, p_with_gear: false, p_medical_signed: true })
ok(r.data?.amount_php === 2700 && r.data.discount_php === 300, 'segunda salida de B en 14 días: bono −10 %', r)
r = await A.rpc('book_trip', { p_trip: T3, p_seats: 1, p_with_gear: false, p_medical_signed: true })
ok(r.data?.amount_php === 2700, 'reserva con 20 días: −10 % anticipada', r)

section('cursos')
const TC = await mk(96, { kind: 'course', course_name: 'Open Water', course_days: 3, min_level: 'open_water' })
r = await C.rpc('book_trip', { p_trip: TC, p_seats: 1, p_with_gear: true, p_medical_signed: true })
ok(r.data?.status === 'pending_payment', 'un curso Open Water no pide certificación', r)
const TA = await mk(100, { kind: 'course', course_name: 'Advanced', course_prereq: 'open_water' })
ok(code(await C.rpc('book_trip', { p_trip: TA, p_seats: 1, p_with_gear: false, p_medical_signed: true })) === 'LEVEL', 'el Advanced pide el Open Water')

section('salidas repetidas')
const day = (n) => new Date(Date.now() + 8 * 36e5 + n * 864e5).toISOString().slice(0, 10)
r = await staff.rpc('repeat_trip', { p_trip: T2, p_dates: [day(5), day(6), day(7)] })
ok(r.data?.created === 3 && r.data.status === 'published', 'repite la salida 3 días', r)
ok(code(await A.rpc('repeat_trip', { p_trip: T2, p_dates: [day(5)] })) === 'FORBIDDEN', 'solo el centro')

section('reseñas y bitácora firmada')
const old = await mk(1)
await db.prepare('UPDATE trips SET departs_at = ? WHERE id = ?').bind(dep(-30), old).run()
const dB = await diverOf('b@x.test')
await db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, source, status, amount_php, deposit_php, paid_php, checked_in_at, created_at) VALUES ('ob', ?, ?, 1, 'app', 'confirmed', 3000, 1500, 3000, ?, ?)").bind(old, dB, dep(-31), dep(-40)).run()
ok(code(await B.rpc('submit_review', { p_booking: BA.id, p_rating: 5 })) === 'NOT_FOUND', 'no se valora una reserva ajena')
r = await B.rpc('submit_review', { p_booking: 'ob', p_rating: 4, p_body: 'Muy buenos guías' })
ok(r.data?.ok, 'B valora el centro', r)
r = await anon.rpc('center_reviews', { p_center: 'c1' })
ok(r.data?.count === 1 && r.data.avg === 4 && r.data.reviews[0].author === 'B P.', 'reseña pública con nombre corto', r)
const rid = r.data.reviews[0].id
ok(code(await A.rpc('reply_review', { p_review: rid, p_reply: 'x' })) === 'FORBIDDEN', 'solo el centro responde')
await staff.rpc('reply_review', { p_review: rid, p_reply: 'Gracias, vuelve pronto' })
ok((await anon.rpc('center_reviews', { p_center: 'c1' })).data.reviews[0].reply === 'Gracias, vuelve pronto', 'respuesta visible')
const logDay = new Date(Date.parse(dep(-30)) + 8 * 36e5).toISOString().slice(0, 10)
r = await B.rest({ table: 'dive_logs', op: 'insert', values: { diver_id: dB, dive_date: logDay, site_name: 'Balicasag', signed_by_center: 'c1' } })
ok(r.status === 403, 'el buceador no puede firmarse la bitácora', r)
await B.rest({ table: 'dive_logs', op: 'insert', values: { diver_id: dB, dive_date: logDay, site_name: 'Balicasag' } })
r = await staff.rpc('sign_trip_logs', { p_trip: old })
ok(r.data?.signed === 1, 'el centro firma la inmersión', r)
r = await B.rest({ table: 'dive_logs', select: 'signed_by_center', single: 'single' })
ok(r.data?.signed_by_center === 'c1', 'queda firmada', r)

section('experiencia en «¿Quién va?»')
r = await A.rpc('trip_divers', { p_trip: T })
ok(['regular', 'new'].includes(r.data?.divers?.[0]?.exp), 'nivel de experiencia', r)

section('avisos en el móvil')
r = await anon.rpc('push_key', {})
ok(/^[A-Za-z0-9_-]{80,}$/.test(r.data?.key || ''), 'clave VAPID pública', r)
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
const b64u = (b) => Buffer.from(b).toString('base64url')
const sub = { endpoint: 'https://push.example.test/abc1234567', p256dh: b64u(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) }
r = await B.rpc('push_subscribe', { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth, p_lang: 'es' })
ok(r.data?.ok, 'B activa los avisos', r)
const body = await encryptPayload(sub, JSON.stringify({ title: 'x' }))
ok(body.length === 16 + 4 + 1 + 65 + JSON.stringify({ title: 'x' }).length + 1 + 16, 'cuerpo aes128gcm con cabecera', body.length)
pushes.length = 0
await staff.rpc('post_trip_message', { p_trip: T, p_body: 'Mar en calma' })
ok(pushes.some((u) => u === sub.endpoint), 'el mensaje del centro llega como aviso a B', pushes)


section('idioma de los emails')
{
  const D = new Client(); D.lang = 'de'
  await D.signup('d@x.test', { full_name: 'Dora Schmidt' })
  ok(/Bestätige/.test(mails.filter((m) => m.to === 'd@x.test')[0]?.subject || ''), 'el email de alta llega en el idioma de la app (alemán)', mails.filter((m) => m.to === 'd@x.test'))
  ok((await db.prepare("SELECT d.locale FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = 'd@x.test'").first())?.locale === 'de', 'y el idioma queda guardado en el perfil')
  D.lang = 'ko'; await D.raw('GET', '/api/auth/session')
  ok((await db.prepare("SELECT d.locale FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = 'd@x.test'").first())?.locale === 'ko', 'al cambiar el idioma en la app se actualiza el perfil')
  const E = new Client()
  await E.call('POST', '/api/auth/recover', { email: 'd@x.test' })
  ok(/새 비밀번호/.test(mails.filter((m) => m.to === 'd@x.test').pop()?.subject || ''), 'sin idioma en la petición, usa el del perfil (coreano)')
  E.lang = 'es'; await E.call('POST', '/api/auth/recover', { email: 'd@x.test' })
  ok(/Nueva contraseña/.test(mails.filter((m) => m.to === 'd@x.test').pop()?.subject || ''), 'con la app en español, en español')
}
console.log('\n' + passes + ' bien, ' + fails + ' mal')
process.exit(fails ? 1 : 0)
