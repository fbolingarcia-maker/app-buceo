// Pruebas de «otro día o reembolso» al cancelar el centro (sin red): node --no-warnings worker/test/rebook.mjs
import { D1 } from './shim.mjs'
import worker, { handleApi } from '../index.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', STAFF_MFA_OPTIONAL: '1', ASSETS: { fetch: () => new Response('app') } }
let fails = 0, passes = 0
const ok = (c, name, extra) => { if (c) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : '') } }
const section = (s) => console.log('·', s)
const mails = []
const log = console.log
console.log = (...a) => { if (a[0] === 'EMAIL (modo prueba)') mails.push({ to: a[1], subject: a[2], url: a[3] }); else log(...a) }
console.error = (...a) => { if (process.env.DEBUG) log(...a) }
globalThis.fetch = async (u) => { throw new Error('fetch no simulado ' + u) }
const pending = []

class Client {
  constructor() { this.cookie = ''; this.ip = '10.2.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }
  async raw(method, path, body) {
    const h = { Origin: ORIGIN, 'X-DivingSlot': '1', 'CF-Connecting-IP': this.ip }
    if (this.cookie) h.Cookie = this.cookie
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
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, verification_status) VALUES ('c1', 'Azul Divers', 'Panglao', 'socio', 'verified'), ('c2', 'Otro', 'Panglao', 'socio', 'verified')"),
  db.prepare("INSERT INTO boats (id, center_id, name, capacity) VALUES ('b1', 'c1', 'Banca', 10), ('b2', 'c2', 'Otra', 10)"),
])
const owner = new Client(), A = new Client(), B = new Client(), C = new Client()
await owner.signup('owner@x.test', { full_name: 'Olga Owner', account_type: 'center' })
const uidOf = async (e) => (await db.prepare('SELECT id FROM users WHERE email = ?').bind(e).first()).id
const diverOf = async (e) => (await db.prepare('SELECT d.id FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = ?').bind(e).first()).id
await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES ('c1', ?, 'owner')").bind(await uidOf('owner@x.test')).run()
await owner.call('POST', '/api/auth/login', { email: 'owner@x.test', password: 'Clave1234' })
const ids = []
for (const [i, c] of [A, B, C].entries()) {
  await c.signup(`d${i}@x.test`, { full_name: `Buceador ${i}` })
  ids.push(await diverOf(`d${i}@x.test`))
  await db.prepare("INSERT INTO certifications (diver_id, agency, level) VALUES (?, 'PADI', 'advanced')").bind(ids[i]).run()
}
const trip = (id, c, boat, h, price) => db.prepare("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, guides, status) VALUES (?, ?, ?, ?, ?, 4, 2, 'published')").bind(id, c, boat, dep(h), price)
await db.batch([trip('t1', 'c1', 'b1', 48, 3000), trip('t2', 'c1', 'b1', 96, 4000), trip('t3', 'c1', 'b1', 120, 2000), trip('tx', 'c2', 'b2', 96, 3000)])
const book = async (c, t) => (await c.rpc('book_trip', { p_trip: t, p_seats: 1, p_with_gear: false, p_medical_signed: true })).data
const bA = await book(A, 't1'), bB = await book(B, 't1'), bC = await book(C, 't1')
await A.rpc('confirm_payment_demo', { p_booking: bA.id, p_kind: 'full' })   // 3000 pagados
await B.rpc('confirm_payment_demo', { p_booking: bB.id, p_kind: 'full' })   // 3000 pagados
// C no paga nada
const guest = (await owner.rpc('add_manual_booking', { p_trip: 't1', p_guest: 'Walk-in', p_seats: 1, p_with_gear: false, p_source: 'walk_in' })).data

section('cancelar con motivo')
ok(code(await owner.rpc('cancel_trip_weather', { p_trip: 't1', p_reason: 'hack' })) === 'BAD_REASON', 'motivo no válido')
let r = await owner.rpc('cancel_trip_weather', { p_trip: 't1', p_reason: 'other', p_note: 'Motor del barco averiado' })
ok(r.data === 4, 'cancela las 4 reservas', r)
const tr = await db.prepare("SELECT status, cancel_reason, cancel_note FROM trips WHERE id = 't1'").first()
ok(tr.status === 'cancelled_weather' && tr.cancel_reason === 'other' && tr.cancel_note === 'Motor del barco averiado', 'guarda motivo y nota', tr)
const row = (id) => db.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first()
let a = await row(bA.id)
ok(a.status === 'cancelled_by_center' && a.refund_choice === 'pending' && a.refund_php === 0 && a.commission_php === 0 && Date.parse(a.choice_until) - Date.now() > 6.9 * 864e5, 'quien pagó elige (7 días), sin reembolso todavía', a)
const c0 = await row(bC.id), g0 = await row(guest.id)
ok(c0.refund_choice === null && c0.refund_php === 0 && g0.refund_choice === null && g0.status === 'cancelled_by_center', 'sin pago o manual: se cierra como antes', { c0, g0 })
ok(mails.some((m) => m.to === 'd0@x.test' && /elige otro día|another day/i.test(m.subject)) && !mails.some((m) => m.to === 'd2@x.test' && /cancel/i.test(m.subject)), 'email solo a quien tiene que elegir', mails.map((m) => m.subject))

section('opciones')
r = await A.rpc('rebook_options', { p_booking: bA.id })
ok(r.data?.credit_php === 3000 && r.data.trips.map((t) => t.id).join() === 't2,t3', 'solo salidas futuras del mismo centro', r)
ok(r.data?.trips[0].difference_php === 1000 && r.data.trips[1].difference_php === -1000, 'con la diferencia de precio', r.data?.trips)
ok(code(await B.rpc('rebook_options', { p_booking: bA.id })) === 'NOT_FOUND', 'otro buceador no ve la reserva ajena')
ok(code(await C.rpc('rebook_options', { p_booking: bC.id })) === 'BAD_STATE', 'sin pago no hay nada que elegir')

section('otro día más caro: paga la diferencia')
ok(code(await A.rpc('rebook_booking', { p_booking: bA.id, p_trip: 'tx' })) === 'OTHER_CENTER', 'no a otro centro')
ok((await row(bA.id)).refund_choice === 'pending', 'el intento fallido no gasta la elección')
r = await A.rpc('rebook_booking', { p_booking: bA.id, p_trip: 't2' })
ok(r.data?.moved_php === 3000 && r.data.refund_php === 0 && r.data.due_php === 1000 && r.data.booking.status === 'confirmed' && r.data.booking.paid_php === 3000, 'pasa 3000 y quedan 1000 por pagar', r)
a = await row(bA.id)
ok(a.refund_choice === 'rebooked' && a.rebooked_to === r.data.booking.id && a.moved_php === 3000 && a.refund_php === 0, 'la vieja apunta a la nueva', a)
ok((await row(r.data.booking.id)).rebooked_from === bA.id, 'la nueva apunta a la vieja')
ok(code(await A.rpc('rebook_booking', { p_booking: bA.id, p_trip: 't3' })) === 'BAD_STATE', 'solo una vez')
ok(code(await A.rpc('choose_refund', { p_booking: bA.id })) === 'BAD_STATE', 'y ya no puede pedir el reembolso')
r = await A.rpc('confirm_payment_demo', { p_booking: a.rebooked_to, p_kind: 'balance' })
ok(r.data?.paid_php === 4000, 'paga el resto en la reserva nueva', r)

section('otro día más barato: se devuelve la diferencia')
r = await B.rpc('rebook_booking', { p_booking: bB.id, p_trip: 't3' })
ok(r.data?.moved_php === 2000 && r.data.refund_php === 1000 && r.data.due_php === 0 && r.data.booking.status === 'confirmed', 'pasa 2000 y devuelve 1000', r)
ok((await row(bB.id)).refund_php === 1000, 'reembolso de la diferencia apuntado')

section('plazo vencido: reembolso automático')
const t4 = await db.batch([trip('t4', 'c1', 'b1', 30, 2500)])
const bA4 = await book(A, 't4')
await A.rpc('confirm_payment_demo', { p_booking: bA4.id, p_kind: 'deposit' })
await owner.rpc('cancel_trip_weather', { p_trip: 't4' })
ok((await db.prepare("SELECT cancel_reason FROM trips WHERE id = 't4'").first()).cancel_reason === 'weather', 'el motivo por defecto es el mar')
await db.prepare('UPDATE bookings SET choice_until = ? WHERE id = ?').bind(dep(-1), bA4.id).run()
ok(code(await A.rpc('rebook_booking', { p_booking: bA4.id, p_trip: 't3' })) === 'EXPIRED', 'fuera de plazo no se puede cambiar')
const { expireRebookChoices } = await import('../rebook.js')
ok(await expireRebookChoices(env) === 1, 'el cron cierra el plazo')
a = await row(bA4.id)
ok(a.refund_choice === 'refund' && a.refund_php === 1250, 'reembolso de lo pagado (la señal)', a)

section('elegir el reembolso')
const t5 = await db.batch([trip('t5', 'c1', 'b1', 30, 3000)])
const bB5 = await book(B, 't5')
await B.rpc('confirm_payment_demo', { p_booking: bB5.id, p_kind: 'full' })
await owner.rpc('cancel_trip_weather', { p_trip: 't5' })
r = await B.rpc('choose_refund', { p_booking: bB5.id })
ok(r.data?.refund_php === 3000 && r.data.refund_choice === 'refund', 'reembolso de todo', r)

section('cancelar por REST (editar la salida) sigue la misma regla')
await db.batch([trip('t6', 'c1', 'b1', 30, 3000)])
const bC6 = await book(C, 't6')
await C.rpc('confirm_payment_demo', { p_booking: bC6.id, p_kind: 'full' })
r = await owner.rest({ table: 'trips', op: 'update', values: { status: 'cancelled_weather' }, filters: [['id', 'eq', 't6']] })
ok((await row(bC6.id)).refund_choice === 'pending', 'también queda para elegir', r)

console.log(`${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
