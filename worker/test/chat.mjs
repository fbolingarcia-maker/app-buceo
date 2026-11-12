// Pruebas del chat privado buceador–centro (sin red): node --no-warnings worker/test/chat.mjs
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
  db.prepare("INSERT INTO dive_sites (id, name, area, max_depth_m) VALUES ('s1', 'Balicasag', 'Panglao', 40)"),
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, verification_status) VALUES ('c1', 'Azul Divers', 'Panglao', 'socio', 'verified'), ('c2', 'Otro', 'Panglao', 'socio', 'verified')"),
  db.prepare("INSERT INTO boats (id, center_id, name, capacity) VALUES ('b1', 'c1', 'Banca', 10)"),
])
const owner = new Client(), A = new Client(), X = new Client(), other = new Client(), anon = new Client()
await owner.signup('owner@x.test', { full_name: 'Olga Owner', account_type: 'center' })
await other.signup('otro@x.test', { full_name: 'Otro Centro', account_type: 'center' })
for (const [e, c] of [['owner@x.test', 'c1'], ['otro@x.test', 'c2']]) {
  const uid = (await db.prepare('SELECT id FROM users WHERE email = ?').bind(e).first()).id
  await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES (?, ?, 'owner')").bind(c, uid).run()
}
await owner.call('POST', '/api/auth/login', { email: 'owner@x.test', password: 'Clave1234' })
await other.call('POST', '/api/auth/login', { email: 'otro@x.test', password: 'Clave1234' })
await A.signup('a@x.test', { full_name: 'Ana Pérez' })
await X.signup('x@x.test', { full_name: 'Xavi Intruso' })
const dA = (await db.prepare("SELECT d.id FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = 'a@x.test'").first()).id
await db.prepare("UPDATE divers SET allergies = 'Penicilina', wetsuit_size = 'M', insurance_provider = 'DAN' WHERE id = ?").bind(dA).run()
await A.rest({ table: 'certifications', op: 'insert', values: { diver_id: dA, agency: 'PADI', level: 'advanced' } })
await db.batch([
  db.prepare("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, guides, status) VALUES ('t1', 'c1', 'b1', ?, 3000, 4, 2, 'published')").bind(dep(48)),
  db.prepare("INSERT INTO trip_sites (trip_id, site_id, position) VALUES ('t1', 's1', 1)"),
  db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, status, amount_php) VALUES ('bk1', 't1', ?, 1, 'confirmed', 3000)").bind(dA),
])

section('el buceador escribe desde su reserva')
let r = await A.rpc('booking_chat', { p_booking: 'bk1' })
ok(r.data?.side === 'diver' && r.data.messages.length === 0 && r.data.trip?.center_name === 'Azul Divers' && r.data.diver === null, 'abre el hilo de su reserva (sin ficha del buceador)', r)
r = await A.rpc('booking_chat_send', { p_booking: 'bk1', p_body: '¿Puedo llevar mi ordenador de buceo?' })
ok(r.data?.id, 'envía un mensaje', r)
ok(mails.filter((m) => m.to === 'owner@x.test' && /Ana/.test(m.subject)).length === 1, 'al centro le llega un email', mails.slice(-1))
const raw = await db.prepare("SELECT body FROM booking_messages WHERE booking_id = 'bk1'").first()
ok(raw?.body?.startsWith('v1.') && !raw.body.includes('ordenador'), 'en la base de datos el mensaje está cifrado', raw)
await A.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'Y otra cosa: voy con nitrox' })
ok(mails.filter((m) => m.to === 'owner@x.test' && /Ana/.test(m.subject)).length === 1, 'el segundo mensaje sin leer no manda otro email')

section('privacidad')
ok(code(await X.rpc('booking_chat', { p_booking: 'bk1' })) === 'FORBIDDEN', 'otro buceador no lo ve')
ok(code(await other.rpc('booking_chat', { p_booking: 'bk1' })) === 'FORBIDDEN', 'otro centro tampoco')
ok(code(await other.rpc('chat_inbox', { p_center: 'c1' })) === 'FORBIDDEN', 'ni su bandeja')
// Un administrador de la plataforma tampoco (ni siquiera en «Ver como centro»)
const adminUid = (await db.prepare("SELECT id FROM users WHERE email = 'x@x.test'").first()).id
await db.prepare('INSERT INTO platform_admins (user_id) VALUES (?)').bind(adminUid).run()
ok(code(await X.rpc('booking_chat', { p_booking: 'bk1' })) === 'FORBIDDEN', 'un administrador no puede leer la conversación')
ok(code(await X.rpc('chat_inbox', { p_center: 'c1' })) === 'FORBIDDEN', 'ni la bandeja del centro')
await db.prepare('DELETE FROM platform_admins WHERE user_id = ?').bind(adminUid).run()
ok(code(await anon.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'hola' })) === 'FORBIDDEN', 'sin sesión no se escribe')
ok((await X.rest({ table: 'booking_messages' })).status === 404, 'la tabla no se lee por REST')

section('bandeja y ficha del centro')
r = await owner.rpc('chat_unread', {})
ok(r.data?.center === 2, 'el centro tiene 2 sin leer', r)
r = await owner.rpc('chat_inbox', { p_center: 'c1' })
ok(r.data?.length === 1 && r.data[0].booking_id === 'bk1' && r.data[0].unread === 2 && r.data[0].diver_name === 'Ana Pérez' && /nitrox/.test(r.data[0].last_body), 'la bandeja muestra el hilo con 2 sin leer', r)
r = await owner.rpc('booking_chat', { p_booking: 'bk1' })
const dv = r.data?.diver
ok(r.data?.side === 'center' && r.data.messages.length === 2 && dv?.full_name === 'Ana Pérez' && dv.allergies === 'Penicilina' && dv.certifications?.[0]?.level === 'advanced' && dv.insurance_provider === 'DAN', 'al abrirlo ve los datos del buceador', dv)
ok(r.data?.trip?.sites?.[0] === 'Balicasag' && r.data.booking?.seats === 1 && r.data.booking.status === 'confirmed', 'y los de la salida y la reserva', r.data?.trip)
ok((await owner.rpc('chat_unread', {})).data?.center === 0, 'al abrirlo queda leído')
r = await owner.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'Sí, claro. Te esperamos a las 7:30.' })
ok(r.data?.id && mails.some((m) => m.to === 'a@x.test' && /Azul/.test(m.subject)), 'el centro responde y al buceador le llega el email', mails.slice(-1))
r = await A.rpc('chat_unread', {})
ok(r.data?.bookings?.bk1 === 1, 'el buceador ve 1 sin leer en su reserva', r)
r = await A.rpc('booking_chat', { p_booking: 'bk1' })
ok(r.data?.messages.length === 3 && r.data.messages[2].mine === false && r.data.messages[0].mine === true && r.data.other_read_at, 've la respuesta y que el centro leyó lo suyo', r.data?.messages)
const last = r.data.messages[2].created_at
r = await A.rpc('booking_chat', { p_booking: 'bk1', p_after: last })
ok(r.data?.messages.length === 0 && r.data.trip === undefined, 'al refrescar solo pide lo nuevo')

section('límites')
ok(code(await A.rpc('booking_chat_send', { p_booking: 'bk1', p_body: '' })) === 'BAD_MESSAGE', 'mensaje vacío')
ok(code(await A.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'x'.repeat(1001) })) === 'BAD_MESSAGE', 'mensaje demasiado largo')
await db.prepare('UPDATE trips SET departs_at = ? WHERE id = ?').bind(dep(-24 * 13), 't1').run()
ok(!(await A.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'Gracias por todo' })).error, 'se puede escribir hasta 14 días después de la salida')
await db.prepare('UPDATE trips SET departs_at = ? WHERE id = ?').bind(dep(-24 * 15), 't1').run()
ok(code(await A.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'hola' })) === 'CLOSED', 'pasados 14 días ya no se escribe')
ok(code(await owner.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'hola' })) === 'CLOSED', 'tampoco el centro')
r = await A.rpc('booking_chat', { p_booking: 'bk1' })
ok(r.data?.closed === true && r.data.messages.length === 4 && r.data.messages[0].body.includes('ordenador'), 'pero se puede leer', r.data)

section('privacidad de datos (RA 10173)')
ok(!mails.some((m) => /ordenador|7:30/.test(JSON.stringify(m))), 'los emails no llevan el texto de los mensajes')
const { purgeChats } = await import('../chat.js')
await purgeChats(env, Date.now() + 400 * 864e5)
ok(!(await db.prepare("SELECT 1 AS x FROM booking_messages WHERE booking_id = 'bk1'").first()), 'se borran 12 meses después de la salida')
await db.prepare('UPDATE trips SET departs_at = ? WHERE id = ?').bind(dep(48), 't1').run()
await A.rpc('booking_chat_send', { p_booking: 'bk1', p_body: 'Otra pregunta' })
await db.prepare("UPDATE bookings SET status = 'cancelled_by_diver' WHERE id = 'bk1'").run()
r = await A.rpc('delete_my_account', { p_dry_run: false })
ok(!r.error && !(await db.prepare("SELECT 1 AS x FROM booking_messages WHERE booking_id = 'bk1'").first()), 'al eliminar la cuenta se borran sus conversaciones', r)

log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
