// Pruebas del 11 nov (sin red): node --no-warnings worker/test/comunidad.mjs
// Equipo del centro (invitar, aceptar, guías asignados, día del guía), check-in con QR, widget, pago en un toque,
// seguir y muro, avistamientos, rangos y retos, ranking, y salidas de esnórquel, apnea y bautismo.
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
  db.prepare("INSERT INTO dive_sites (id, name, area, max_depth_m) VALUES ('s1', 'Balicasag', 'Panglao', 40), ('s2', 'Napaling', 'Panglao', 25)"),
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, verification_status) VALUES ('c1', 'Azul Divers', 'Panglao', 'socio', 'verified'), ('c2', 'Otro', 'Panglao', 'socio', 'verified')"),
  db.prepare("INSERT INTO boats (id, center_id, name, capacity) VALUES ('b1', 'c1', 'Banca', 10)"),
])
const owner = new Client(), G = new Client(), M = new Client(), A = new Client(), B = new Client(), X = new Client(), anon = new Client()
await owner.signup('owner@x.test', { full_name: 'Olga Owner', account_type: 'center' })
const oid = (await db.prepare("SELECT id FROM users WHERE email = 'owner@x.test'").first()).id
await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES ('c1', ?, 'owner')").bind(oid).run()
await owner.call('POST', '/api/auth/login', { email: 'owner@x.test', password: 'Clave1234' })
await G.signup('guia@x.test', { full_name: 'Gabi Guía' })
await M.signup('mana@x.test', { full_name: 'Marta Manager' })
await X.signup('x@x.test', { full_name: 'Xavi Intruso' })
for (const [c, e] of [[A, 'a@x.test'], [B, 'b@x.test']]) {
  await c.signup(e, { full_name: e[0].toUpperCase() + ' Pérez' })
  const d = (await c.rest({ table: 'divers', select: 'id', single: 'single' })).data
  if (e === 'a@x.test') await c.rest({ table: 'certifications', op: 'insert', values: { diver_id: d.id, agency: 'PADI', level: 'advanced' } })
}
const diverOf = async (email) => (await db.prepare('SELECT d.id FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = ?').bind(email).first()).id
const uidOf = async (email) => (await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()).id
const mk = async (h, extra = {}) => (await owner.rest({ table: 'trips', op: 'insert', values: { center_id: 'c1', boat_id: 'b1', departs_at: dep(h), price_php: 3000, divers_per_guide: 4, guides: 2, status: 'published', ...extra }, returning: true, select: 'id' })).data[0].id

section('equipo: invitar y aceptar')
const tokenOf = (email) => decodeURIComponent(new URL(mails.filter((m) => m.to === email).pop().url.replace('#/', '')).searchParams.get('token'))
let r = await owner.rpc('team_invite', { p_center: 'c1', p_email: 'GUIA@x.test', p_role: 'guide' })
ok(r.data?.ok, 'el titular invita a un guía', r)
ok(mails.some((m) => m.to === 'guia@x.test' && /equipo|invited/i.test(m.subject)), 'le llega el email de invitación', mails.slice(-2))
ok(code(await X.rpc('team_invite', { p_center: 'c1', p_email: 'y@x.test', p_role: 'guide' })) === 'FORBIDDEN', 'alguien de fuera no puede invitar')
const gtok = tokenOf('guia@x.test')
r = await anon.rpc('team_invite_info', { p_token: gtok })
ok(r.data?.center_name === 'Azul Divers' && r.data.role === 'guide' && !/guia@/.test(r.data.email), 'la invitación se puede ver sin enseñar el email entero', r)
ok(code(await X.rpc('team_accept', { p_token: gtok })) === 'WRONG_ACCOUNT', 'otra cuenta no puede usar la invitación')
r = await G.rpc('team_accept', { p_token: gtok })
ok(r.data?.role === 'guide', 'el guía acepta', r)
ok(code(await G.rpc('team_accept', { p_token: gtok })) === 'INVITE_INVALID', 'la invitación no se usa dos veces')
await owner.rpc('team_invite', { p_center: 'c1', p_email: 'mana@x.test', p_role: 'manager' })
r = await M.rpc('team_accept', { p_token: tokenOf('mana@x.test') })
ok(r.data?.role === 'manager', 'la responsable acepta', r)
r = await M.rest({ table: 'center_staff', select: 'role', single: 'single' })
ok(r.data?.role === 'manager', 'y queda como responsable del centro (panel completo)', r)
r = await owner.rpc('team_list', { p_center: 'c1' })
ok(r.data?.members?.length === 3 && r.data.members.some((m) => m.role === 'guide' && m.full_name === 'Gabi Guía'), 'la lista del equipo tiene titular, responsable y guía', r)
ok(code(await G.rpc('team_list', { p_center: 'c1' })) === 'FORBIDDEN', 'el guía no gestiona el equipo')
ok(code(await owner.rpc('team_remove', { p_center: 'c1', p_user: oid })) === 'OWNER', 'el titular no se puede quitar')

section('guías asignados y día del guía')
const T = await mk(3)
const Tsnork = await mk(30, { activity: 'snorkel', price_php: 900 })
const guid = await uidOf('guia@x.test')
ok(code(await owner.rpc('assign_guides', { p_trip: T, p_users: [await uidOf('x@x.test')] })) === 'NOT_MEMBER', 'no se asigna a alguien de fuera del equipo')
r = await owner.rpc('assign_guides', { p_trip: T, p_users: [guid] })
ok(r.data?.assigned === 1, 'se asigna el guía a la salida', r)
r = await owner.rpc('trip_guides_list', { p_center: 'c1', p_from: dep(-1), p_to: dep(48) })
ok(r.data?.[0]?.name === 'Gabi Guía', 'la agenda ve el guía asignado', r)
r = await G.rpc('my_guide_centers', {})
ok(r.data?.[0]?.name === 'Azul Divers', 'el guía ve su centro', r)
r = await A.rpc('book_trip', { p_trip: T, p_seats: 1, p_with_gear: false, p_medical_signed: true })
const BA = r.data
ok(BA?.status === 'pending_payment', 'A reserva la salida de hoy', r)
await A.rpc('confirm_payment_demo', { p_booking: BA.id, p_kind: 'deposit' })
const today = new Date(Date.parse(dep(3)) + 8 * 36e5).toISOString().slice(0, 10)
r = await G.rpc('guide_day', { p_day: today })
ok(r.data?.[0]?.mine === true && r.data[0].bookings?.[0]?.full_name === 'A Pérez', 'el guía ve su salida y el manifiesto', r)
ok(code(await A.rpc('guide_day', {})) === 'FORBIDDEN', 'un buceador no ve el día del guía')

section('check-in con QR')
r = await A.rpc('checkin_pass', { p_booking: BA.id })
const pass = r.data
ok(/^[0-9A-F]{8}$/.test(pass?.code || '') && /^data:image\/svg\+xml/.test(pass.qr), 'el buceador tiene su QR y su código', r)
ok(code(await B.rpc('checkin_pass', { p_booking: BA.id })) === 'NOT_FOUND', 'nadie más ve ese pase')
ok(code(await X.rpc('checkin_scan', { p_code: 'DSCHK:' + BA.id + ':' + pass.code })) === 'FORBIDDEN', 'alguien de fuera no puede hacer check-in')
ok(code(await G.rpc('checkin_scan', { p_code: 'DSCHK:' + BA.id + ':00000000' })) === 'BAD_CODE', 'un QR falsificado no vale')
r = await G.rpc('checkin_scan', { p_code: 'DSCHK:' + BA.id + ':' + pass.code })
ok(r.data?.name === 'A Pérez' && r.data.already === false, 'el guía escanea el QR y hace el check-in', r)
ok((await db.prepare('SELECT checked_in_at FROM bookings WHERE id = ?').bind(BA.id).first()).checked_in_at, 'queda guardado')
r = await owner.rpc('checkin_scan', { p_code: pass.code.slice(0, 4) + '-' + pass.code.slice(4) })
ok(r.data?.already === true, 'con el código tecleado también lo encuentra (ya estaba a bordo)', r)

section('widget')
let res = await worker.fetch(new Request(ORIGIN + '/w/c1?lang=es'), env, {})
let html = await res.text()
ok(res.status === 200 && /Azul Divers/.test(html) && /Próximas salidas/.test(html) && /Reservar/.test(html), 'el widget lista las salidas', html.slice(0, 200))
ok(/frame-ancestors \*/.test(res.headers.get('Content-Security-Policy') || '') && !res.headers.get('X-Frame-Options'), 'se puede insertar en otra web')
ok(html.includes(`/r/c1?t=${T}`) && /Esnórquel/.test(html), 'cada salida enlaza a reservar con el canal propio (y el esnórquel se nombra)')
res = await worker.fetch(new Request(ORIGIN + `/r/c1?t=${T}`), env, {})
ok(res.headers.get('Location') === ORIGIN + '/app/#/r/c1/' + T, 'el enlace abre esa salida', res.headers.get('Location'))
res = await worker.fetch(new Request(ORIGIN + '/w/00000000-0000-4000-8000-000000000000'), env, {})
ok(res.status === 404, 'un centro inexistente da 404')

section('esnórquel, apnea y bautismo')
r = await B.rpc('book_trip', { p_trip: Tsnork, p_seats: 1, p_with_gear: false, p_medical_signed: false })
ok(r.data?.status === 'pending_payment', 'B, sin certificación ni cuestionario, reserva esnórquel', r)
const Tdsd = await mk(30, { activity: 'try_dive', price_php: 3500, min_level: 'advanced' })
ok(code(await B.rpc('book_trip', { p_trip: Tdsd, p_seats: 1, p_with_gear: false, p_medical_signed: false })) === 'NO_MEDICAL', 'el bautismo pide el cuestionario médico')
r = await B.rpc('book_trip', { p_trip: Tdsd, p_seats: 1, p_with_gear: false, p_medical_signed: true })
ok(r.data?.status === 'pending_payment', 'pero no certificación', r)
const Tadv = await mk(30, { min_level: 'advanced' })
ok(code(await B.rpc('book_trip', { p_trip: Tadv, p_seats: 1, p_with_gear: false, p_medical_signed: true })) === 'LEVEL', 'el buceo sigue pidiendo nivel')
r = await anon.rest({ table: 'published_trips', select: 'activity', filters: [['id', 'eq', Tsnork]], single: 'single' })
ok(r.data?.activity === 'snorkel', 'la salida publicada dice la actividad', r)

section('pago en un toque')
r = await A.rpc('set_pay_method', { p_method: 'gcash' })
ok(r.data?.ok, 'guarda el método preferido', r)
ok((await A.rest({ table: 'divers', select: 'pay_method', single: 'single' })).data?.pay_method === 'gcash', 'y queda en el perfil')
ok(code(await A.rpc('set_pay_method', { p_method: 'bitcoin' })) === 'BAD_METHOD', 'no acepta métodos raros')

section('avistamientos')
r = await A.rpc('add_sighting', { p_site: 's1', p_species: 'Tiburón zorro', p_note: 'dos, a 30 m' })
ok(r.data?.id, 'un buceador publica un avistamiento', r)
r = await G.rpc('add_sighting', { p_site: 's2', p_species: 'Sardinas' })
ok(r.data?.id, 'el guía publica otro (a nombre del centro)', r)
ok(code(await A.rpc('add_sighting', { p_site: 's1', p_species: 'x' })) === 'BAD_SPECIES', 'pide qué se vio')
ok(code(await A.rpc('add_sighting', { p_site: 's1', p_species: 'Manta', p_seen_on: '2020-01-01' })) === 'BAD_DATE', 'solo de los últimos 7 días')
r = await anon.rpc('sightings', { p_area: 'Panglao' })
ok(r.data?.length === 2 && r.data.some((s) => s.by === 'Azul Divers') && r.data.some((s) => s.by === 'A P.'), 'se ven sin cuenta, con quién lo vio', r)
r = await anon.rpc('sightings', { p_site: 's1' })
ok(r.data?.length === 1 && r.data[0].species === 'Tiburón zorro', 'filtro por punto', r)

section('seguir y muro')
const dA = await diverOf('a@x.test')
ok(code(await B.rpc('follow', { p_type: 'diver', p_id: dA })) === 'PRIVATE', 'no se sigue un perfil privado')
await A.rest({ table: 'divers', op: 'update', values: { public_profile: true }, filters: [['id', 'eq', dA]] })
r = await B.rpc('follow', { p_type: 'diver', p_id: dA })
ok(r.data?.following, 'B sigue a A', r)
r = await B.rpc('follow', { p_type: 'center', p_id: 'c1' })
ok(r.data?.following, 'B sigue al centro', r)
const L1 = (await A.rest({ table: 'dive_logs', op: 'insert', values: { diver_id: dA, dive_date: today, site_id: 's1', max_depth_m: 32, share_public: true }, returning: true, select: 'id' })).data?.[0]?.id
await A.rest({ table: 'dive_logs', op: 'insert', values: { diver_id: dA, dive_date: today, site_id: 's2', max_depth_m: 12 } })
r = await B.rpc('feed', {})
ok(r.data?.items?.some((i) => i.type === 'log' && i.id === L1 && i.who === 'A P.') && r.data.items.filter((i) => i.type === 'log').length === 1, 'en el muro de B sale solo la inmersión compartida de A', r)
ok(r.data.items.some((i) => i.type === 'sighting' && i.center_name === 'Azul Divers'), 'y el avistamiento de su centro', r)
ok(r.data.trips?.some((x) => x.id === Tsnork), 'y las próximas salidas del centro que sigue', r.data.trips)
r = await B.rpc('public_diver', { p_id: dA })
ok(r.data?.name === 'A P.' && r.data.logs.length === 1 && r.data.following === true && r.data.followers === 1, 'perfil público de A', r)
r = await B.rpc('my_follows', {})
ok(r.data?.divers?.[0]?.id === dA && r.data.centers?.[0]?.id === 'c1', 'B ve a quién sigue', r)
await B.rpc('unfollow', { p_type: 'diver', p_id: dA })
ok(!(await B.rpc('follow_state', { p_type: 'diver', p_id: dA })).data.following, 'deja de seguir')

section('rangos, retos y ranking')
r = await A.rpc('my_progress', {})
ok(r.data?.total === 2 && r.data.rank.key === 'new' && r.data.rank.next === 10, 'rango por inmersiones', r)
ok(r.data.challenges.find((c) => c.key === 'deep30')?.done === true && r.data.challenges.find((c) => c.key === 'sites5')?.progress === 2 && r.data.challenges.find((c) => c.key === 'sight3')?.progress === 1, 'retos con su progreso', r.data?.challenges)
r = await anon.rpc('leaderboard', { p_area: 'Panglao' })
ok(r.data?.[0]?.name === 'A P.' && r.data[0].dives === 2 && r.data.length === 1, 'ranking del destino con perfiles públicos', r)
await G.rpc('team_remove', { p_center: 'c1', p_user: guid }).then((x) => ok(code(x) === 'FORBIDDEN', 'el guía no quita a nadie'))
r = await owner.rpc('team_remove', { p_center: 'c1', p_user: guid })
ok(r.data?.removed === 1 && !(await db.prepare('SELECT 1 AS x FROM trip_guides WHERE user_id = ?').bind(guid).first()), 'el titular quita al guía y sus salidas futuras', r)

section('dos pasos obligatorios para el equipo del centro')
env.STAFF_MFA_OPTIONAL = ''
r = await owner.call('GET', '/api/auth/session')
ok(r.aal?.setupRequired === true, 'el titular sin dos pasos tiene que activarlos', r.aal)
r = await owner.rpc('team_list', { p_center: 'c1' })
ok(code(r) === 'FORBIDDEN', 'y mientras no lo haga no gestiona el centro', r)
r = await A.call('GET', '/api/auth/session')
ok(r.aal?.setupRequired === false, 'a un buceador no se le exige', r.aal)
env.STAFF_MFA_OPTIONAL = '1'

section('comprobación anti-bots (Turnstile)')
r = await anon.call('GET', '/api/auth/session')
ok(r.captcha === null, 'sin claves no hay comprobación', r)
Object.assign(env, { TURNSTILE_SITE_KEY: '0xSITE', TURNSTILE_SECRET: '0xSECRET' })
const realFetch = globalThis.fetch
globalThis.fetch = async (u, o) => {
  if (String(u).includes('turnstile/v0/siteverify')) return new Response(JSON.stringify({ success: o.body.get('secret') === '0xSECRET' && o.body.get('response') === 'buen-token' }))
  return realFetch(u, o)
}
r = await anon.call('GET', '/api/auth/session')
ok(r.captcha === '0xSITE', 'la app recibe la clave pública', r)
const L = new Client()
r = await L.call('POST', '/api/auth/login', { email: 'a@x.test', password: 'Clave1234' })
ok(r.error?.code === 'captcha_failed', 'sin token no se entra', r)
r = await L.call('POST', '/api/auth/login', { email: 'a@x.test', password: 'Clave1234', captcha_token: 'malo' })
ok(r.error?.code === 'captcha_failed', 'con un token falso tampoco', r)
r = await L.call('POST', '/api/auth/login', { email: 'a@x.test', password: 'Clave1234', captcha_token: 'buen-token' })
ok(!r.error && r.user?.email === 'a@x.test', 'con el token de Cloudflare sí', r)
r = await L.call('POST', '/api/auth/recover', { email: 'a@x.test' })
ok(r.error?.code === 'captcha_failed', 'también en «He olvidado la contraseña»', r)
r = await L.call('POST', '/api/auth/signup', { email: 'nuevo@x.test', password: 'Clave1234' })
ok(r.error?.code === 'captcha_failed', 'y al crear cuenta', r)
globalThis.fetch = realFetch
delete env.TURNSTILE_SITE_KEY; delete env.TURNSTILE_SECRET

log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
