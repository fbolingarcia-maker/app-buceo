// Pruebas de la copia Supabase → D1 (worker/import.js) y de /api/health?check=1:
//   node --no-warnings worker/test/import.mjs
// fixtures/import-supabase.json son las peticiones que hizo private.export_to_d1 (migración 034) en un Postgres 16 local
// con datos inventados llenos de casos raros (comillas, saltos de línea, emojis, barras, arrays, JSON, NULL, fechas).
// Se regeneran con worker/migrate/ensayo-local.sh. Las contraseñas de prueba: ana@example.com «Secreta123».
import fs from 'node:fs'
import { D1 } from './shim.mjs'
import { handleApi } from '../index.js'
import { checkStatement } from '../import.js'
import { cleanup } from '../cron.js'

const ORIGIN = 'https://divingslot.test'
// D1 «antiguo»: sin la columna google_sub (como el D1 real, creado antes del acceso con Google)
const old = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').replace(/,\n\s*google_sub TEXT UNIQUE/, '')
const tmp = new URL('./fixtures/.schema-antiguo.sql', import.meta.url).pathname
fs.writeFileSync(tmp, old)
const db = new D1(tmp)
fs.unlinkSync(tmp)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', NOTIFY_KEY: 'clave-avisos', EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000' }
const reqs = JSON.parse(fs.readFileSync(new URL('./fixtures/import-supabase.json', import.meta.url), 'utf8'))

let fails = 0, passes = 0
const ok = (cond, name, extra) => { if (cond) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') } }
const section = (s) => console.log('·', s)
console.error = (...a) => { if (process.env.DEBUG) console.log(...a) }

async function call(method, path, body, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers }
  const res = await handleApi(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => p })
  return { ...(await res.json().catch(() => ({}))), http: res.status }
}
const push = (body, key = 'clave-avisos') => call('POST', '/api/import', body, { 'X-Notify-Key': key })
const one = (sql, ...p) => db.prepare(sql).bind(...p).first()

section('estado antes de importar')
await db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('99999999-9999-4999-8999-999999999999', 'vieja@prueba.test', 'x')").run()
await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('s-vieja', '99999999-9999-4999-8999-999999999999', '2099-01-01')").run()
let h = await call('GET', '/api/health?check=1')
ok(h.http === 200 && h.ready === false, 'health: no está listo', h)
ok(h.schema?.up_to_date === false && h.schema.missing_columns.includes('users.google_sub'), 'health: ve que falta users.google_sub', h.schema)
ok(h.missing.some((m) => /AUTH_SECRET/.test(m)) === false && h.missing.some((m) => /Google/.test(m)), 'health: dice qué falta', h.missing)
ok((await call('GET', '/api/health')).ok === true, 'health simple')

section('sentencias permitidas')
ok(checkStatement("INSERT INTO app_config (key, value) VALUES ('a', 'b');") === null, 'insert válido')
ok(checkStatement("INSERT INTO app_config (key, value) VALUES ('a', 'b'); DROP TABLE trips; --');") !== null, 'inyección tras los valores')
ok(checkStatement("INSERT INTO app_config (key, value) VALUES ('a''); DROP TABLE trips; --', 'b');") === null, 'comillas dentro de un texto: es solo texto')
ok(checkStatement("INSERT INTO sessions (id, user_id, expires_at) VALUES ('a', 'b', 'c');") !== null, 'tabla interna no')
ok(checkStatement("INSERT INTO app_config (value, key) VALUES ('a', 'b');") !== null, 'columnas en otro orden no')
ok(checkStatement("INSERT INTO app_config (key, value) VALUES ('a', (SELECT 1));") !== null, 'subconsulta no')
ok(checkStatement('UPDATE users SET email = 1;') !== null, 'update no')
ok(checkStatement('DELETE FROM sessions;') !== null, 'delete de tabla interna no')
ok(checkStatement('DELETE FROM trips;') === null && checkStatement('PRAGMA defer_foreign_keys = true;') === null, 'delete y pragma de la exportación')
ok(checkStatement('PRAGMA foreign_keys = OFF;') !== null, 'otros pragma no')

section('importación por trozos')
const t1 = reqs.filter((r) => r.run === 't1').map((r) => r.body)
const t2 = reqs.filter((r) => r.run === 't2').map((r) => r.body)
ok(t1.length >= 3 && t2.length >= 3, 'hay trozos en la exportación', [t1.length, t2.length])
ok((await push(t1[0], 'mala')).http === 403, 'clave incorrecta → 403')
ok((await call('POST', '/api/import', t1[0])).http === 403, 'sin clave → 403')
const bad = await push({ ...t1[0], run: 'malo', statements: ["INSERT INTO users (id) VALUES ('x');"] })
ok(bad.http === 400 && /columnas distintas/.test(bad.error?.message), 'sentencia mala → 400', bad)
// Llegan desordenados (pg_net no garantiza el orden) y uno repetido
const order = [...t1.keys()].reverse()
let last
for (const [k, i] of order.entries()) {
  last = await push(t1[i])
  if (k === 0) ok((await push(t1[i])).http === 200, 'trozo repetido no rompe nada')
  if (k < order.length - 1) ok(last.http === 200 && last.received === k + 1, 'trozo ' + (i + 1) + ' guardado', last)
}
ok(last.http === 200 && last.ok === true, 'último trozo: importación hecha', last)
ok(last.counts?.users === 3 && last.counts?.centers === 2 && last.counts?.divers === 3 && last.counts?.bookings === 2, 'filas por tabla', last.counts)

section('datos copiados tal cual')
const c1 = await one("SELECT * FROM centers WHERE id = 'c0000000-0000-4000-8000-000000000001'")
ok(c1.name === "Centro O'Reilly \\ barra", 'comillas y barra', c1.name)
ok(c1.notes === 'nota con\nsalto de línea; y punto y coma;', 'saltos de línea y punto y coma', c1.notes)
ok(JSON.stringify(JSON.parse(c1.languages)) === JSON.stringify(['es', 'en', "it's"]), 'array con comillas → JSON', c1.languages)
ok(c1.course_languages === '[]', 'array NULL → [] (NOT NULL en D1)', c1.course_languages)
ok(c1.lat === 9.5 && c1.default_divers_per_guide === 4 && c1.checked_at === '2026-04-03', 'números y fechas', c1)
const c2 = await one("SELECT review_note, claims_center_id FROM centers WHERE id = 'c0000000-0000-4000-8000-000000000002'")
ok(c2.review_note === 'DROP TABLE users; --' && c2.claims_center_id === 'c0000000-0000-4000-8000-000000000001', 'texto peligroso queda como texto', c2)
const d1 = await one("SELECT * FROM divers WHERE id = 'a0000000-0000-4000-8000-000000000001'")
ok(d1.full_name === 'Ana O\'Brien "la" buzo 🐠' && d1.bio === 'Bio con \\ barra y\ttab', 'emojis, comillas dobles, tabuladores', d1)
ok(d1.seeks_buddy === 1 && d1.nitrox === 1 && d1.show_on_trips === 1 && d1.buddy_ratings_enabled === 1, 'booleanos a 1', d1)
const d2 = await one("SELECT languages, seeks_buddy, logged_dives FROM divers WHERE id = 'a0000000-0000-4000-8000-000000000002'")
ok(d2.languages === '[]' && d2.seeks_buddy === 0 && d2.logged_dives === null, 'NULL y falsos', d2)
const lg = await one("SELECT * FROM dive_logs WHERE id = 'd1000000-0000-4000-8000-000000000001'")
ok(lg.max_depth_m === 18.5 && lg.avg_depth_m === 12.25 && lg.entry_time === '08:45:00' && lg.notes === "Linea1\nLinea2 'citada'" && lg.marine_life === 'Turtles, 🐢', 'bitácora', lg)
const au = await one('SELECT detail FROM admin_audit WHERE id = 1')
ok(JSON.parse(au.detail).note === 'ok "bien"', 'jsonb', au)
const u1 = await one("SELECT * FROM users WHERE id = '11111111-1111-4111-8111-111111111111'")
ok(u1.email === 'ana@example.com' && u1.password_hash.startsWith('bcrypt$$2a$') && u1.email_confirmed_at === '2026-01-02T03:04:05.678Z', 'cuenta con contraseña y email en minúsculas', u1)
const u2 = await one("SELECT * FROM users WHERE id = '22222222-2222-4222-8222-222222222222'")
ok(u2.google_sub === '1098765432101234567890' && u2.password_hash === null && u2.provider === 'google', 'cuenta de Google con su id', u2)
ok(!(await one("SELECT 1 AS x FROM users WHERE email = 'borrado@example.com'")), 'cuentas borradas en Supabase no se copian')
ok(!(await one("SELECT 1 AS x FROM users WHERE email = 'vieja@prueba.test'")) && !(await one('SELECT 1 AS x FROM sessions')), 'el reset borra lo que había en D1 (y las sesiones)')
ok((await one("SELECT value FROM app_config WHERE key = 'payments_mode'")).value === 'live', 'configuración de Supabase', null)
ok((await one("SELECT count(*) AS n FROM published_trips")).n === 1, 'las vistas funcionan tras el reset')

section('entrar con la contraseña de Supabase')
const li = await call('POST', '/api/auth/login', { email: 'Ana@Example.com', password: 'Secreta123' }, { Origin: ORIGIN, 'X-DivingSlot': '1' })
ok(li.http === 200 && li.user?.id === '11111111-1111-4111-8111-111111111111', 'login con el hash bcrypt', li)
ok((await one("SELECT password_hash FROM users WHERE id = '11111111-1111-4111-8111-111111111111'")).password_hash.startsWith('pbkdf2$'), 'el hash pasa a PBKDF2 al entrar')
ok((await call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'otra' }, { Origin: ORIGIN, 'X-DivingSlot': '1' })).http === 400, 'contraseña mala no entra')

section('estado y repetición')
const st = await call('GET', '/api/import/status?run=t1')
ok(st.status === 'done' && st.detail?.users === 3 && st.locked === false, 'status', st)
ok((await push(t1[0])).http === 409, 'mismo nombre otra vez → 409')
h = await call('GET', '/api/health?check=1')
ok(h.schema?.up_to_date === true && h.data?.users === 3 && h.import?.last?.status === 'done', 'health tras importar', h)

section('ensayo sin contraseñas y cierre')
for (const b of t2) last = await push(b)
ok(last.ok === true && (await one("SELECT password_hash FROM users WHERE id = '11111111-1111-4111-8111-111111111111'")).password_hash === null, 'ensayo sin hash', last)
// La app arranca en Cloudflare: entran 3 personas que no son administradoras
for (const [i, u] of ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'].entries())
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind('s' + i, u, '2099-01-01', '2030-01-01T00:00:00.000Z').run()
await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('sa', '11111111-1111-4111-8111-111111111111', '2099-01-01')").run()
ok((await call('GET', '/api/import/status?run=x')).locked === false, 'con 2 personas (y un administrador) aún se puede repetir')
await db.prepare("INSERT INTO users (id, email) VALUES ('55555555-5555-4555-8555-555555555555', 'nueva@prueba.test')").run()
await db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s5', '55555555-5555-4555-8555-555555555555', '2099-01-01', '2030-01-01T00:00:00.000Z')").run()
await cleanup(env)
const lk = await push({ ...t1[0], run: 't3' })
ok(lk.http === 409 && /LOCKED/.test(lk.error?.message), 'con 3 personas la importación se cierra', lk)
await db.prepare('DELETE FROM sessions').run()
ok((await push({ ...t1[0], run: 't4' })).http === 409, 'y sigue cerrada aunque caduquen las sesiones')
ok((await one('SELECT count(*) AS n FROM users')).n === 4, 'los datos no se tocan')

console.log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
