// Pruebas de las valoraciones a guías (sin red): node --no-warnings worker/test/guias.mjs
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
  db.prepare("INSERT INTO boats (id, center_id, name, capacity) VALUES ('b1', 'c1', 'Banca', 10)"),
])
const owner = new Client(), other = new Client(), G = new Client(), H = new Client(), anon = new Client()
const divers = [new Client(), new Client(), new Client(), new Client()]
await owner.signup('owner@x.test', { full_name: 'Olga Owner', account_type: 'center' })
await other.signup('otro@x.test', { full_name: 'Otro Centro', account_type: 'center' })
const uidOf = async (e) => (await db.prepare('SELECT id FROM users WHERE email = ?').bind(e).first()).id
const diverOf = async (e) => (await db.prepare('SELECT d.id FROM divers d JOIN users u ON u.id = d.user_id WHERE u.email = ?').bind(e).first()).id
await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES ('c1', ?, 'owner')").bind(await uidOf('owner@x.test')).run()
await db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES ('c2', ?, 'owner')").bind(await uidOf('otro@x.test')).run()
await owner.call('POST', '/api/auth/login', { email: 'owner@x.test', password: 'Clave1234' })
await other.call('POST', '/api/auth/login', { email: 'otro@x.test', password: 'Clave1234' })
await G.signup('gabi@x.test', { full_name: 'Gabi Santos Reyes' })
await H.signup('hugo@x.test', { full_name: 'Hugo Lim' })
const g = await uidOf('gabi@x.test'), h = await uidOf('hugo@x.test')
await db.prepare("INSERT INTO center_guides (center_id, user_id) VALUES ('c1', ?), ('c1', ?)").bind(g, h).run()
const ids = []
for (const [i, c] of divers.entries()) { await c.signup(`d${i}@x.test`, { full_name: `Buceador ${i}` }); ids.push(await diverOf(`d${i}@x.test`)) }
await db.batch([
  db.prepare("INSERT INTO trips (id, center_id, boat_id, departs_at, price_php, divers_per_guide, guides, status) VALUES ('t1', 'c1', 'b1', ?, 3000, 4, 2, 'published'), ('t2', 'c1', 'b1', ?, 3000, 4, 2, 'published')").bind(dep(-24), dep(48)),
  db.prepare("INSERT INTO trip_guides (trip_id, user_id) VALUES ('t1', ?), ('t1', ?), ('t2', ?)").bind(g, h, g),
  ...ids.map((d, i) => db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, status, amount_php, checked_in_at) VALUES (?, 't1', ?, 1, 'confirmed', 3000, ?)").bind('bk' + i, d, i === 3 ? null : dep(-25))),
  ...ids.map((d, i) => db.prepare("INSERT INTO bookings (id, trip_id, diver_id, seats, status, amount_php, checked_in_at) VALUES (?, 't2', ?, 1, 'confirmed', 3000, ?)").bind('bf' + i, d, dep(-1))),
])
const [A, B, C, D] = divers

section('quién puede valorar')
let r = await A.rpc('guide_rating_targets', { p_trip: 't1' })
ok(r.data?.open && r.data.guides.length === 2 && r.data.guides.some((x) => x.name === 'Gabi R.' && !x.rated), 've a los 2 guías con nombre corto', r)
r = await D.rpc('guide_rating_targets', { p_trip: 't1' })
ok(r.data?.guides?.length === 0, 'sin check-in no tiene a quién valorar', r)
ok(code(await D.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 5 })) === 'FORBIDDEN', 'sin check-in no puede valorar')
ok(code(await anon.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 5 })) === 'FORBIDDEN', 'sin sesión tampoco')
ok(code(await A.rpc('rate_guide', { p_trip: 't2', p_guide: g, p_overall: 5 })) === 'TOO_EARLY', 'antes de salir el barco no')
ok(code(await A.rpc('rate_guide', { p_trip: 't1', p_guide: await uidOf('owner@x.test'), p_overall: 5 })) === 'FORBIDDEN', 'solo a quien fue guía en esa salida')
ok(code(await A.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 6 })) === 'INVALID', 'nota fuera de rango')
ok(code(await A.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 5, p_scores: { hack: 5 } })) === 'INVALID', 'criterio desconocido')

section('valorar')
r = await A.rpc('my_pending_guide_ratings', {})
ok(r.data?.length === 1 && r.data[0].trip_id === 't1' && r.data[0].pending === 2, 'aviso: 2 guías por valorar', r)
r = await A.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 5, p_scores: { briefing: 5, safety: 4, spotting: null }, p_comment: 'Encontró un pez rana' })
ok(r.data?.ok, 'valora con nota, criterios y comentario', r)
ok(code(await A.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 1 })) === 'ALREADY_RATED', 'solo una vez')
ok((await A.rpc('my_pending_guide_ratings', {})).data?.[0]?.pending === 1, 'queda 1 por valorar')
r = await A.rpc('guide_rating_targets', { p_trip: 't1' })
ok(r.data?.guides.find((x) => x.user_id === g)?.rated === true, 'aparece como valorado')
await B.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 4, p_scores: { briefing: 4, friendly: 5 } })

section('visibilidad')
r = await anon.rpc('guide_ratings', { p_center: 'c1' })
ok(Array.isArray(r.data) && r.data.length === 0, 'con 2 buceadores aún no es pública', r)
r = await owner.rpc('guide_ratings', { p_center: 'c1' })
ok(r.data?.length === 1 && r.data[0].raters === 2 && r.data[0].name === 'Gabi Santos Reyes' && r.data[0].comments?.[0]?.comment === 'Encontró un pez rana', 'el centro ya la ve, con comentarios', r)
ok(!JSON.stringify(r.data).includes(ids[0]) && !/Buceador/.test(JSON.stringify(r.data)), 'sin saber quién la escribió')
await C.rpc('rate_guide', { p_trip: 't1', p_guide: g, p_overall: 3 })
r = await anon.rpc('guide_ratings', { p_center: 'c1' })
ok(r.data?.length === 1 && r.data[0].name === 'Gabi R.' && r.data[0].overall === 4 && r.data[0].scores.briefing === 4.5 && r.data[0].raters === 3, 'con 3 buceadores la media es pública', r)
ok(!r.data[0].comments && !r.data[0].user_id, 'en público sin comentarios', r.data[0])
r = await other.rpc('guide_ratings', { p_center: 'c1' })
ok(r.data?.length === 1 && !r.data[0].comments, 'otro centro solo ve lo público')
r = await G.rpc('my_guide_ratings', {})
ok(r.data?.raters === 3 && r.data.public && r.data.comments.length === 1, 'el guía ve las suyas', r)
r = await H.rpc('my_guide_ratings', {})
ok(r.data?.raters === 0, 'el otro guía aún no tiene', r)

ok((await owner.rest({ table: 'guide_ratings' })).status === 404, 'la tabla no se lee por REST')

section('plazo y borrado')
await db.prepare("UPDATE trips SET departs_at = ? WHERE id = 't1'").bind(dep(-24 * 15)).run()
ok(code(await A.rpc('rate_guide', { p_trip: 't1', p_guide: h, p_overall: 4 })) === 'CLOSED', 'pasados 14 días se cierra')
await db.prepare("UPDATE bookings SET status = 'cancelled_by_diver' WHERE id = 'bf0'").run()
r = await A.rpc('delete_my_account', { p_dry_run: false })
ok(!r.error && !(await db.prepare('SELECT 1 AS x FROM guide_ratings WHERE diver_id = ?').bind(ids[0]).first()), 'al eliminar la cuenta se borran sus valoraciones', r)
r = await G.rpc('delete_my_account', { p_dry_run: false })
ok(!r.error && !(await db.prepare('SELECT 1 AS x FROM guide_ratings WHERE guide_user_id = ?').bind(g).first()), 'y al eliminar la del guía, las suyas', r)

log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
