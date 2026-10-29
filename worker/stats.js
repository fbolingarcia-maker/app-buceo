// Visitas y avisos de uso.
//   POST /api/hit     la landing y la app avisan de cada página vista (sendBeacon, sin cookies). Se guarda el día, la
//                     página, de dónde llega, país, dispositivo e idioma. El visitante es un hash diario (IP + navegador
//                     + día + sal) que no permite saber quién es ni seguirlo de un día a otro.
//   GET  /api/stats   resumen para el panel de administración (solo administradores).
//   POST /api/notify  Supabase avisa de altas, centros y reservas (cabecera X-Notify-Key) → email al administrador.
//   dailyDigest()     resumen del día anterior por email a las 8:xx de Manila (desde el cron).
import { json, fail, all, first, run } from './lib/util.js'
import { sha256, safeEqual } from './lib/crypto.js'
import { sendEmail } from './email.js'

// Supabase (mientras la app use Supabase, los administradores se comprueban allí). Clave publishable: es pública.
const SUPABASE_URL = 'https://tosgzcpnkpsrrkfqctgy.supabase.co'
const SUPABASE_KEY = 'sb_publishable_QVcivbJNNX5TmEet6jv19A_uDR45c7R'

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch/i
// Día en hora de Manila (UTC+8, sin horario de verano)
export const manilaDay = (ms = Date.now()) => new Date(ms + 8 * 36e5).toISOString().slice(0, 10)

let ready = false
export async function ensureTables(db) {
  if (ready) return
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, ts INTEGER NOT NULL, path TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '', vh TEXT NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS visits_day ON visits (day)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL,
      kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', emailed INTEGER NOT NULL DEFAULT 0)`),
    db.prepare('CREATE INDEX IF NOT EXISTS notify_log_day ON notify_log (day)'),
  ])
  ready = true
}

export async function handleHit(req, env, url) {
  const nothing = new Response(null, { status: 204 })
  const origin = req.headers.get('Origin')
  if (origin && origin !== url.origin) return nothing
  const ua = req.headers.get('User-Agent') || ''
  if (!ua || BOT.test(ua) || !env.DB) return nothing
  let b
  try { b = JSON.parse((await req.text()).slice(0, 2000)) } catch { return nothing }
  const path = String(b.p || '').slice(0, 120)
  if (!/^\/[\w\-./:%]*$/.test(path)) return nothing
  const ref = String(b.r || '').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.\-]/g, '').slice(0, 80)
  const lang = b.l === 'es' || b.l === 'en' ? b.l : ''
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop'
  const day = manilaDay()
  const ip = req.headers.get('CF-Connecting-IP') || ''
  const vh = (await sha256(ip + '|' + ua + '|' + day + '|' + (env.AUTH_SECRET || 'divingslot-visits'))).slice(0, 16)
  await ensureTables(env.DB)
  await run(env.DB, 'INSERT INTO visits (day, ts, path, ref, country, device, lang, vh) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    day, Date.now(), path, ref, String(req.cf?.country || '').slice(0, 2), device, lang, vh)
  return nothing
}

// ¿Es administrador? Con el backend de Cloudflare, la sesión propia; con Supabase, su token (Supabase lo valida).
async function isAdmin(req, env, ctx) {
  if (ctx?.isAdmin) return true
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token || token.length > 4000) return false
  const r = await fetch((env.SUPABASE_URL || SUPABASE_URL) + '/rest/v1/rpc/is_platform_admin', {
    method: 'POST', body: '{}',
    headers: { apikey: env.SUPABASE_KEY || SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  }).catch(() => null)
  return !!r?.ok && (await r.json().catch(() => false)) === true
}

export async function handleStats(req, env, ctx, url) {
  if (!(await isAdmin(req, env, ctx))) fail('FORBIDDEN', 'solo administradores', 403)
  await ensureTables(env.DB)
  const days = Math.max(1, Math.min(+url.searchParams.get('days') || 30, 365))
  const today = manilaDay()
  const since = manilaDay(Date.now() - (days - 1) * 864e5)
  const db = env.DB
  const W = 'FROM visits WHERE day >= ?'
  const [tot, td, perDay, pages, refs, countries, devices, langs, funnel, events] = await Promise.all([
    first(db, `SELECT count(*) AS views, count(DISTINCT vh) AS visitors ${W}`, since),
    first(db, 'SELECT count(*) AS views, count(DISTINCT vh) AS visitors FROM visits WHERE day = ?', today),
    all(db, `SELECT day, count(*) AS views, count(DISTINCT vh) AS visitors ${W} GROUP BY day ORDER BY day`, since),
    all(db, `SELECT path, count(*) AS n ${W} GROUP BY path ORDER BY n DESC LIMIT 15`, since),
    all(db, `SELECT ref, count(DISTINCT day || vh) AS n ${W} GROUP BY ref ORDER BY n DESC LIMIT 10`, since),
    all(db, `SELECT country, count(DISTINCT day || vh) AS n ${W} GROUP BY country ORDER BY n DESC LIMIT 10`, since),
    all(db, `SELECT device, count(DISTINCT day || vh) AS n ${W} GROUP BY device ORDER BY n DESC`, since),
    all(db, `SELECT lang, count(DISTINCT day || vh) AS n ${W} GROUP BY lang ORDER BY n DESC`, since),
    // De la landing a la app: visitantes que vieron la landing y, el mismo día, alguna pantalla de la app
    first(db, `SELECT count(*) AS landing, sum(app) AS to_app FROM (
      SELECT day, vh, max(path <> '/') AS app FROM visits WHERE day >= ? AND vh IN (SELECT vh FROM visits WHERE day >= ? AND path = '/')
      GROUP BY day, vh HAVING max(path = '/') = 1)`, since, since),
    all(db, 'SELECT ts, kind, title, detail FROM notify_log ORDER BY id DESC LIMIT 15'),
  ])
  // Rellena los días sin visitas para que la gráfica tenga todos los días
  const map = Object.fromEntries(perDay.map((x) => [x.day, x]))
  const series = []
  for (let i = days - 1; i >= 0; i--) { const d = manilaDay(Date.now() - i * 864e5); series.push(map[d] || { day: d, views: 0, visitors: 0 }) }
  return json({ data: { days, today: td, totals: tot, per_day: series, pages, refs, countries, devices, langs,
    funnel: { landing: funnel?.landing || 0, to_app: funnel?.to_app || 0 }, events } })
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const notifyTo = (env) => env.NOTIFY_TO || env.SMTP_USER
const box = (title, body) => `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1f2c;max-width:560px">
  <p style="margin:0 0 4px;color:#0a5a85;font-weight:700">DivingSlot</p><h2 style="margin:0 0 12px;font-size:20px">${title}</h2>${body}</div>`

export async function handleNotify(req, env) {
  if (!env.NOTIFY_KEY) fail('NOT_CONFIGURED', 'falta NOTIFY_KEY', 503)
  if (!safeEqual(req.headers.get('X-Notify-Key') || '', env.NOTIFY_KEY)) fail('FORBIDDEN', 'clave incorrecta', 403)
  const b = await req.json().catch(() => ({}))
  return json({ ok: true, ...(await notifyAdmin(env, b)) })
}

// Aviso de uso: se guarda en notify_log (panel de administración) y se manda por email al administrador y, si se
// indica, al equipo del centro. Lo usan /api/notify (avisos desde Supabase) y, con el backend de Cloudflare, el
// propio Worker en las mismas situaciones que los triggers de la migración 030 (alta, centro, verificación, reserva, pago).
export async function notifyAdmin(env, b = {}) {
  if (!env.DB) return { emailed: false, centre: 0 }
  const kind = String(b.kind || 'otro').slice(0, 30)
  const title = String(b.title || 'Aviso').slice(0, 200)
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter((x) => x != null && x !== '').map((x) => String(x).slice(0, 300)).slice(0, 12)
  const link = typeof b.url === 'string' && /^https:\/\//.test(b.url) ? b.url : null
  await ensureTables(env.DB)
  const r = await env.DB.prepare('INSERT INTO notify_log (ts, day, kind, title, detail) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(new Date().toISOString(), manilaDay(), kind, title, lines.join(' · ')).first()
  let emailed = false
  if (notifyTo(env) && env.NOTIFY_EMAILS !== 'off') {
    const body = `<ul style="padding-left:18px;margin:0 0 12px">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      + (link ? `<p><a href="${esc(link)}" style="color:#0a5a85">Abrir en DivingSlot</a></p>` : '')
    try { await sendEmail(env, notifyTo(env), { subject: 'DivingSlot · ' + title, html: box(esc(title), body) }); emailed = true }
    catch (e) { console.error('notify email', e.message) }
    if (emailed) await run(env.DB, 'UPDATE notify_log SET emailed = 1 WHERE id = ?', r.id)
  }
  // Aviso al centro (p. ej. una reserva nueva): al equipo del centro, en inglés y español
  const to = (Array.isArray(b.to) ? b.to : []).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL.test(x)).slice(0, 3)
  let centre = 0
  for (const addr of to) {
    try { await sendEmail(env, addr, centreEmail(title, lines, link)); centre++ } catch (e) { console.error('notify centre', e.message) }
  }
  return { emailed, centre }
}

// Lanza un aviso sin hacer esperar a la respuesta (y sin que un fallo afecte a la acción)
export function notifyLater(ctxOrEnv, waitUntil, b) {
  const env = ctxOrEnv.env || ctxOrEnv
  const p = notifyAdmin(env, b).catch((e) => console.error('aviso', e.message))
  if (waitUntil) waitUntil(p)
  return p
}

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$/
const EN_LABELS = [['Salida: ', 'Trip: '], ['Buceador: ', 'Diver: '], ['Importe: ', 'Amount: '], ['Origen: ', 'Source: ']]
// Email al centro: el título y las líneas vienen en español desde Supabase; se añade la versión en inglés arriba
export function centreEmail(title, lines, link) {
  const m = /^Nueva reserva: (\d+) plazas? en (.+)$/.exec(title)
  const en = m ? `New booking: ${m[1]} ${m[1] === '1' ? 'spot' : 'spots'} at ${m[2]}` : title
  const enLines = lines.map((l) => { const x = EN_LABELS.find(([es]) => l.startsWith(es)); return x ? x[1] + l.slice(x[0].length) : l })
  const list = (ls) => `<ul style="padding-left:18px;margin:0 0 12px">${ls.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
  const body = list(enLines)
    + (link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#0a5a85;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700">Open the manifest · Abrir la agenda</a></p>` : '')
    + `<hr style="border:0;border-top:1px solid #e2e8ed;margin:16px 0"><p style="margin:0 0 6px;font-weight:700">${esc(title)}</p>` + list(lines)
    + '<p style="color:#5b6b77;font-size:13px;margin:0">You get this email because you manage this dive centre on DivingSlot. · Recibes este email porque gestionas este centro en DivingSlot.</p>'
  return { subject: 'DivingSlot · ' + en, html: box(esc(en), body) }
}

// Resumen diario: visitas y avisos del día anterior (hora de Manila)
export async function dailyDigest(env, force = false) {
  const hour = new Date(Date.now() + 8 * 36e5).getUTCHours()
  if ((!force && hour !== 8) || !notifyTo(env) || env.NOTIFY_DIGEST === 'off' || !env.DB) return
  await ensureTables(env.DB)
  const day = manilaDay(Date.now() - 864e5)
  const db = env.DB
  const [tot, landing, pages, refs, countries, events] = await Promise.all([
    first(db, 'SELECT count(*) AS views, count(DISTINCT vh) AS visitors FROM visits WHERE day = ?', day),
    first(db, "SELECT count(DISTINCT vh) AS n FROM visits WHERE day = ? AND path = '/'", day),
    all(db, 'SELECT path, count(*) AS n FROM visits WHERE day = ? GROUP BY path ORDER BY n DESC LIMIT 8', day),
    all(db, "SELECT ref, count(DISTINCT vh) AS n FROM visits WHERE day = ? AND ref <> '' GROUP BY ref ORDER BY n DESC LIMIT 5", day),
    all(db, "SELECT country, count(DISTINCT vh) AS n FROM visits WHERE day = ? AND country <> '' GROUP BY country ORDER BY n DESC LIMIT 5", day),
    all(db, 'SELECT kind, title FROM notify_log WHERE day = ? ORDER BY id', day),
  ])
  const list = (rows, f) => rows.length ? '<ul style="padding-left:18px;margin:4px 0 12px">' + rows.map((x) => `<li>${f(x)}</li>`).join('') + '</ul>' : '<p style="color:#5b6b77;margin:4px 0 12px">—</p>'
  const html = box(`Resumen del ${day}`,
    `<p style="font-size:17px;margin:0 0 12px"><b>${tot.visitors}</b> visitantes · <b>${tot.views}</b> páginas vistas · <b>${landing.n}</b> en la web comercial</p>`
    + '<b>Avisos</b>' + list(events, (x) => esc(x.title))
    + '<b>Páginas más vistas</b>' + list(pages, (x) => `${esc(x.path)} · ${x.n}`)
    + '<b>De dónde llegan</b>' + list(refs, (x) => `${esc(x.ref)} · ${x.n}`)
    + '<b>Países</b>' + list(countries, (x) => `${esc(x.country)} · ${x.n}`))
  await sendEmail(env, notifyTo(env), { subject: `DivingSlot · Resumen del ${day}: ${tot.visitors} visitantes, ${events.length} avisos`, html })
}

// Las visitas se guardan 13 meses
export async function pruneVisits(env) {
  if (!env.DB) return
  await ensureTables(env.DB)
  await run(env.DB, 'DELETE FROM visits WHERE day < ?', manilaDay(Date.now() - 400 * 864e5))
}
