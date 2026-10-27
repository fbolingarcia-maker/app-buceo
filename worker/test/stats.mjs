// Pruebas de visitas, panel y avisos (sin red): node --no-warnings worker/test/stats.mjs
import { D1 } from './shim.mjs'
import worker, { handleApi } from '../index.js'
import { dailyDigest, manilaDay } from '../stats.js'

const ORIGIN = 'https://divingslot.test'
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
const env = { DB: db, AUTH_SECRET: 'prueba-secreto-de-32-caracteres-x', EMAIL_DEV_LOG: '1', NOTIFY_KEY: 'clave-avisos', NOTIFY_TO: 'admin@divingslot.test' }
let fails = 0, passes = 0
const ok = (c, name, extra) => { if (c) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '') } }
const mails = []
const log = console.log
console.log = (...a) => { if (a[0] === 'EMAIL (modo prueba)') mails.push({ to: a[1], subject: a[2] }); else log(...a) }

// Supabase simulado: el token «admin» es de un administrador
globalThis.fetch = async (url, opt = {}) => {
  if (String(url).endsWith('/rest/v1/rpc/is_platform_admin')) {
    const tok = (opt.headers?.Authorization || '').replace('Bearer ', '')
    return new Response(JSON.stringify(tok === 'admin'), { status: tok ? 200 : 401 })
  }
  throw new Error('fetch no simulado ' + url)
}
const UA_MOVIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36'
const hit = (body, { ip = '1.1.1.1', ua = UA_MOVIL, origin = ORIGIN, country = 'PH' } = {}) => {
  const req = new Request(ORIGIN + '/api/hit', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain', Origin: origin, 'User-Agent': ua, 'CF-Connecting-IP': ip } })
  Object.defineProperty(req, 'cf', { value: { country } })
  return handleApi(req, env, {})
}
const get = (path, token) => handleApi(new Request(ORIGIN + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }), env, {})

// Visitas
ok((await hit({ p: '/', r: 'www.Google.com', l: 'en' })).status === 204, 'cuenta la landing')
await hit({ p: '/app', l: 'en' })
await hit({ p: '/app/salida/:id', l: 'en' })
await hit({ p: '/', r: 'instagram.com', l: 'es' }, { ip: '2.2.2.2', ua: UA_PC, country: 'ES' })
await hit({ p: '/app/puntos', l: 'es' }, { ip: '3.3.3.3', ua: UA_PC, country: 'ES' })
await hit({ p: '/' }, { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' })
await hit({ p: '/' }, { origin: 'https://otra.example' })
await hit({ p: 'javascript:alert(1)' })
const n = (await db.prepare('SELECT count(*) AS n FROM visits').first()).n
ok(n === 5, 'no cuenta bots, otros orígenes ni rutas raras', n)
const v = await db.prepare("SELECT * FROM visits WHERE ref <> '' ORDER BY ts LIMIT 1").first()
ok(v.ref === 'google.com' && v.device === 'mobile' && v.country === 'PH' && v.day === manilaDay() && v.vh.length === 16, 'guarda origen, dispositivo, país y visitante anónimo', v)

// Panel
ok((await get('/api/stats')).status === 403, 'sin sesión: 403')
ok((await get('/api/stats', 'otro')).status === 403, 'usuario normal: 403')
let r = await get('/api/stats?days=7', 'admin')
const s = (await r.json()).data
ok(r.status === 200 && s.totals.visitors === 3 && s.totals.views === 5, 'totales', s?.totals)
ok(s.per_day.length === 7 && s.per_day.at(-1).visitors === 3, 'serie de 7 días', s?.per_day?.at(-1))
ok(s.funnel.landing === 2 && s.funnel.to_app === 1, 'de la landing a la app', s?.funnel)
ok(s.pages[0].path === '/' && s.refs.some((x) => x.ref === 'instagram.com') && s.countries[0].country === 'ES' && s.countries.some((x) => x.country === 'PH'), 'páginas, orígenes y países', s?.pages)

// Avisos
const notify = (body, key = 'clave-avisos') => handleApi(new Request(ORIGIN + '/api/notify', { method: 'POST', body: JSON.stringify(body), headers: { 'X-Notify-Key': key, 'Content-Type': 'application/json' } }), env, {})
ok((await notify({ kind: 'alta', title: 'x' }, 'mala')).status === 403, 'clave incorrecta: 403')
r = await notify({ kind: 'reserva', title: 'Nueva reserva: 2 plazas en Casa Azul', lines: ['Salida: 01/11 07:30', 'Importe: ₱7,600'], url: 'https://divingslot.com/app/#/admin' })
ok(r.status === 200 && (await r.json()).emailed === true && mails.at(-1).to === 'admin@divingslot.test', 'email al administrador', mails.at(-1))
r = await get('/api/stats', 'admin')
ok((await r.json()).data.events[0].title.startsWith('Nueva reserva'), 'el aviso sale en el panel')
// Aviso al centro: a su equipo, en inglés y español; direcciones raras fuera
mails.length = 0
r = await notify({ kind: 'reserva', title: 'Nueva reserva: 1 plaza en Blue Reef', lines: ['Salida: 01/11/2026 07:30', 'Buceador: Ana', 'Importe: ₱3,800', 'Origen: app'], url: 'https://divingslot.com/app/#/centro/agenda', to: ['Owner@Blue.ph', 'no-es-email', 'mgr@blue.ph'] })
const rj = await r.json()
ok(rj.centre === 2 && mails.some((m) => m.to === 'owner@blue.ph' && m.subject === 'DivingSlot · New booking: 1 spot at Blue Reef') && mails.some((m) => m.to === 'admin@divingslot.test'), 'email al centro y al administrador', mails)
const { centreEmail } = await import('../stats.js')
ok(/Diver: Ana/.test(centreEmail('Nueva reserva: 2 plazas en X', ['Buceador: Ana'], null).html), 'traduce las líneas al inglés')

// Resumen diario (forzado; normalmente a las 8:xx de Manila). Cuenta el día anterior: se simula moviendo las visitas.
await db.prepare('UPDATE visits SET day = ?').bind(manilaDay(Date.now() - 864e5)).run()
await db.prepare('UPDATE notify_log SET day = ?').bind(manilaDay(Date.now() - 864e5)).run()
mails.length = 0
await dailyDigest(env, true)
ok(mails.length === 1 && /3 visitantes, 2 avisos/.test(mails[0].subject), 'resumen diario', mails[0])

// El cron no rompe sin email configurado
await worker.scheduled({}, { DB: db }, { waitUntil: (p) => p.catch((e) => { fails++; log('cron', e) }) })

console.log = log
console.log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
