// Mejoras de usabilidad del 9 nov 2026 (ideas de Playtomic, Garmin y PADI):
// lista de espera, chat de la salida, reseñas de centros, firma de bitácoras, bonos, salidas repetidas,
// avisos en el móvil (Web Push), buddies que se buscan y tarjeta de certificación con foto.
// Se suman a las RPC de rpc.js (handleRpc). `rpc` = el mapa completo de RPC, para reutilizar book_trip.
import { HOLDS, APP_AVAILABLE, CERT_LEVELS } from './schema.js'
import { fail, nowIso, uuid, all, first, run, changes } from './lib/util.js'
import { sendEmail, TEMPLATES } from './email.js'
import { notifyDiver, notifyCentreStaff, vapidKeys } from './push.js'
import { signedObjectUrl } from './storage.js'
import { rateLimit } from './auth.js'

const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const isStaff = (ctx, center) => ctx.staff.includes(center)
const later = (ctx, p) => { const q = p.catch((e) => console.error('aviso', e.message)); if (ctx.waitUntil) ctx.waitUntil(q); return q }
export const shortName = (n) => {
  const s = String(n || '').trim() || 'Buceador'
  const w = s.split(/\s+/)
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]
}
export const WAITLIST_HOLD_MIN = 30
const when = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// Experiencia a partir de la certificación y las inmersiones (como el nivel de Playtomic, pero sin partidos)
export function expLevel(level, dives) {
  const rank = CERT_LEVELS.indexOf(level)
  const n = +dives || 0
  if (rank >= 3 || n >= 500) return 'expert'
  if (n >= 100 || (rank >= 2 && n >= 50)) return 'experienced'
  if (n >= 20 || rank >= 1) return 'regular'
  return 'new'
}

// ── Lista de espera ──
// Al quedar plazas libres se crea sola una reserva retenida 30 min para el primero de la lista y se le avisa.
export async function processWaitlist(env, db, tripId, rpc, waitUntil) {
  const now = Date.now()
  // Ofertas resueltas: pagadas → booked; caducadas o canceladas → expired (y pasa el siguiente)
  const offered = await all(db, `SELECT w.id, w.booking_id, b.status, b.created_at, b.hold_until FROM trip_waitlist w LEFT JOIN bookings b ON b.id = w.booking_id
    WHERE w.trip_id = ? AND w.status = 'offered'`, tripId)
  for (const o of offered) {
    if (o.status === 'confirmed') await run(db, "UPDATE trip_waitlist SET status = 'booked' WHERE id = ?", o.id)
    else if (!o.status || o.status !== 'pending_payment' || Math.max(Date.parse(o.created_at) + 15 * 60000, o.hold_until ? Date.parse(o.hold_until) : 0) <= now) {
      await run(db, "UPDATE trip_waitlist SET status = 'expired' WHERE id = ?", o.id)
    }
  }
  const t = await first(db, `SELECT t.id, t.departs_at, t.status, t.center_id, c.name AS center, ${APP_AVAILABLE('t')} AS free FROM trips t JOIN centers c ON c.id = t.center_id WHERE t.id = ?`, tripId)
  if (!t || t.status !== 'published' || Date.parse(t.departs_at) - now < 2 * 36e5) {
    await run(db, "UPDATE trip_waitlist SET status = 'expired' WHERE trip_id = ? AND status = 'waiting'", tripId)
    return 0
  }
  let free = t.free, offers = 0
  const queue = await all(db, `SELECT w.*, d.user_id, d.locale, u.email FROM trip_waitlist w JOIN divers d ON d.id = w.diver_id LEFT JOIN users u ON u.id = d.user_id
    WHERE w.trip_id = ? AND w.status = 'waiting' ORDER BY w.created_at`, tripId)
  for (const w of queue) {
    if (free < 1) break
    if (w.seats > free) continue // los que piden más plazas de las que hay esperan; el siguiente puede caber
    const ctx = { db, env, uid: w.user_id, diverId: w.diver_id, mfaOk: true, staff: [], isAdmin: false, waitUntil }
    let b
    try { b = await rpc.book_trip(ctx, { p_trip: tripId, p_seats: w.seats, p_with_gear: !!w.with_gear, p_medical_signed: true }) } catch (e) {
      const code = String(e.message).split(':')[0]
      if (code === 'DUPLICATE') { await run(db, "UPDATE trip_waitlist SET status = 'booked' WHERE id = ?", w.id); continue }
      if (code === 'NO_SEATS') break
      await run(db, "UPDATE trip_waitlist SET status = 'expired' WHERE id = ?", w.id)
      continue
    }
    const until = new Date(now + WAITLIST_HOLD_MIN * 60000).toISOString()
    await db.batch([
      db.prepare('UPDATE bookings SET hold_until = ? WHERE id = ?').bind(until, b.id),
      db.prepare("UPDATE trip_waitlist SET status = 'offered', booking_id = ?, offered_at = ? WHERE id = ?").bind(b.id, nowIso(), w.id),
    ])
    free -= w.seats; offers++
    const payload = { title: 'Plaza libre · Spot available', body: `${t.center} · ${when(t.departs_at)}: tu plaza está retenida ${WAITLIST_HOLD_MIN} min. / Your spot is held for ${WAITLIST_HOLD_MIN} min.`, url: '/reservas', tag: 'waitlist-' + tripId, urgent: true }
    const origin = env.APP_ORIGIN || 'https://divingslot.com'
    const p = Promise.all([
      notifyDiver(env, w.diver_id, payload),
      w.email ? sendEmail(env, w.email, TEMPLATES.waitlistOffer(t.center, t.departs_at, WAITLIST_HOLD_MIN, origin + '/app/#/reservas', w.locale)) : null,
    ]).catch((e) => console.error('aviso lista de espera', e.message))
    if (waitUntil) waitUntil(p); else await p
  }
  return offers
}

// Todas las salidas con gente esperando (lo llama el cron cada 10 min)
export async function processAllWaitlists(env, rpc) {
  const trips = await all(env.DB, "SELECT DISTINCT trip_id FROM trip_waitlist WHERE status IN ('waiting', 'offered') LIMIT 100")
  let n = 0
  for (const r of trips) n += await processWaitlist(env, env.DB, r.trip_id, rpc).catch((e) => { console.error('lista de espera', e.message); return 0 })
  return n
}

// Avisa a buceadores que buscan buddy en ese destino cuando alguien de nivel parecido reserva (uno por salida y persona)
export async function buddyAlerts(env, db, tripId, bookerDiverId) {
  const me = await first(db, `SELECT d.id, d.full_name, d.seeks_buddy, d.show_on_trips,
      (SELECT level FROM certifications WHERE diver_id = d.id ORDER BY CASE level ${CERT_LEVELS.map((l, i) => `WHEN '${l}' THEN ${i}`).join(' ')} END DESC LIMIT 1) AS level
    FROM divers d WHERE d.id = ?`, bookerDiverId)
  if (!me?.seeks_buddy || !me.show_on_trips) return 0
  const t = await first(db, 'SELECT t.id, t.departs_at, c.name AS center, c.destination FROM trips t JOIN centers c ON c.id = t.center_id WHERE t.id = ?', tripId)
  if (!t?.destination) return 0
  const rank = CERT_LEVELS.indexOf(me.level)
  const cands = await all(db, `SELECT d.id, d.locale, u.email,
      (SELECT level FROM certifications WHERE diver_id = d.id ORDER BY CASE level ${CERT_LEVELS.map((l, i) => `WHEN '${l}' THEN ${i}`).join(' ')} END DESC LIMIT 1) AS level
    FROM divers d LEFT JOIN users u ON u.id = d.user_id
    WHERE d.seeks_buddy = 1 AND d.id <> ? AND EXISTS (SELECT 1 FROM json_each(d.alert_destinations) j WHERE j.value = ?)
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = ? AND b.diver_id = d.id AND ${HOLDS('b')})
      AND NOT EXISTS (SELECT 1 FROM buddy_alerts a WHERE a.trip_id = ? AND a.diver_id = d.id) LIMIT 60`, me.id, t.destination, t.id, t.id)
  const pick = cands.filter((c) => Math.abs(CERT_LEVELS.indexOf(c.level) - rank) <= 1).slice(0, 15)
  const origin = env.APP_ORIGIN || 'https://divingslot.com'
  for (const c of pick) {
    await run(db, 'INSERT OR IGNORE INTO buddy_alerts (trip_id, diver_id) VALUES (?, ?)', t.id, c.id)
    await notifyDiver(env, c.id, { title: 'Buddy disponible · Buddy available', body: `${shortName(me.full_name)} busca buddy en ${t.destination} · ${when(t.departs_at)}`, url: '/salida/' + t.id, tag: 'buddy-' + t.id }).catch(() => 0)
    if (c.email) await sendEmail(env, c.email, TEMPLATES.buddyAlert(shortName(me.full_name), me.level, t.center, t.destination, t.departs_at, origin + '/app/#/salida/' + t.id, c.locale)).catch(() => {})
  }
  return pick.length
}

async function tripAccess(ctx, tripId) {
  const t = await first(ctx.db, 'SELECT id, center_id, departs_at, status FROM trips WHERE id = ?', tripId)
  if (!t) fail('NOT_FOUND')
  if (isStaff(ctx, t.center_id) || ctx.isAdmin) return { t, staff: true }
  const b = ctx.diverId && await first(ctx.db, `SELECT 1 AS x FROM bookings b WHERE b.trip_id = ? AND b.diver_id = ? AND (b.status = 'confirmed' OR ${HOLDS('b')})`, tripId, ctx.diverId)
  if (!b) fail('FORBIDDEN', 'el chat es para quien tiene plaza en la salida', 403)
  return { t, staff: false }
}

export const PLUS = {
  // ── Avisos en el móvil ──
  async push_key(ctx) { return { key: (await vapidKeys(ctx.env)).pub } },
  async push_subscribe(ctx, { p_endpoint, p_p256dh, p_auth, p_lang = null }) {
    if (!ctx.uid) fail('NO_SESSION', 'inicia sesión', 401)
    mfa(ctx)
    const ep = String(p_endpoint || '')
    if (!/^https:\/\/[^\s]{10,800}$/.test(ep) || !p_p256dh || !p_auth) fail('BAD_SUBSCRIPTION', 'suscripción no válida')
    await run(ctx.db, `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, lang) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang`,
    ep, ctx.uid, String(p_p256dh).slice(0, 200), String(p_auth).slice(0, 100), p_lang ? String(p_lang).slice(0, 5) : null)
    return { ok: true }
  },
  async push_unsubscribe(ctx, { p_endpoint }) {
    if (!ctx.uid) return { ok: true }
    await run(ctx.db, 'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', String(p_endpoint || ''), ctx.uid)
    return { ok: true }
  },
  async push_test(ctx) {
    if (!ctx.uid) fail('NO_SESSION', 'inicia sesión', 401)
    await rateLimit(ctx.env, 'pushtest:' + ctx.uid, 5, 3600)
    const { notifyUser } = await import('./push.js')
    return { sent: await notifyUser(ctx.env, ctx.uid, { title: 'DivingSlot', body: 'Los avisos funcionan · Notifications are on', url: '/' }) }
  },

  // ── Lista de espera ──
  async join_waitlist(ctx, { p_trip, p_seats = 1, p_with_gear = false, p_medical_signed = false }) {
    mfa(ctx)
    if (!ctx.diverId) fail('NO_PROFILE', 'crea tu perfil de buceador')
    if (!p_medical_signed) fail('NO_MEDICAL', 'falta la declaración médica')
    const seats = +p_seats
    if (!Number.isInteger(seats) || seats < 1 || seats > 6) fail('BAD_SEATS', 'número de plazas no válido')
    const t = await first(ctx.db, `SELECT t.*, ${APP_AVAILABLE('t')} AS free FROM trips t WHERE t.id = ?`, p_trip)
    if (!t || t.status !== 'published') fail('NOT_BOOKABLE', 'la salida no está abierta')
    const levels = (await all(ctx.db, 'SELECT level FROM certifications WHERE diver_id = ?', ctx.diverId)).map((c) => CERT_LEVELS.indexOf(c.level))
    const need = t.kind === 'course' ? t.course_prereq : t.min_level
    if (need && (!levels.length || Math.max(...levels) < CERT_LEVELS.indexOf(need))) fail('LEVEL', 'tu certificación no alcanza el mínimo')
    if (t.free >= seats) fail('HAS_SEATS', 'aún quedan plazas: resérvala directamente')
    const dup = await first(ctx.db, `SELECT 1 AS x FROM bookings b WHERE b.trip_id = ? AND b.diver_id = ? AND ${HOLDS('b')}`, t.id, ctx.diverId)
    if (dup) fail('DUPLICATE', 'ya tienes una reserva en esta salida')
    try {
      await run(ctx.db, 'INSERT INTO trip_waitlist (id, trip_id, diver_id, seats, with_gear) VALUES (?, ?, ?, ?, ?)', uuid(), t.id, ctx.diverId, seats, p_with_gear ? 1 : 0)
    } catch (e) { fail('DUPLICATE', 'ya estás en la lista de espera') }
    const pos = await first(ctx.db, "SELECT count(*) AS n FROM trip_waitlist WHERE trip_id = ? AND status = 'waiting'", t.id)
    return { position: pos.n }
  },
  async leave_waitlist(ctx, { p_trip }) {
    mfa(ctx)
    const r = await run(ctx.db, "UPDATE trip_waitlist SET status = 'left' WHERE trip_id = ? AND diver_id = ? AND status = 'waiting'", p_trip, ctx.diverId || '')
    return { left: changes(r) }
  },
  async my_waitlist(ctx) {
    if (!ctx.diverId) return []
    return all(ctx.db, `SELECT w.trip_id, w.seats, w.status, w.created_at, w.booking_id, t.departs_at, c.name AS center_name,
        (SELECT count(*) FROM trip_waitlist x WHERE x.trip_id = w.trip_id AND x.status = 'waiting' AND x.created_at <= w.created_at) AS position
      FROM trip_waitlist w JOIN trips t ON t.id = w.trip_id JOIN centers c ON c.id = t.center_id
      WHERE w.diver_id = ? AND w.status IN ('waiting', 'offered') AND t.departs_at > ? ORDER BY t.departs_at`, ctx.diverId, nowIso())
  },

  // ── Chat de la salida ──
  async trip_messages(ctx, { p_trip, p_after = null }) {
    mfa(ctx)
    await tripAccess(ctx, p_trip)
    return all(ctx.db, `SELECT id, author, is_staff, body, created_at, user_id = ? AS mine FROM trip_messages WHERE trip_id = ? ${p_after ? 'AND created_at > ?' : ''}
      ORDER BY created_at DESC LIMIT 100`, ctx.uid, p_trip, ...(p_after ? [p_after] : [])).then((r) => r.reverse().map((m) => ({ ...m, is_staff: !!m.is_staff, mine: !!m.mine })))
  },
  async post_trip_message(ctx, { p_trip, p_body }) {
    mfa(ctx)
    const body = String(p_body || '').trim()
    if (!body || body.length > 500) fail('BAD_MESSAGE', 'escribe un mensaje de hasta 500 caracteres')
    const { t, staff } = await tripAccess(ctx, p_trip)
    await rateLimit(ctx.env, 'chat:' + ctx.uid, 20, 600)
    const c = await first(ctx.db, 'SELECT name FROM centers WHERE id = ?', t.center_id)
    const d = ctx.diverId && await first(ctx.db, 'SELECT full_name FROM divers WHERE id = ?', ctx.diverId)
    const author = staff ? c?.name || 'Centro' : shortName(d?.full_name)
    const id = uuid()
    await run(ctx.db, 'INSERT INTO trip_messages (id, trip_id, user_id, author, is_staff, body) VALUES (?, ?, ?, ?, ?, ?)', id, t.id, ctx.uid, author, staff ? 1 : 0, body)
    // Aviso: lo que escribe el centro, a los buceadores; lo que escribe un buceador, al centro (no a los demás)
    const payload = { title: author + ' · ' + (c?.name || 'DivingSlot'), body: body.slice(0, 140), url: '/salida/' + t.id + '?chat=1', tag: 'chat-' + t.id }
    if (staff) {
      const divers = await all(ctx.db, `SELECT DISTINCT b.diver_id FROM bookings b WHERE b.trip_id = ? AND b.diver_id IS NOT NULL AND (b.status = 'confirmed' OR ${HOLDS('b')})`, t.id)
      later(ctx, Promise.all(divers.map((x) => notifyDiver(ctx.env, x.diver_id, payload))))
    } else later(ctx, notifyCentreStaff(ctx.env, t.center_id, payload))
    return { id }
  },

  // ── Reseñas del centro ──
  async submit_review(ctx, { p_booking, p_rating, p_body = '' }) {
    mfa(ctx)
    const r = +p_rating
    if (!Number.isInteger(r) || r < 1 || r > 5) fail('BAD_RATING', 'puntúa de 1 a 5')
    const b = await first(ctx.db, `SELECT b.id, b.diver_id, b.status, t.departs_at, t.center_id, d.full_name FROM bookings b JOIN trips t ON t.id = b.trip_id
      JOIN divers d ON d.id = b.diver_id WHERE b.id = ?`, p_booking)
    if (!b || b.diver_id !== ctx.diverId) fail('NOT_FOUND')
    if (b.status !== 'confirmed' || Date.parse(b.departs_at) > Date.now()) fail('BAD_STATE', 'podrás valorar el centro después de la salida')
    const body = String(p_body || '').trim().slice(0, 600) || null
    await run(ctx.db, `INSERT INTO center_reviews (id, booking_id, center_id, diver_id, author, rating, body) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(booking_id) DO UPDATE SET rating = excluded.rating, body = excluded.body`, uuid(), b.id, b.center_id, ctx.diverId, shortName(b.full_name), r, body)
    return { ok: true }
  },
  async center_reviews(ctx, { p_center, p_limit = 20 }) {
    const rows = await all(ctx.db, `SELECT id, author, rating, body, reply, replied_at, created_at FROM center_reviews WHERE center_id = ?
      ORDER BY created_at DESC LIMIT ?`, p_center, Math.min(+p_limit || 20, 50))
    const s = await first(ctx.db, 'SELECT round(avg(rating), 1) AS avg, count(*) AS n FROM center_reviews WHERE center_id = ?', p_center)
    return { avg: s?.avg ?? null, count: s?.n || 0, reviews: rows }
  },
  async my_reviews(ctx) {
    if (!ctx.diverId) return []
    return all(ctx.db, 'SELECT booking_id, rating, body FROM center_reviews WHERE diver_id = ?', ctx.diverId)
  },
  async reply_review(ctx, { p_review, p_reply }) {
    mfa(ctx)
    const rv = await first(ctx.db, 'SELECT id, center_id FROM center_reviews WHERE id = ?', p_review)
    if (!rv || !isStaff(ctx, rv.center_id)) fail('FORBIDDEN', null, 403)
    const reply = String(p_reply || '').trim().slice(0, 400) || null
    await run(ctx.db, 'UPDATE center_reviews SET reply = ?, replied_at = ? WHERE id = ?', reply, reply ? nowIso() : null, rv.id)
    return { ok: true }
  },

  // ── Bitácora firmada por el centro ──
  async sign_trip_logs(ctx, { p_trip }) {
    mfa(ctx)
    const t = await first(ctx.db, 'SELECT id, center_id, departs_at FROM trips WHERE id = ?', p_trip)
    if (!t || !isStaff(ctx, t.center_id)) fail('FORBIDDEN', null, 403)
    if (Date.parse(t.departs_at) > Date.now()) fail('BAD_STATE', 'se firma después de la salida')
    const day = new Date(Date.parse(t.departs_at) + 8 * 36e5).toISOString().slice(0, 10)
    const r = await run(ctx.db, `UPDATE dive_logs SET signed_by_center = ?, signed_at = ?
      WHERE signed_by_center IS NULL AND diver_id IN (SELECT diver_id FROM bookings WHERE trip_id = ? AND status = 'confirmed' AND checked_in_at IS NOT NULL AND diver_id IS NOT NULL)
        AND (booking_id IN (SELECT id FROM bookings WHERE trip_id = ?) OR dive_date = ?)`, t.center_id, nowIso(), t.id, t.id, day)
    const pending = await first(ctx.db, "SELECT count(*) AS n FROM bookings WHERE trip_id = ? AND status = 'confirmed' AND checked_in_at IS NOT NULL AND diver_id IS NOT NULL", t.id)
    return { signed: changes(r), divers: pending.n }
  },

  // ── Tarjeta de certificación: el centro de una salida reservada ve la foto que subió el buceador ──
  async cert_photo_url(ctx, { p_cert }) {
    mfa(ctx)
    const c = await first(ctx.db, 'SELECT ce.photo_path, ce.diver_id, d.user_id FROM certifications ce JOIN divers d ON d.id = ce.diver_id WHERE ce.id = ?', p_cert)
    if (!c?.photo_path) fail('NOT_FOUND', 'sin foto')
    const own = c.diver_id === ctx.diverId
    const staffOk = ctx.staff.length && await first(ctx.db, `SELECT 1 AS x FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.diver_id = ? AND t.center_id IN (${ctx.staff.map(() => '?').join(',')})`, c.diver_id, ...ctx.staff)
    if (!own && !staffOk && !ctx.isAdmin) fail('FORBIDDEN', null, 403)
    return { url: await signedObjectUrl(ctx.env, 'dive-photos', c.photo_path, 600) }
  },

  // ── Salidas repetidas: copia una salida (con sus puntos) a otras fechas a la misma hora ──
  async repeat_trip(ctx, { p_trip, p_dates }) {
    mfa(ctx)
    const t = await first(ctx.db, 'SELECT * FROM trips WHERE id = ?', p_trip)
    if (!t || !isStaff(ctx, t.center_id)) fail('FORBIDDEN', null, 403)
    const dates = [...new Set((Array.isArray(p_dates) ? p_dates : []).map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].slice(0, 90)
    if (!dates.length) fail('NO_DATES', 'elige al menos un día')
    const hhmm = new Date(Date.parse(t.departs_at) + 8 * 36e5).toISOString().slice(11, 16)
    const c = await first(ctx.db, 'SELECT verification_status FROM centers WHERE id = ?', t.center_id)
    const status = t.status === 'published' && c?.verification_status === 'verified' ? 'published' : 'draft'
    const sites = await all(ctx.db, 'SELECT site_id, position FROM trip_sites WHERE trip_id = ?', t.id)
    const cols = ['center_id', 'boat_id', 'num_dives', 'min_level', 'price_php', 'gear_rental_php', 'guides', 'divers_per_guide', 'seat_override', 'include_fees', 'fees_per_diver', 'early_pct', 'early_days', 'kind', 'course_name', 'course_days', 'course_prereq']
    const stmts = [], ids = []
    for (const d of dates) {
      const dep = new Date(Date.parse(d + 'T' + hhmm + ':00+08:00')).toISOString()
      if (Date.parse(dep) < Date.now()) continue
      const id = uuid(); ids.push(id)
      stmts.push(ctx.db.prepare(`INSERT INTO trips (id, departs_at, status, ${cols.join(', ')}) VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')})`).bind(id, dep, status, ...cols.map((k) => t[k] ?? null)))
      for (const s of sites) stmts.push(ctx.db.prepare('INSERT INTO trip_sites (trip_id, site_id, position) VALUES (?, ?, ?)').bind(id, s.site_id, s.position))
    }
    if (!ids.length) fail('NO_DATES', 'las fechas ya han pasado')
    for (let i = 0; i < stmts.length; i += 80) await ctx.db.batch(stmts.slice(i, i + 80))
    return { created: ids.length, status }
  },

  // ── Bonos: el que se aplicaría a una nueva salida del centro (para mostrarlo antes de reservar) ──
  async pack_preview(ctx, { p_trip }) {
    const t = await first(ctx.db, 'SELECT id, center_id, departs_at FROM trips WHERE id = ?', p_trip)
    if (!t) fail('NOT_FOUND')
    const packs = await all(ctx.db, 'SELECT id, name, trips, discount_pct, valid_days FROM center_packs WHERE center_id = ? AND active = 1 ORDER BY trips', t.center_id)
    let have = 0
    if (ctx.diverId) have = (await first(ctx.db, `SELECT count(*) AS n FROM bookings b JOIN trips x ON x.id = b.trip_id
      WHERE b.diver_id = ? AND x.center_id = ? AND x.id <> ? AND (b.status = 'confirmed' OR ${HOLDS('b')}) AND abs(julianday(x.departs_at) - julianday(?)) <= 90`, ctx.diverId, t.center_id, t.id, t.departs_at))?.n || 0
    return { packs, booked_here: have }
  },
}

// Descuento de bono para una salida: mejor bono activo cuyo mínimo se alcanza con las reservas del buceador en el centro
// dentro de la ventana del bono (contando la nueva)
export async function packDiscount(db, centerId, diverId, tripId, departsAt) {
  const packs = await all(db, 'SELECT trips, discount_pct, valid_days FROM center_packs WHERE center_id = ? AND active = 1', centerId)
  let best = 0
  for (const p of packs) {
    const n = (await first(db, `SELECT count(*) AS n FROM bookings b JOIN trips x ON x.id = b.trip_id
      WHERE b.diver_id = ? AND x.center_id = ? AND x.id <> ? AND (b.status = 'confirmed' OR ${HOLDS('b')}) AND abs(julianday(x.departs_at) - julianday(?)) <= ?`,
    diverId, centerId, tripId, departsAt, p.valid_days))?.n || 0
    if (n + 1 >= p.trips) best = Math.max(best, p.discount_pct)
  }
  return best
}
