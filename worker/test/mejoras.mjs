// Pruebas de las mejoras de noviembre (sin red): node --no-warnings worker/test/mejoras.mjs
// Enlace propio del centro, extras, tasas de santuario, última hora, pagar en el centro,
// recordatorio del resto 24 h antes, condiciones del mar, Green Fins y alergias en el manifiesto.
import { D1 } from './shim.mjs'
import worker, { handleApi } from '../index.js'
import { balanceReminders, expireUnpaidWithMoney } from '../cron.js'
import { seaLevel } from '../sea.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', PAYMONGO_SECRET_KEY: 'sk_test_x', PAYMONGO_WEBHOOK_SECRET: 'whsk_x', ASSETS: { fetch: () => new Response('app') } }
let fails = 0, passes = 0
const ok = (c, name, extra) => { if (c) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') } }
const section = (s) => console.log('·', s)
const mails = []
const log = console.log
console.log = (...a) => { if (a[0] === 'EMAIL (modo prueba)') mails.push({ to: a[1], subject: a[2], url: a[3] }); else log(...a) }
console.error = (...a) => { if (process.env.DEBUG) log(...a) }

// Open-Meteo y PayMongo simulados
const seaCalls = []
const pm = new Map()
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url)
  const hours = Array.from({ length: 8 * 24 }, (_, i) => new Date(Math.floor(Date.now() / 36e5) * 36e5 + (i - 2) * 36e5).toISOString().slice(0, 13) + ':00')
  if (u.startsWith('https://marine-api.open-meteo.com/')) { seaCalls.push(u); return new Response(JSON.stringify({ hourly: { time: hours, wave_height: hours.map(() => 1.7), swell_wave_height: hours.map(() => 0.9), wave_period: hours.map(() => 6) } })) }
  if (u.startsWith('https://api.open-meteo.com/')) return new Response(JSON.stringify({ hourly: { time: hours, wind_speed_10m: hours.map(() => 18), wind_gusts_10m: hours.map(() => 28), precipitation_probability: hours.map(() => 40) } }))
  if (u === 'https://api.paymongo.com/v1/checkout_sessions') { const id = 'cs_' + pm.size; pm.set(id, JSON.parse(opt.body)); return new Response(JSON.stringify({ data: { id, attributes: { checkout_url: 'https://checkout.paymongo.com/' + id } } })) }
  throw new Error('fetch no simulado ' + u)
}

class Client {
  constructor() { this.cookie = ''; this.ip = '10.1.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }
  async raw(method, path, body) {
    const h = { Origin: ORIGIN, 'X-DivingSlot': '1', 'CF-Connecting-IP': this.ip }
    if (this.cookie) h.Cookie = this.cookie
    if (body !== undefined) h['Content-Type'] = 'application/json'
    const res = await handleApi(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), env, { waitUntil: (p) => p })
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
  db.prepare("INSERT INTO destinations VALUES ('Panglao', 'Bohol', 'Visayas', 9.55, 123.77), ('Moalboal', 'Cebu', 'Visayas', 9.95, 123.39)"),
  db.prepare("INSERT INTO dive_sites (id, name, area, sanctuary_fee_php) VALUES ('s1', 'Balicasag', 'Panglao', 300), ('s2', 'Napaling', 'Panglao', 50)"),
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, verification_status, lat, lng) VALUES ('c1', 'Azul Divers', 'Panglao', 'socio', 'verified', 9.551, 123.771), ('c2', 'Otro Centro', 'Panglao', 'socio', 'verified', NULL, NULL)"),
  db.prepare("INSERT INTO boats (id, center_id, name, capacity) VALUES ('b1', 'c1', 'Banca', 8), ('b2', 'c2', 'Banca 2', 8)"),
])
const staff = new Client(), A = new Client(), B = new Client(), C = new Client(), anon = new Client()
await staff.signup('staff@x.test', { full_name: 'Ana Centro', account_type: 'center' })
const sid = (await db.prepare("SELECT id FROM users WHERE email = 'staff@x.test'").first()).id
await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES ('c1', ?, 'owner')").bind(sid).run()
await staff.call('POST', '/api/auth/login', { email: 'staff@x.test', password: 'Clave1234' })
for (const [c, e] of [[A, 'a@x.test'], [B, 'b@x.test'], [C, 'c@x.test']]) {
  await c.signup(e, { full_name: e[0].toUpperCase() + ' Pérez' })
  const d = (await c.rest({ table: 'divers', select: 'id', single: 'single' })).data
  await c.rest({ table: 'certifications', op: 'insert', values: { diver_id: d.id, agency: 'PADI', level: 'advanced' } })
}
const diverOf = async (email) => (await db.prepare('SELECT d.id FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = ?').bind(email).first()).id
let r = await staff.rest({ table: 'trips', op: 'insert', values: { center_id: 'c1', boat_id: 'b1', departs_at: dep(30), price_php: 3000, gear_rental_php: 500, divers_per_guide: 4, guides: 2, status: 'published', include_fees: true }, returning: true, select: 'id' })
const T = r.data?.[0]?.id
ok(!!T, 'salida con tasas incluidas', r)
await staff.rest({ table: 'trip_sites', op: 'insert', values: [{ trip_id: T, site_id: 's1', position: 1 }, { trip_id: T, site_id: 's2', position: 2 }] })

section('extras del centro')
r = await staff.rest({ table: 'center_extras', op: 'insert', values: [
  { center_id: 'c1', kind: 'insurance', name: 'Seguro de buceo 1 día', price_php: 400, per_seat: true },
  { center_id: 'c1', kind: 'video', name: 'Vídeo de la salida', price_php: 1500, per_seat: false },
  { center_id: 'c1', kind: 'photo', name: 'Fotos (retirado)', price_php: 900, active: false }], returning: true, select: 'id, name, active' })
ok(r.data?.length === 3, 'el centro crea extras', r)
const [INS, VID, OFF] = r.data.map((x) => x.id)
ok((await A.rest({ table: 'center_extras', op: 'insert', values: { center_id: 'c1', name: 'x', price_php: 1 } })).status === 403, 'un buceador no crea extras')
r = await anon.rest({ table: 'center_extras', select: 'id', filters: [['center_id', 'eq', 'c1']] })
ok(r.data?.length === 2, 'los inactivos no se ven', r)

section('ficha pública: tasas y última hora')
r = await anon.rest({ table: 'published_trips', select: 'fees_php, include_fees, last_minute_pct', filters: [['id', 'eq', T]], single: 'single' })
ok(r.data?.fees_php === 350 && r.data.include_fees === true && r.data.last_minute_pct === 0, 'tasas por plaza 300 + 50', r)

section('reserva por el enlace del centro con extras y tasas')
r = await A.rpc('book_trip', { p_trip: T, p_seats: 2, p_with_gear: true, p_medical_signed: true, p_ref: 'c1', p_extras: [INS, VID] })
const BA = r.data
// 2 × 3000 + 2 × 500 + 2 × 350 + 2 × 400 + 1500 = 10000
ok(BA?.amount_php === 10000 && BA.fees_php === 700 && BA.extras_php === 2300 && BA.channel === 'direct' && BA.commission_php === 500 && BA.deposit_php === 5000, 'importe con tasas y extras; por el enlace propio también paga comisión', r)
r = await A.rest({ table: 'booking_extras', select: 'name, qty, price_php', filters: [['booking_id', 'eq', BA.id]] })
ok(r.data?.length === 2 && r.data.some((x) => x.qty === 2), 'extras guardados en la reserva', r)
ok(code(await B.rpc('book_trip', { p_trip: T, p_seats: 1, p_with_gear: false, p_medical_signed: true, p_extras: [OFF] })) === 'BAD_EXTRA', 'un extra inactivo no se puede añadir')
r = await B.rpc('book_trip', { p_trip: T, p_seats: 1, p_with_gear: false, p_medical_signed: true, p_ref: 'c2' })
ok(r.data?.channel === 'marketplace' && r.data.commission_php === 250 && r.data.amount_php === 3350, 'el enlace de otro centro no cuenta como suyo: marketplace, ₱250', r)
const BB = r.data

section('pago de la reserva')
r = await A.rpc('confirm_payment_demo', { p_booking: BA.id, p_kind: 'full' })
ok(r.data?.paid_php === 10000 && r.data.status === 'confirmed', 'A paga todo (demo)', r)
ok((await anon.rpc('get_share', { p_token: 'f'.repeat(32) })).status === 404, 'el pago dividido ya no existe')

section('pagar el resto en el centro y recordatorio 24 h antes')
await B.rpc('confirm_payment_demo', { p_booking: BB.id, p_kind: 'deposit' })
r = await B.rpc('set_pay_on_site', { p_booking: BB.id, p_on: true })
ok(r.data?.pay_on_site === true, 'B elige pagar el resto en efectivo', r)
await C.rpc('book_trip', { p_trip: T, p_seats: 1, p_with_gear: false, p_medical_signed: true })
const BC = (await db.prepare('SELECT id FROM bookings WHERE diver_id = ?').bind(await diverOf('c@x.test')).first()).id
await C.rpc('confirm_payment_demo', { p_booking: BC, p_kind: 'deposit' })
await db.prepare('UPDATE trips SET departs_at = ? WHERE id = ?').bind(dep(24), T).run()
mails.length = 0
let n = await balanceReminders(env, ORIGIN)
ok(n === 2 && mails.some((m) => m.to === 'c@x.test' && /Paga el resto/.test(m.subject)) && mails.some((m) => m.to === 'b@x.test' && /Mañana buceas/.test(m.subject)), 'recordatorios: enlace de pago y aviso de efectivo', mails)
ok(!mails.some((m) => m.to === 'a@x.test'), 'quien ya pagó todo no recibe nada')
ok((await balanceReminders(env, ORIGIN)) === 0, 'no se repite')

section('cobro en efectivo marcado en la app')
r = await staff.rpc('record_cash_payment', { p_booking: BB.id })
ok(r.data?.paid_php === 3350, 'el centro marca el efectivo', r)

section('última hora')
ok(code(await staff.rpc('set_last_minute', { p_trip: T, p_pct: 60 })) === 'BAD_PCT', 'descuento máximo 50 %')
ok(code(await A.rpc('set_last_minute', { p_trip: T, p_pct: 20 })) === 'FORBIDDEN', 'solo el centro')
const dA2 = await diverOf('a@x.test')
await db.prepare(`UPDATE divers SET alert_destinations = '["Panglao"]' WHERE id = ?`).bind(dA2).run()
const dB2 = await diverOf('b@x.test')
await db.prepare(`UPDATE divers SET alert_destinations = '["Moalboal"]' WHERE id = ?`).bind(dB2).run()
// un buceador más, apuntado a Panglao, sin reserva
const D = new Client(); await D.signup('d@x.test', { full_name: 'D Ruiz' })
await db.prepare(`UPDATE divers SET alert_destinations = '["Panglao"]' WHERE id = ?`).bind(await diverOf('d@x.test')).run()
mails.length = 0
r = await staff.rpc('set_last_minute', { p_trip: T, p_pct: 20, p_notify: true })
ok(r.data?.notified === 1 && mails.length === 1 && mails[0].to === 'd@x.test' && mails[0].url?.endsWith('/app/#/salida/' + T), 'avisa solo a quien sigue Panglao y no está apuntado', { r, mails })
r = await staff.rpc('set_last_minute', { p_trip: T, p_pct: 25, p_notify: true })
ok(r.data?.notified === 0, 'el aviso sale una sola vez', r)
r = await anon.rest({ table: 'published_trips', select: 'last_minute_pct, price_php', filters: [['id', 'eq', T]], single: 'single' })
ok(r.data?.last_minute_pct === 25, 'la ficha muestra el descuento', r)
await D.rest({ table: 'certifications', op: 'insert', values: { diver_id: await diverOf('d@x.test'), agency: 'SSI', level: 'open_water' } })
r = await D.rpc('book_trip', { p_trip: T, p_seats: 1, p_with_gear: false, p_medical_signed: true })
// 3000 × 75 % = 2250 + 350 tasas
ok(r.data?.amount_php === 2600 && r.data.discount_php === 750, 'reserva con el descuento de última hora', r)

section('condiciones del mar')
ok(seaLevel({ wave_m: 1.6, wind_kmh: 10 }) === 'rough' && seaLevel({ wave_m: 0.4, wind_kmh: 22 }) === 'moderate' && seaLevel({ wave_m: 0.3, wind_kmh: 8, gust_kmh: 15 }) === 'good', 'umbrales')
await db.batch([
  db.prepare("INSERT INTO dive_logs (diver_id, site_id, site_name, dive_date, visibility_m) VALUES (?, 's1', 'Balicasag', date('now', '-3 days'), 25), (?, NULL, 'Napaling', date('now', '-10 days'), 15), (?, NULL, 'Napaling', date('now', '-90 days'), 5)").bind(dA2, dA2, dA2),
])
r = await anon.call('GET', '/api/sea?trip=' + T)
ok(r.forecast?.level === 'rough' && r.forecast.wave_m === 1.7 && r.forecast.wind_kmh === 18 && r.visibility?.avg_m === 20 && r.visibility.n === 2, 'previsión y visibilidad de la bitácora', r)
ok(seaCalls[0]?.includes('latitude=9.55&longitude=123.77'), 'usa la ubicación del centro', seaCalls[0])
const T2 = (await staff.rest({ table: 'trips', op: 'insert', values: { center_id: 'c1', boat_id: 'b1', departs_at: dep(24 * 10), price_php: 3000, divers_per_guide: 4, status: 'published' }, returning: true, select: 'id' })).data[0].id
r = await anon.call('GET', '/api/sea?trip=' + T2)
ok(r.forecast === null && r.reason === 'too_far' && r.at?.lat === 9.55, 'más de 7 días: sin previsión, pero con el punto para Windy', r)

section('Green Fins')
r = await staff.rest({ table: 'centers', op: 'update', values: { green_fins: 'member', eco: { reef_safe: true, mooring: true } }, filters: [['id', 'eq', 'c1']], returning: true, select: 'green_fins, eco' })
ok(r.data?.[0]?.green_fins === 'member' && r.data[0].eco.mooring === true, 'el centro declara el sello y sus prácticas', r)
r = await staff.rest({ table: 'centers', op: 'update', values: { green_fins_verified: true }, filters: [['id', 'eq', 'c1']] })
ok(r.status === 403, 'el centro no se marca como comprobado', r)
r = await anon.rest({ table: 'published_trips', select: 'center_green_fins', filters: [['id', 'eq', T]], single: 'single' })
ok(r.data?.center_green_fins === 'member', 'el sello sale en las salidas', r)

section('alergias en el manifiesto')
await A.rest({ table: 'divers', op: 'update', values: { allergies: 'Penicilina' }, filters: [['id', 'eq', dA2]] })
r = await staff.rest({ table: 'trips', select: 'id, bookings(id, divers(full_name, allergies))', filters: [['id', 'eq', T]], single: 'single' })
ok(r.data?.bookings?.some((x) => x.divers?.allergies === 'Penicilina'), 'el centro de la salida ve las alergias', r)
r = await B.rest({ table: 'divers', select: 'allergies', filters: [['id', 'eq', dA2]] })
ok((r.data || []).length === 0, 'otro buceador no las ve', r)

section('reserva caducada con algo pagado')
const T3 = (await staff.rest({ table: 'trips', op: 'insert', values: { center_id: 'c1', boat_id: 'b1', departs_at: dep(72), price_php: 2000, divers_per_guide: 4, status: 'published' }, returning: true, select: 'id' })).data[0].id
const b3 = (await B.rpc('book_trip', { p_trip: T3, p_seats: 2, p_with_gear: false, p_medical_signed: true })).data
await db.prepare("UPDATE bookings SET paid_php = 1000, created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(b3.id).run()
ok((await expireUnpaidWithMoney(env)) === 1, 'el cron la cancela')
let b = await db.prepare('SELECT status, refund_php FROM bookings WHERE id = ?').bind(b3.id).first()
ok(b.status === 'cancelled_by_diver' && b.refund_php === 1000, 'con reembolso de lo pagado', b)

section('tasas que pone el centro')
await staff.rest({ table: 'trips', op: 'update', values: { fees_per_diver: 200 }, filters: [['id', 'eq', T]] })
r = await anon.rest({ table: 'published_trips', select: 'fees_php', filters: [['id', 'eq', T]], single: 'single' })
ok(r.data?.fees_php === 200, 'la cifra del centro sustituye a la suma de los puntos', r)

section('enlace de reservas del centro')
const res = await worker.fetch(new Request(ORIGIN + '/r/' + '0a0a0a0a-0000-4000-8000-000000000001'), env, {})
ok(res.status === 302 && res.headers.get('Location') === ORIGIN + '/app/#/r/0a0a0a0a-0000-4000-8000-000000000001', '/r/<id> lleva a la app', res.headers.get('Location'))

console.log = log
console.log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
