// Mensajes privados entre el buceador y el centro, uno por reserva (12 nov 2026).
// - Hilo = reserva hecha por la app: lo ven SOLO el buceador de la reserva y el equipo del centro de la salida.
//   Ni los administradores de DivingSlot ni los guías (el hilo puede hablar de pagos o salud).
// - Privacidad (Data Privacy Act de Filipinas, RA 10173): los mensajes se guardan cifrados (AES-GCM, clave 'chat'
//   derivada de AUTH_SECRET), no se leen por REST ni salen en ningún panel de administración; los avisos (push y email)
//   no llevan el texto, solo quién escribe; se borran solos 12 meses después de la salida (purgeChats, cron) y al
//   eliminar la cuenta del buceador. Se puede escribir hasta 14 días después de la salida; luego solo leer.
// - El centro tiene una bandeja (`chat_inbox`) con los hilos ordenados por el último mensaje y, al abrir uno, la ficha
//   del buceador (certificación, médico, seguro, tallas, alergias…) y de la salida/reserva en la misma respuesta.
// - Avisos: push al instante y email solo para el primer mensaje que el otro lado no ha leído (no uno por mensaje).
// - Tiempo casi real con consultas cada pocos segundos mientras el hilo está abierto (sin WebSockets: con el volumen de
//   un centro es más barato y simple; si un día hace falta, se cambia por un Durable Object sin tocar la app).
// Las tablas se crean solas (ensureChat) y también están en schema.js para las pruebas.
import { fail, nowIso, uuid, all, first, run } from './lib/util.js'
import { rateLimit } from './auth.js'
import { sendEmail, mailLang } from './email.js'
import { notifyDiver, notifyCentreStaff } from './push.js'
import { encryptFor, decryptFor } from './lib/crypto.js'

const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const later = (ctx, p) => { const q = p.catch((e) => console.error('chat aviso', e.message)); if (ctx.waitUntil) ctx.waitUntil(q); return q }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const MAX = 1000
const OPEN_DAYS = 14 // se puede escribir hasta 14 días después de la salida; después, solo leer
export const KEEP_MONTHS = 12 // se borran 12 meses después de la salida
const EMAIL_GAP_H = 12 // si el otro lado no lee, como mucho un email cada 12 h por hilo

let ready = false
export async function ensureChat(db) {
  if (ready) return
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS booking_messages (
      id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('diver', 'center')), user_id TEXT, author TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare('CREATE INDEX IF NOT EXISTS booking_messages_b ON booking_messages (booking_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS booking_chat_state (
      booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, side TEXT NOT NULL CHECK (side IN ('diver', 'center')),
      read_at TEXT, emailed_at TEXT, PRIMARY KEY (booking_id, side))`),
  ])
  ready = true
}

// Quién es quién en el hilo: el buceador de la reserva o el equipo del centro. Nadie más (tampoco el administrador)
async function access(ctx, bookingId) {
  mfa(ctx)
  if (!ctx.uid) fail('FORBIDDEN', 'inicia sesión para ver los mensajes', 401)
  await ensureChat(ctx.db)
  const b = await first(ctx.db, `SELECT b.*, t.center_id, t.departs_at FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.id = ?`, String(bookingId || ''))
  if (!b || !b.diver_id) fail('NOT_FOUND', 'no encontramos esta reserva', 404)
  if (ctx.diverId && b.diver_id === ctx.diverId) return { b, side: 'diver' }
  if (ctx.staff.includes(b.center_id)) return { b, side: 'center' }
  fail('FORBIDDEN', 'esta conversación es solo del buceador y del centro de la reserva', 403)
}

const seal = (ctx, text) => encryptFor(ctx.env.AUTH_SECRET, 'chat', text)
const open = async (ctx, boxed) => { try { return await decryptFor(ctx.env.AUTH_SECRET, 'chat', boxed) } catch (e) { return '' } }
const closed = (b) => Date.now() > Date.parse(b.departs_at) + OPEN_DAYS * 864e5
const markRead = (db, bookingId, side) => run(db, `INSERT INTO booking_chat_state (booking_id, side, read_at) VALUES (?, ?, ?)
  ON CONFLICT (booking_id, side) DO UPDATE SET read_at = excluded.read_at`, bookingId, side, nowIso())

// Lo que ve el centro del buceador: lo mismo que en el manifiesto de una salida reservada
async function diverCard(db, diverId) {
  const d = await first(db, `SELECT id, full_name, email, country, languages, logged_dives, last_dive_date, nitrox, medical_done_at,
    medical_result, allergies, insurance_provider, insurance_expiry, wetsuit_size, bcd_size, fin_size, locale FROM divers WHERE id = ?`, diverId)
  if (!d) return null
  const certs = await all(db, 'SELECT agency, level, verified_at FROM certifications WHERE diver_id = ? ORDER BY rowid', diverId).catch(() => [])
  const logs = (await first(db, 'SELECT count(*) AS n FROM dive_logs WHERE diver_id = ?', diverId).catch(() => null))?.n || 0
  let languages = []
  try { languages = typeof d.languages === 'string' ? JSON.parse(d.languages) : d.languages || [] } catch (e) { /* vacío */ }
  return { ...d, languages, nitrox: !!d.nitrox, dives: (d.logged_dives || 0) + logs, certifications: certs.map((c) => ({ ...c, verified: !!c.verified_at })) }
}
async function tripCard(db, b) {
  const t = await first(db, `SELECT t.id, t.departs_at, t.num_dives, t.status, t.kind, t.course_name, t.activity, t.min_level, c.name AS center_name,
    c.phone AS center_phone, c.destination, bo.name AS boat_name
    FROM trips t JOIN centers c ON c.id = t.center_id LEFT JOIN boats bo ON bo.id = t.boat_id WHERE t.id = ?`, b.trip_id)
  const sites = await all(db, 'SELECT s.name FROM trip_sites ts JOIN dive_sites s ON s.id = ts.site_id WHERE ts.trip_id = ? ORDER BY ts.position', b.trip_id).catch(() => [])
  const extras = await all(db, 'SELECT name, qty FROM booking_extras WHERE booking_id = ?', b.id).catch(() => [])
  return {
    trip: { ...t, sites: sites.map((s) => s.name) },
    booking: { id: b.id, status: b.status, seats: b.seats, with_gear: !!b.with_gear, amount_php: b.amount_php, paid_php: b.paid_php,
      deposit_php: b.deposit_php, pay_on_site: !!b.pay_on_site, checked_in_at: b.checked_in_at, created_at: b.created_at, extras },
  }
}

export const CHAT = {
  // El hilo de una reserva: mensajes, quién soy, la ficha de la salida y, para el centro, la del buceador
  async booking_chat(ctx, { p_booking, p_after = null }) {
    const { b, side } = await access(ctx, p_booking)
    const rows = await all(ctx.db, `SELECT id, sender, author, body, created_at FROM booking_messages WHERE booking_id = ? ${p_after ? 'AND created_at > ?' : ''}
      ORDER BY created_at DESC LIMIT 200`, b.id, ...(p_after ? [String(p_after)] : []))
    const msgs = await Promise.all(rows.map(async (m) => ({ ...m, body: await open(ctx, m.body) })))
    await markRead(ctx.db, b.id, side)
    const other = await first(ctx.db, 'SELECT read_at FROM booking_chat_state WHERE booking_id = ? AND side = ?', b.id, side === 'diver' ? 'center' : 'diver')
    const out = { side, closed: closed(b), other_read_at: other?.read_at || null,
      messages: msgs.reverse().map((m) => ({ ...m, mine: m.sender === side })) }
    if (p_after) return out // al refrescar solo hacen falta los mensajes nuevos
    return { ...out, ...(await tripCard(ctx.db, b)), diver: side === 'center' ? await diverCard(ctx.db, b.diver_id) : null }
  },

  async booking_chat_send(ctx, { p_booking, p_body }) {
    const { b, side } = await access(ctx, p_booking)
    if (closed(b)) fail('CLOSED', 'la conversación se cerró 14 días después de la salida; ya solo se puede leer')
    const body = String(p_body || '').trim()
    if (!body || body.length > MAX) fail('BAD_MESSAGE', 'escribe un mensaje de hasta 1000 caracteres')
    await rateLimit(ctx.env, 'bchat:' + ctx.uid, 30, 600)
    const c = await first(ctx.db, 'SELECT name FROM centers WHERE id = ?', b.center_id)
    const d = await first(ctx.db, 'SELECT full_name, user_id, email, locale FROM divers WHERE id = ?', b.diver_id)
    const author = side === 'center' ? c?.name || 'Centro' : d?.full_name || 'Buceador'
    const id = uuid(), at = nowIso()
    await run(ctx.db, 'INSERT INTO booking_messages (id, booking_id, sender, user_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, b.id, side, ctx.uid, author, await seal(ctx, body), at)
    await markRead(ctx.db, b.id, side)
    // Avisos al otro lado: push siempre; email si no ha leído desde el último email (como mucho uno cada 12 h)
    const to = side === 'diver' ? 'center' : 'diver'
    const url = side === 'diver' ? '/centro/mensajes/' + b.id : '/mensajes/' + b.id
    // Sin el texto del mensaje: la pantalla bloqueada o el buzón no deben mostrar conversaciones privadas
    const push = { title: author, body: side === 'diver' ? 'Nuevo mensaje · New message' : mailLang(d?.locale) === 'es' ? 'Nuevo mensaje del centro' : 'New message from the centre', url, tag: 'bchat-' + b.id }
    later(ctx, side === 'diver' ? notifyCentreStaff(ctx.env, b.center_id, push) : notifyDiver(ctx.env, b.diver_id, push))
    later(ctx, emailOther(ctx, { b, to, author, url, center: c?.name || '', diver: d }))
    return { id, created_at: at }
  },

  // Bandeja del centro: un hilo por reserva con mensajes, el último arriba y cuántos sin leer
  async chat_inbox(ctx, { p_center }) {
    mfa(ctx)
    if (!ctx.staff.includes(p_center)) fail('FORBIDDEN', 'las conversaciones son solo del centro y de sus buceadores', 403)
    await ensureChat(ctx.db)
    const rows = await all(ctx.db, `SELECT b.id AS booking_id, b.status, b.seats, t.departs_at, t.id AS trip_id, d.full_name AS diver_name,
        m.body AS last_body, m.sender AS last_sender, m.created_at AS last_at,
        (SELECT count(*) FROM booking_messages x WHERE x.booking_id = b.id AND x.sender = 'diver'
          AND x.created_at > coalesce((SELECT read_at FROM booking_chat_state s WHERE s.booking_id = b.id AND s.side = 'center'), '')) AS unread
      FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN divers d ON d.id = b.diver_id
      JOIN booking_messages m ON m.id = (SELECT id FROM booking_messages WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1)
      WHERE t.center_id = ? ORDER BY m.created_at DESC LIMIT 200`, p_center)
    return Promise.all(rows.map(async (r) => ({ ...r, last_body: (await open(ctx, r.last_body)).slice(0, 160) })))
  },

  // Sin leer: por reserva para el buceador (Reservas) y en total para el centro (icono de la cabecera)
  async chat_unread(ctx) {
    if (!ctx.uid || !ctx.mfaOk) return { bookings: {}, center: 0 }
    await ensureChat(ctx.db)
    const bookings = {}
    if (ctx.diverId) {
      const r = await all(ctx.db, `SELECT m.booking_id, count(*) AS n FROM booking_messages m JOIN bookings b ON b.id = m.booking_id
        WHERE b.diver_id = ? AND m.sender = 'center'
          AND m.created_at > coalesce((SELECT read_at FROM booking_chat_state s WHERE s.booking_id = m.booking_id AND s.side = 'diver'), '')
        GROUP BY m.booking_id`, ctx.diverId)
      for (const x of r) bookings[x.booking_id] = x.n
    }
    let center = 0
    if (ctx.staff.length) {
      center = (await first(ctx.db, `SELECT count(*) AS n FROM booking_messages m JOIN bookings b ON b.id = m.booking_id JOIN trips t ON t.id = b.trip_id
        WHERE t.center_id IN (${ctx.staff.map(() => '?').join(',')}) AND m.sender = 'diver'
          AND m.created_at > coalesce((SELECT read_at FROM booking_chat_state s WHERE s.booking_id = m.booking_id AND s.side = 'center'), '')`, ...ctx.staff))?.n || 0
    }
    return { bookings, center }
  },
}

async function emailOther(ctx, { b, to, author, url, center, diver }) {
  const st = await first(ctx.db, 'SELECT read_at, emailed_at FROM booking_chat_state WHERE booking_id = ? AND side = ?', b.id, to)
  const recent = st?.emailed_at && Date.now() - Date.parse(st.emailed_at) < EMAIL_GAP_H * 36e5
  // Ya hay un email sin leer pendiente (o uno reciente): no se manda otro
  if (st?.emailed_at && (recent || !st.read_at || st.read_at < st.emailed_at)) return
  const link = (ctx.origin || 'https://divingslot.com') + '/app/#' + url
  let recipients = []
  if (to === 'diver') { if (diver?.email) recipients = [{ email: diver.email, locale: diver.locale }] }
  else if (!center.startsWith('Demo')) {
    recipients = await all(ctx.db, `SELECT u.email, (SELECT locale FROM divers WHERE user_id = u.id) AS locale FROM center_staff s JOIN users u ON u.id = s.user_id
      WHERE s.center_id = ? AND u.email IS NOT NULL ORDER BY s.role DESC LIMIT 3`, b.center_id)
  }
  if (!recipients.length) return
  await run(ctx.db, `INSERT INTO booking_chat_state (booking_id, side, emailed_at) VALUES (?, ?, ?)
    ON CONFLICT (booking_id, side) DO UPDATE SET emailed_at = excluded.emailed_at`, b.id, to, nowIso())
  for (const r of recipients) await sendEmail(ctx.env, r.email, chatEmail(author, b.departs_at, center, link, r.locale)).catch((e) => console.error('chat email', e.message))
}

// Email del primer mensaje sin leer (español o inglés; el resto de idiomas, inglés). Sin el texto del mensaje.
export function chatEmail(author, departs, center, link, lang) {
  const l = mailLang(lang) === 'es' ? 'es' : 'en'
  const local = new Date(Date.parse(departs) + 8 * 36e5).toISOString()
  const when = `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`
  const T = {
    es: { s: `Nuevo mensaje de ${author}`, h: `${esc(author)} te ha escrito sobre la salida del ${when}${center ? ' con ' + esc(center) : ''}.`, btn: 'Leer y responder', f: 'Por privacidad, el mensaje solo se puede leer en DivingSlot.' },
    en: { s: `New message from ${author}`, h: `${esc(author)} wrote to you about the ${when} trip${center ? ' with ' + esc(center) : ''}.`, btn: 'Read and reply', f: 'For your privacy, the message can only be read in DivingSlot.' },
  }[l]
  const html = `<!doctype html><html lang="${l}"><body style="font-family:Arial,sans-serif;background:#f3f6f8;padding:16px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:22px">`
    + `<h2 style="margin-top:0">DivingSlot</h2><p>${T.h}</p>`
    + `<p><a href="${esc(link)}" style="display:inline-block;background:#0a5a85;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700">${T.btn}</a></p>`
    + `<p style="color:#5b6b77;font-size:13px;margin:0">${T.f}</p></div></body></html>`
  return { subject: T.s, html }
}

// Conservación limitada: borra los hilos de salidas de hace más de 12 meses (cron horario de limpieza)
export async function purgeChats(env, now = Date.now()) {
  await ensureChat(env.DB)
  const limit = new Date(now - KEEP_MONTHS * 30.44 * 864e5).toISOString()
  const old = `SELECT b.id FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE t.departs_at < ?`
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM booking_messages WHERE booking_id IN (${old})`).bind(limit),
    env.DB.prepare(`DELETE FROM booking_chat_state WHERE booking_id IN (${old})`).bind(limit),
  ])
}

// Derecho de supresión: al eliminar la cuenta del buceador se borran sus conversaciones (las reservas quedan anonimizadas)
export async function deleteDiverChats(db, diverId) {
  await ensureChat(db)
  return [
    db.prepare('DELETE FROM booking_messages WHERE booking_id IN (SELECT id FROM bookings WHERE diver_id = ?)').bind(diverId),
    db.prepare('DELETE FROM booking_chat_state WHERE booking_id IN (SELECT id FROM bookings WHERE diver_id = ?)').bind(diverId),
  ]
}
