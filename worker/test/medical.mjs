// Pruebas del cuestionario médico firmado y confidencial (sin red): node --no-warnings worker/test/medical.mjs
import { D1, R2 } from './shim.mjs'
import worker, { handleApi } from '../index.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', STAFF_MFA_OPTIONAL: '1', DIVE_PHOTOS: new R2(), ASSETS: { fetch: () => new Response('app') } }
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
    const bin = body instanceof Uint8Array
    if (body !== undefined && !bin) h['Content-Type'] = 'application/json'
    const res = await handleApi(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : bin ? body : JSON.stringify(body), redirect: 'manual' }), env, { waitUntil: (p) => pending.push(p) })
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
  db.prepare("INSERT INTO boats (id, center_id, name, capacity) VALUES ('b1', 'c1', 'Banca', 10)"),
])
const owner = new Client(), A = new Client(), X = new Client(), other = new Client(), guide = new Client()
await owner.signup('owner@x.test', { full_name: 'Olga Owner', account_type: 'center' })
await other.signup('otro@x.test', { full_name: 'Otro Centro', account_type: 'center' })
await guide.signup('guia@x.test', { full_name: 'Gabi Guía' })
for (const [e, c] of [['owner@x.test', 'c1'], ['otro@x.test', 'c2']]) {
  const uid = (await db.prepare('SELECT id FROM users WHERE email = ?').bind(e).first()).id
  await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES (?, ?, 'owner')").bind(c, uid).run()
}
await owner.call('POST', '/api/auth/login', { email: 'owner@x.test', password: 'Clave1234' })
await other.call('POST', '/api/auth/login', { email: 'otro@x.test', password: 'Clave1234' })
await A.signup('a@x.test', { full_name: 'Ana Pérez' })
await X.signup('x@x.test', { full_name: 'Xavi Intruso' })
const uidA = (await db.prepare("SELECT id FROM users WHERE email = 'a@x.test'").first()).id
const dA = (await db.prepare('SELECT id FROM divers WHERE user_id = ?').bind(uidA).first()).id
const gUid = (await db.prepare("SELECT id FROM users WHERE email = 'guia@x.test'").first()).id
await db.batch([
  db.prepare("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, guides, status) VALUES ('t1', 'c1', 'b1', ?, 3000, 4, 2, 'published')").bind(dep(48)),
  db.prepare("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, guides, status) VALUES ('t2', 'c1', 'b1', ?, 3000, 4, 2, 'published')").bind(dep(24 * 60)),
  db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, status, amount_php) VALUES ('bk1', 't1', ?, 1, 'confirmed', 3000)").bind(dA),
  db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, status, amount_php) VALUES ('bk2', 't2', ?, 1, 'confirmed', 3000)").bind(dA),
  db.prepare("INSERT INTO trip_guides (trip_id, user_id) VALUES ('t1', ?)").bind(gUid),
])
const NO = { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false, q8: false, q9: false, q10: false }
const SIG = 'M10 10 L20 20 Q30 40 50 20 L60 10'
const sign = (c, extra = {}) => c.rpc('medical_sign', { p_answers: NO, p_boxes: {}, p_name: 'Ana Pérez', p_birth_date: '1990-04-02', p_signature: SIG, ...extra })

section('el buceador rellena y firma')
let r = await A.rpc('my_medical', {})
ok(r.data?.status === 'none', 'sin cuestionario todavía', r)
ok(code(await sign(A, { p_answers: { ...NO, q4: undefined } })) === 'INCOMPLETE', 'pide responder a todas')
ok(code(await sign(A, { p_signature: '<script>' })) === 'BAD_SIGNATURE', 'rechaza una firma que no es un trazo')
ok(code(await sign(A, { p_name: '' })) === 'BAD_NAME', 'pide el nombre')
ok(code(await sign(A, { p_answers: { ...NO, q1: true } })) === 'INCOMPLETE', 'un SÍ con bloque pide sus preguntas de detalle')
r = await sign(A)
ok(r.data?.status === 'valid' && r.data.needs_physician === false, 'todo NO: queda al día', r)
let d = await db.prepare('SELECT medical_result, medical_done_at FROM divers WHERE id = ?').bind(dA).first()
ok(d.medical_result === 'all_no' && d.medical_done_at, 'la ficha queda «al día» para reservar', d)
const raw = await db.prepare('SELECT payload FROM medical_forms WHERE diver_id = ?').bind(dA).first()
ok(raw?.payload?.startsWith('v1.') && !raw.payload.includes('Ana') && !raw.payload.includes('1990'), 'en la base de datos va cifrado', raw)
ok(mails.every((m) => !/1990|médic|medical/i.test(JSON.stringify(m))), 'ningún email lleva datos de salud')

section('un SÍ que pide médico')
r = await sign(A, { p_answers: { ...NO, q1: true }, p_boxes: { A: [false, true, false, false, false] } })
ok(r.data?.status === 'needs_physician', 'un SÍ en el bloque A pide la evaluación del médico', r)
d = await db.prepare('SELECT medical_result FROM divers WHERE id = ?').bind(dA).first()
ok(d.medical_result === null, 'mientras falta el médico no está «al día»', d)
const formId = r.data.id
r = await sign(A, { p_answers: { ...NO, q1: true }, p_boxes: { A: [false, false, false, false, false] } })
ok(r.data?.status === 'valid', 'SÍ en la principal pero NO en todo el bloque: no hace falta médico', r)
await sign(A, { p_answers: { ...NO, q3: true } })
r = await A.rpc('my_medical', {})
ok(r.data?.status === 'needs_physician' && r.data.form.answers.q3 === true, 'SÍ en la 3 pide médico', r.data)
const f3 = r.data.form.id
const pdf = new TextEncoder().encode('%PDF-1.4 evaluación')
ok((await A.raw('PUT', `/api/storage/upload/dive-photos/${uidA}/medico/${f3}.pdf`, pdf)).status === 200, 'sube la evaluación del médico en PDF a su almacén privado')
ok((await A.raw('PUT', `/api/storage/upload/dive-photos/${uidA}/fotos/x.pdf`, pdf)).status === 415, 'fuera de «medico» un PDF no se admite en las fotos')
ok(code(await A.rpc('medical_add_physician', { p_form: f3, p_name: 'Dra. Reyes', p_date: '2001-01-01', p_doc_path: `${uidA}/medico/${f3}.pdf` })) === 'BAD_PHYSICIAN', 'la evaluación debe ser de los últimos 12 meses')
ok(code(await A.rpc('medical_add_physician', { p_form: f3, p_name: 'Dra. Reyes', p_date: new Date().toISOString().slice(0, 10), p_doc_path: `otro/medico/x.pdf` })) === 'BAD_PATH', 'el documento tiene que ser suyo')
r = await A.rpc('medical_add_physician', { p_form: f3, p_name: 'Dra. Reyes', p_date: new Date(Date.now() - 864e5).toISOString().slice(0, 10), p_clinic: 'Bohol Clinic', p_doc_path: `${uidA}/medico/${f3}.pdf` })
ok(r.data?.status === 'valid', 'con la evaluación del médico queda al día', r)
d = await db.prepare('SELECT medical_result FROM divers WHERE id = ?').bind(dA).first()
ok(d.medical_result === 'physician_ok', 'ficha «apto con médico»', d)
ok(code(await X.rpc('medical_add_physician', { p_form: f3, p_name: 'x', p_date: '2026-01-01', p_doc_path: 'x/medico/y.pdf' })) === 'NOT_FOUND', 'otro buceador no toca el cuestionario')

section('confidencialidad')
r = await owner.rpc('medical_for_booking', { p_booking: 'bk1' })
ok(r.data?.status === 'valid' && r.data.answers.q3 === true && r.data.signature === SIG && r.data.physician?.name === 'Dra. Reyes', 'el centro de la salida lo ve (reserva activa, salida próxima)', r)
r = await guide.rpc('medical_for_booking', { p_booking: 'bk1' })
ok(r.data?.answers?.q3 === true, 'el guía asignado a la salida también', r)
ok(code(await guide.rpc('medical_for_booking', { p_booking: 'bk2' })) === 'FORBIDDEN', 'pero no el de otra salida a la que no está asignado')
ok(code(await owner.rpc('medical_for_booking', { p_booking: 'bk2' })) === 'FORBIDDEN', 'el centro no lo ve si la salida es dentro de más de 30 días')
ok(code(await other.rpc('medical_for_booking', { p_booking: 'bk1' })) === 'FORBIDDEN', 'otro centro no lo ve')
ok(code(await X.rpc('medical_for_booking', { p_booking: 'bk1' })) === 'FORBIDDEN', 'otro buceador tampoco')
const adminUid = (await db.prepare("SELECT id FROM users WHERE email = 'x@x.test'").first()).id
await db.prepare('INSERT INTO platform_admins (user_id) VALUES (?)').bind(adminUid).run()
ok(code(await X.rpc('medical_for_booking', { p_booking: 'bk1' })) === 'FORBIDDEN', 'ni un administrador de DivingSlot')
await db.prepare('DELETE FROM platform_admins WHERE user_id = ?').bind(adminUid).run()
ok((await X.rest({ table: 'medical_forms' })).status === 404, 'la tabla no se lee por REST')
r = await A.rpc('medical_doc_url', {})
ok((await A.raw('GET', r.data?.url || '/x')).status === 200, 'el propio buceador abre su evaluación con su enlace', r)
r = await owner.rpc('medical_doc_url', { p_booking: 'bk1' })
ok(/sig=/.test(r.data?.url || '') && (await owner.raw('GET', r.data.url)).status === 200, 'el centro recibe un enlace firmado temporal a la evaluación', r)
ok(code(await other.rpc('medical_doc_url', { p_booking: 'bk1' })) === 'FORBIDDEN', 'otro centro no')
r = await A.rpc('my_medical', {})
ok(r.data?.access?.length === 3 && r.data.access.some((x) => /Guía/.test(x.who)) && r.data.access.every((x) => /Azul Divers/.test(x.who)), 'el buceador ve quién lo consultó y cuándo', r.data?.access)
await db.prepare("UPDATE bookings SET status = 'cancelled_by_diver' WHERE id = 'bk1'").run()
ok(code(await owner.rpc('medical_for_booking', { p_booking: 'bk1' })) === 'FORBIDDEN', 'con la reserva cancelada el centro deja de verlo')
await db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = 'bk1'").run()

section('conservación y borrado')
const { purgeMedical } = await import('../medical.js')
await db.prepare("UPDATE medical_forms SET valid_until = '2020-01-01' WHERE id = ?").bind(formId).run()
await purgeMedical(env)
ok(!(await db.prepare('SELECT 1 AS x FROM medical_forms WHERE id = ?').bind(formId).first()), 'se borra 3 meses después de caducar')
ok(await db.prepare('SELECT 1 AS x FROM medical_forms WHERE id = ?').bind(f3).first(), 'el vigente se conserva')
r = await A.rpc('medical_delete_mine', {})
ok(r.data?.deleted && !(await db.prepare('SELECT 1 AS x FROM medical_forms WHERE diver_id = ?').bind(dA).first()) && !env.DIVE_PHOTOS.m.has(`${uidA}/medico/${f3}.pdf`), 'el buceador borra sus cuestionarios y la evaluación', r)
d = await db.prepare('SELECT medical_result FROM divers WHERE id = ?').bind(dA).first()
ok(d.medical_result === null, 'y deja de estar al día', d)
await sign(A)
await db.prepare("UPDATE bookings SET status = 'cancelled_by_diver' WHERE diver_id = ?").bind(dA).run()
r = await A.rpc('delete_my_account', { p_dry_run: false })
ok(!r.error && !(await db.prepare('SELECT 1 AS x FROM medical_forms WHERE diver_id = ?').bind(dA).first()), 'al eliminar la cuenta se borra el cuestionario', r)

log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
