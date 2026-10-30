// Pruebas del Worker sin secretos configurados: node --no-warnings worker/test/sin-claves.mjs
//   · AUTH_SECRET automático (lib/secrets.js): se genera una vez, se guarda en D1 y no cambia.
//   · Avisos e importación desde Supabase sin NOTIFY_KEY: llegan como { claim } y el Worker los recoge de la cola de
//     Supabase con la RPC outbox_claim (lib/outbox.js, migración 035). Supabase está simulado.
import fs from 'node:fs'
import { D1 } from './shim.mjs'
import { handleApi } from '../index.js'
import { _resetSecretsCache } from '../lib/secrets.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, EMAIL_DEV_LOG: '1', PBKDF2_ITER: '1000', NOTIFY_TO: 'admin@divingslot.test' }
_resetSecretsCache()
let fails = 0, passes = 0
const ok = (c, name, extra) => { if (c) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') } }
const section = (s) => console.log('·', s)
const mails = []
const log = console.log
console.log = (...a) => { if (a[0] === 'EMAIL (modo prueba)') mails.push({ to: a[1], subject: a[2], link: a[3] }); else log(...a) }
console.error = (...a) => { if (process.env.DEBUG) log(...a) }

// Cola de Supabase simulada
const outbox = new Map()
let claims = 0
const put = (kind, body) => { const id = crypto.randomUUID(); outbox.set(id, { kind, body }); return id }
globalThis.fetch = async (url, opt = {}) => {
  if (String(url).endsWith('/rest/v1/rpc/outbox_claim')) {
    claims++
    if (!opt.headers?.apikey) return new Response('{}', { status: 401 })
    const id = JSON.parse(opt.body).p_id
    const row = outbox.get(id) ?? null
    outbox.delete(id)
    return new Response(JSON.stringify(row), { status: 200 })
  }
  throw new Error('fetch no simulado ' + url)
}
async function call(method, path, body, headers = {}) {
  const res = await handleApi(new Request(ORIGIN + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => p })
  return { ...(await res.json().catch(() => ({}))), http: res.status }
}

section('AUTH_SECRET automático')
let h = await call('GET', '/api/health?check=1')
ok(h.checks?.auth_secret === 'automatico', 'health: auth_secret automático', h.checks)
const s1 = (await db.prepare("SELECT value FROM app_secrets WHERE name = 'auth_secret'").first())?.value
ok(typeof s1 === 'string' && s1.length >= 60, 'guardado en D1 (48 bytes)', s1?.length)
_resetSecretsCache()
await call('GET', '/api/health?check=1')
ok((await db.prepare('SELECT count(*) AS n, max(value) AS v FROM app_secrets').first()).v === s1, 'no cambia al reiniciar el Worker')
// Con el secreto automático funcionan las cuentas y los dos pasos (que cifran con AUTH_SECRET)
const su = await call('POST', '/api/auth/signup', { email: 'a@divingslot.test', password: 'Clave1234', data: { full_name: 'A' } }, { Origin: ORIGIN, 'X-DivingSlot': '1' })
ok(su.http === 200, 'alta de cuenta', su)
ok(mails.some((m) => m.to === 'a@divingslot.test'), 'email de confirmación (modo prueba)')

section('avisos sin clave')
ok((await call('POST', '/api/notify', { kind: 'alta', title: 'colado' })).http === 403, 'sin clave ni claim → 403')
ok((await call('POST', '/api/notify', { claim: 'no-es-un-uuid' })).http === 400, 'claim mal formado → 400')
ok((await call('POST', '/api/notify', { claim: crypto.randomUUID() })).http === 403, 'claim inventado → 403')
const id = put('notify', { kind: 'alta', title: 'Nueva cuenta de buceador: Ana', lines: ['Email: ana@example.com'], url: 'https://divingslot.com/app/#/admin/users' })
const n = await call('POST', '/api/notify', { claim: id })
ok(n.http === 200 && n.emailed === true, 'claim válido → aviso guardado y enviado', n)
const row = await db.prepare("SELECT kind, title, emailed FROM notify_log ORDER BY id DESC LIMIT 1").first()
ok(row?.title === 'Nueva cuenta de buceador: Ana' && row.emailed === 1, 'en notify_log', row)
ok(mails.some((m) => m.to === 'admin@divingslot.test' && /Ana/.test(m.subject)), 'email al administrador')
ok((await call('POST', '/api/notify', { claim: id })).http === 403, 'el mismo claim no vale dos veces')
const imp = put('import', { run: 'x', seq: 1, total: 1, statements: [] })
ok((await call('POST', '/api/notify', { claim: imp })).http === 403, 'un trozo de importación no vale como aviso')

section('importación sin clave')
const reqs = JSON.parse(fs.readFileSync(new URL('./fixtures/import-supabase.json', import.meta.url), 'utf8')).filter((r) => r.run === 't1').map((r) => r.body)
let last
for (const b of reqs.reverse()) last = await call('POST', '/api/import', { claim: put('import', b) })
ok(last.http === 200 && last.ok === true && last.counts?.users === 3, 'importación completa recogiendo los trozos de la cola', last)
ok(!(await db.prepare("SELECT 1 AS x FROM users WHERE email = 'a@divingslot.test'").first()), 'el reset deja solo los datos importados')
ok((await db.prepare("SELECT value FROM app_secrets WHERE name = 'auth_secret'").first())?.value === s1, 'el reset no toca AUTH_SECRET')
ok((await call('POST', '/api/import', { claim: put('notify', { kind: 'x' }) })).http === 403, 'un aviso no vale como trozo de importación')
const li = await call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'Secreta123' }, { Origin: ORIGIN, 'X-DivingSlot': '1' })
ok(li.http === 200, 'entrar con la contraseña de Supabase', li)

console.log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
