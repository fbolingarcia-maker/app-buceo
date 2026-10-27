// Funciones de negocio (port de las funciones SECURITY DEFINER de Supabase), mismas reglas y mismos errores «CODIGO: mensaje».
// Concurrencia: D1 no tiene SELECT … FOR UPDATE. Cada comprobación de plazas + alta es UNA sentencia
// (INSERT … SELECT … WHERE plazas_libres >= pedidas), y los cobros van en un batch (transacción) con condiciones.
import { HOLDS, OPERATIVE, APP_AVAILABLE, CERT_LEVELS } from './schema.js'
import { fail, nowIso, uuid, all, first, run, changes, outRow } from './lib/util.js'
import { sendEmail, TEMPLATES } from './email.js'
import { centreEmail } from './stats.js'

export const RULES = { commission_per_diver_php: 250, hold_minutes: 15, min_lead_minutes: 60, full_refund_hours: 24 }

const config = async (db, key) => (await first(db, 'SELECT value FROM app_config WHERE key = ?', key))?.value ?? null
const booking = async (db, id) => outRow('bookings', await first(db, 'SELECT * FROM bookings WHERE id = ?', id))
const holdsSeat = (b, now = Date.now()) => b.status === 'confirmed' ||
  (b.status === 'pending_payment' && Math.max(Date.parse(b.created_at) + RULES.hold_minutes * 60000, b.hold_until ? Date.parse(b.hold_until) : -Infinity) > now)
const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const isStaff = (ctx, center) => ctx.staff.includes(center)
const tripCenter = async (db, trip) => (await first(db, 'SELECT center_id FROM trips WHERE id = ?', trip))?.center_id
const audit = (db, actor, action, target, detail) =>
  db.prepare('INSERT INTO admin_audit (actor, action, target, detail) VALUES (?, ?, ?, ?)').bind(actor, action, target, JSON.stringify(detail))

// Importe a cobrar según el tipo de pago (port de payment_amount)
function paymentAmount(b, kind) {
  if (kind === 'deposit') { if (b.status !== 'pending_payment') fail('BAD_STATE', 'la señal ya está pagada'); return Math.max(b.deposit_php - b.paid_php, 0) }
  if (kind === 'full') { if (b.status !== 'pending_payment') fail('BAD_STATE', 'usa «pagar el resto»'); return Math.max(b.amount_php - b.paid_php, 0) }
  if (kind === 'balance') { if (b.status !== 'confirmed') fail('BAD_STATE', 'la reserva no está confirmada'); return Math.max(b.amount_php - b.paid_php, 0) }
  fail('BAD_KIND', 'tipo de pago no válido')
}

// Sentencias que aplican un pago (port de settle_payment). Van en el mismo batch que el alta del pago si la hay.
// Solo actúan si el pago aún no estaba pagado: idempotente aunque llegue dos veces (webhook + vuelta a la app).
export function settleStatements(db, paymentId, bookingId, amount, now = nowIso()) {
  const live = "status NOT IN ('cancelled_by_diver', 'cancelled_by_center')"
  return [
    db.prepare(`UPDATE bookings SET
        paid_php = paid_php + ?1,
        refund_php = CASE WHEN ${live} THEN refund_php ELSE refund_php + ?1 END,
        status = CASE WHEN status = 'pending_payment' AND paid_php + ?1 >= deposit_php THEN 'confirmed' ELSE status END,
        paid_at = CASE WHEN ${live} THEN coalesce(paid_at, CASE WHEN paid_php + ?1 >= deposit_php THEN ?2 END) ELSE paid_at END,
        balance_paid_at = CASE WHEN ${live} AND paid_php + ?1 >= amount_php THEN ?2 ELSE balance_paid_at END
      WHERE id = ?3 AND EXISTS (SELECT 1 FROM payments WHERE id = ?4 AND status <> 'paid')`).bind(amount, now, bookingId, paymentId),
    db.prepare("UPDATE payments SET status = 'paid', paid_at = ?1 WHERE id = ?2 AND status <> 'paid'").bind(now, paymentId),
  ]
}
export async function settlePayment(db, paymentId) {
  const p = await first(db, 'SELECT * FROM payments WHERE id = ?', paymentId)
  if (!p) fail('NOT_FOUND')
  if (p.status !== 'paid') await db.batch(settleStatements(db, p.id, p.booking_id, p.amount_php))
  return booking(db, p.booking_id)
}
async function payNow(ctx, b, kind, method, provider, recordedBy = null) {
  const amt = paymentAmount(b, kind)
  if (amt <= 0) fail('BAD_STATE', 'no hay nada pendiente de pago')
  const pid = uuid()
  await ctx.db.batch([
    ctx.db.prepare('INSERT INTO payments (id, booking_id, kind, method, amount_php, provider, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(pid, b.id, kind, method, amt, provider, recordedBy),
    ...settleStatements(ctx.db, pid, b.id, amt),
  ])
  return booking(ctx.db, b.id)
}

// Pago online: valida y crea el pago pendiente (port de start_online_payment). Lo usa payments.js
export async function startOnlinePayment(ctx, bookingId, kind, method) {
  mfa(ctx)
  const b = await booking(ctx.db, bookingId)
  if (!b || !ctx.diverId || b.diver_id !== ctx.diverId) fail('NOT_FOUND', 'reserva no encontrada')
  if (!['card', 'gcash'].includes(method)) fail('BAD_METHOD', 'método de pago no válido')
  if (b.status === 'pending_payment' && !holdsSeat(b)) fail('HOLD_EXPIRED', 'la reserva ha caducado, vuelve a reservar')
  const amt = paymentAmount(b, kind)
  if (amt < 100) fail('BAD_AMOUNT', 'el importe mínimo para pagar online es ₱100')
  const pid = uuid()
  const stmts = [ctx.db.prepare('INSERT INTO payments (id, booking_id, kind, method, amount_php) VALUES (?, ?, ?, ?, ?)').bind(pid, b.id, kind, method, amt)]
  if (b.status === 'pending_payment') stmts.push(ctx.db.prepare('UPDATE bookings SET hold_until = ? WHERE id = ?').bind(new Date(Date.now() + 30 * 60000).toISOString(), b.id))
  await ctx.db.batch(stmts)
  return { id: pid, booking_id: b.id, amount_php: amt, kind, method }
}

// Valoraciones entre buddies: plazo de 14 días, media visible desde 3, cuentan si son mutuas o al cerrar el plazo
const BUDDY_DAYS = 14, BUDDY_MIN = 3
const BUDDY_KEYS = ['buoyancy', 'air', 'awareness', 'safety', 'reef']
const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * 864e5).toISOString()
const shortName = (n) => {
  const s = String(n || '').trim() || 'Buceador'
  const w = s.split(/\s+/)
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]
}
const onBoard = async (db, trip, diver) => !!(await first(db,
  "SELECT 1 AS x FROM bookings WHERE trip_id = ? AND diver_id = ? AND checked_in_at IS NOT NULL AND status = 'confirmed'", trip, diver))
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100)
async function buddyStats(db, diver) {
  const rows = await all(db, `SELECT r.*, (t.departs_at < ? OR EXISTS (SELECT 1 FROM buddy_ratings x WHERE x.trip_id = r.trip_id AND x.rater_id = r.rated_id AND x.rated_id = r.rater_id)) AS shown
    FROM buddy_ratings r JOIN trips t ON t.id = r.trip_id WHERE r.rated_id = ?`, addDays(nowIso(), -BUDDY_DAYS), diver)
  const shown = rows.filter((r) => r.shown)
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const scores = {}
  for (const k of BUDDY_KEYS) { const a = avg(shown.map((r) => r[k]).filter((v) => v != null)); if (a != null) scores[k] = r2(a) }
  const again = shown.filter((r) => r.dive_again != null)
  return {
    count: shown.length, raters: new Set(shown.map((r) => r.rater_id)).size,
    overall: r2(avg(shown.flatMap((r) => BUDDY_KEYS.map((k) => r[k]).filter((v) => v != null)))),
    scores, dive_again: again.length ? r2(avg(again.map((r) => (r.dive_again ? 1 : 0)))) : null,
    pending_reveal: rows.length - shown.length,
  }
}
async function buddyPublic(db, diver) {
  const s = await buddyStats(db, diver)
  if (s.count < BUDDY_MIN) return null
  return { count: s.count, score: s.overall, raters: s.raters, scores: s.scores, dive_again: s.dive_again }
}

const RPC = {
  async is_platform_admin(ctx) { return ctx.isAdmin },

  async center_private(ctx, { p_center }) {
    if (!(isStaff(ctx, p_center) || ctx.isAdmin)) fail('FORBIDDEN', 'no autorizado', 403)
    return all(ctx.db, 'SELECT gcash_number, review_note, notes FROM centers WHERE id = ?', p_center)
  },

  async center_ratings(ctx) {
    return (await all(ctx.db, `SELECT center_id, round(avg(rating), 1) AS rating, count(*) AS reviews FROM dive_logs
      WHERE share_with_center = 1 AND rating IS NOT NULL AND center_id IS NOT NULL GROUP BY center_id`))
  },

  // «¿Quién va?»: buceadores apuntados que se muestran (show_on_trips) y el resto como número
  async trip_divers(ctx, { p_trip }) {
    const live = await all(ctx.db, `SELECT b.diver_id, b.seats FROM bookings b JOIN trips t ON t.id = b.trip_id
      WHERE b.trip_id = ? AND t.status IN ('published', 'completed') AND ${HOLDS('b')}`, p_trip)
    const total = live.reduce((s, b) => s + b.seats, 0)
    if (!ctx.uid || !ctx.mfaOk) return { divers: [], others: total }
    const seatsBy = {}
    for (const b of live) if (b.diver_id) seatsBy[b.diver_id] = (seatsBy[b.diver_id] || 0) + b.seats
    const ids = Object.keys(seatsBy)
    if (!ids.length) return { divers: [], others: total }
    const ph = ids.map(() => '?').join(',')
    const rows = await all(ctx.db, `SELECT d.*,
        (SELECT c.level FROM certifications c WHERE c.diver_id = d.id ORDER BY CASE c.level ${CERT_LEVELS.map((l, i) => `WHEN '${l}' THEN ${i}`).join(' ')} END DESC, c.verified_at IS NULL LIMIT 1) AS best_level,
        EXISTS (SELECT 1 FROM certifications c WHERE c.diver_id = d.id AND c.verified_at IS NOT NULL) AS verified,
        coalesce(d.logged_dives, 0) + (SELECT count(*) FROM dive_logs g WHERE g.diver_id = d.id) AS dives,
        (SELECT g.site_name FROM dive_logs g WHERE g.diver_id = d.id AND g.site_name IS NOT NULL GROUP BY g.site_name ORDER BY count(*) DESC, max(g.dive_date) DESC LIMIT 1) AS fav_site
      FROM divers d WHERE d.id IN (${ph}) AND d.show_on_trips = 1`, ...ids)
    const short = (n) => {
      const s = String(n || '').trim() || 'Buceador'
      const w = s.split(/\s+/)
      return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]
    }
    const divers = rows.map((d) => ({
      is_me: d.id === ctx.diverId, name: short(d.full_name), level: d.best_level, verified: !!d.verified, dives: d.dives,
      languages: JSON.parse(d.languages || '[]'), country: d.country, bio: d.bio, seeks_buddy: !!d.seeks_buddy, fav_site: d.fav_site, seats: seatsBy[d.id],
      _id: d.id, _buddy: !!d.buddy_ratings_enabled,
    })).sort((a, b) => (b.is_me - a.is_me) || (b.dives - a.dives))
    for (const d of divers) { d.buddy = d._buddy ? await buddyPublic(ctx.db, d._id) : null; delete d._id; delete d._buddy }
    return { divers, others: total - divers.reduce((s, d) => s + d.seats, 0) }
  },

  async book_trip(ctx, { p_trip, p_seats, p_with_gear, p_medical_signed }) {
    mfa(ctx)
    if (!ctx.diverId) fail('NO_PROFILE', 'crea tu perfil de buceador')
    const seats = +p_seats
    if (!Number.isInteger(seats) || seats < 1 || seats > 20) fail('BAD_SEATS', 'número de plazas no válido')
    const t = await first(ctx.db, 'SELECT * FROM trips WHERE id = ?', p_trip)
    if (!t || t.status !== 'published') fail('NOT_BOOKABLE', 'la salida no está abierta')
    if (Date.parse(t.departs_at) - Date.now() < RULES.min_lead_minutes * 60000) fail('TOO_LATE', 'ya no se puede reservar por la app')
    if (!p_medical_signed) fail('NO_MEDICAL', 'falta la declaración médica')
    const levels = (await all(ctx.db, 'SELECT level FROM certifications WHERE diver_id = ?', ctx.diverId)).map((c) => CERT_LEVELS.indexOf(c.level))
    if (!levels.length || Math.max(...levels) < CERT_LEVELS.indexOf(t.min_level)) fail('LEVEL', 'tu certificación no alcanza el mínimo')
    const gear = p_with_gear ? 1 : 0
    const pct = +((await config(ctx.db, 'deposit_pct')) || 50)
    const id = uuid(), now = nowIso()
    // Alta atómica: solo entra si la salida sigue publicada, el centro verificado, quedan plazas y no hay reserva duplicada
    const r = await run(ctx.db, `INSERT INTO bookings (id, trip_id, diver_id, seats, with_gear, source, status, amount_php, commission_php, medical_signed, deposit_php, created_at)
      SELECT ?1, t.id, ?2, ?3, ?4, 'app', 'pending_payment', ?3 * t.price_php + ?4 * ?3 * t.gear_rental_php, ?3 * ?5, 1,
             CAST(((?3 * t.price_php + ?4 * ?3 * t.gear_rental_php) * ?6 + 99) / 100 AS INTEGER), ?7
      FROM trips t JOIN centers c ON c.id = t.center_id
      WHERE t.id = ?8 AND t.status = 'published' AND c.verification_status = 'verified'
        AND t.departs_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+${RULES.min_lead_minutes} minutes')
        AND ${APP_AVAILABLE('t')} >= ?3
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id AND b.diver_id = ?2 AND ${HOLDS('b')})`,
    id, ctx.diverId, seats, gear, RULES.commission_per_diver_php, pct, now, t.id)
    if (!changes(r)) {
      const dup = await first(ctx.db, `SELECT 1 AS x FROM bookings b WHERE b.trip_id = ? AND b.diver_id = ? AND ${HOLDS('b')}`, t.id, ctx.diverId)
      if (dup) fail('DUPLICATE', 'ya tienes una reserva en esta salida')
      const v = await first(ctx.db, "SELECT 1 AS x FROM centers WHERE id = ? AND verification_status = 'verified'", t.center_id)
      if (!v) fail('NOT_VERIFIED', 'este centro no acepta reservas en este momento')
      const free = (await first(ctx.db, `SELECT ${APP_AVAILABLE('t')} AS n FROM trips t WHERE t.id = ?`, t.id))?.n ?? 0
      fail('NO_SEATS', `solo quedan ${free} plazas`)
    }
    // Aviso al equipo del centro (como el trigger notify_booking de Supabase, migración 031)
    const p = notifyCentreBooking(ctx, t, seats, id).catch((e) => console.error('aviso reserva', e.message))
    if (ctx.waitUntil) ctx.waitUntil(p)
    return booking(ctx.db, id)
  },

  async cancel_my_booking(ctx, { p_booking }) {
    mfa(ctx)
    const b = await booking(ctx.db, p_booking)
    if (!b || !ctx.diverId || b.diver_id !== ctx.diverId) fail('NOT_FOUND')
    if (!['pending_payment', 'confirmed'].includes(b.status)) fail('BAD_STATE', 'la reserva ya no está activa')
    const t = await first(ctx.db, 'SELECT departs_at FROM trips WHERE id = ?', b.trip_id)
    if (Date.parse(t.departs_at) <= Date.now()) fail('STARTED', 'la salida ya ha empezado')
    const full = b.status === 'pending_payment' || Date.parse(t.departs_at) - Date.now() >= RULES.full_refund_hours * 36e5
    // round(amount × 0,5) = (amount + 1) / 2 en enteros
    const r = await run(ctx.db, `UPDATE bookings SET status = 'cancelled_by_diver',
        refund_php = CASE WHEN ?1 THEN paid_php ELSE max(0, paid_php - (amount_php + 1) / 2) END,
        commission_php = CASE WHEN ?1 THEN 0 ELSE commission_php END, cancelled_at = ?2
      WHERE id = ?3 AND status = ?4`, full ? 1 : 0, nowIso(), b.id, b.status)
    if (!changes(r)) fail('BAD_STATE', 'la reserva ha cambiado, vuelve a intentarlo')
    return booking(ctx.db, b.id)
  },

  async confirm_payment_demo(ctx, { p_booking, p_kind }) {
    mfa(ctx)
    if (!p_kind) fail('OUTDATED', 'actualiza la app para pagar')
    if ((await config(ctx.db, 'payments_mode')) !== 'demo') fail('FORBIDDEN', 'el modo demo está desactivado', 403)
    const b = await booking(ctx.db, p_booking)
    if (!b || !ctx.diverId || b.diver_id !== ctx.diverId) fail('NOT_FOUND')
    if (b.status === 'pending_payment' && !holdsSeat(b)) fail('HOLD_EXPIRED', 'la reserva ha caducado')
    return payNow(ctx, b, p_kind, 'demo', 'demo')
  },

  async add_manual_booking(ctx, { p_trip, p_guest, p_seats, p_with_gear, p_source }) {
    mfa(ctx)
    const t = await first(ctx.db, 'SELECT * FROM trips WHERE id = ?', p_trip)
    if (!t) fail('NOT_FOUND')
    if (!isStaff(ctx, t.center_id)) fail('FORBIDDEN', null, 403)
    if (!['whatsapp', 'instagram', 'facebook', 'walk_in'].includes(p_source)) fail('BAD_SOURCE')
    const guest = String(p_guest || '').trim()
    if (!guest) fail('NO_NAME', 'indica el nombre')
    const seats = +p_seats
    if (!Number.isInteger(seats) || seats < 1 || seats > 20) fail('BAD_SEATS')
    const gear = p_with_gear ? 1 : 0
    const id = uuid()
    const used = `(SELECT coalesce(sum(b.seats), 0) FROM bookings b WHERE b.trip_id = t.id AND ${HOLDS('b')})`
    const r = await run(ctx.db, `INSERT INTO bookings (id, trip_id, guest_name, seats, with_gear, source, status, amount_php, created_at)
      SELECT ?1, t.id, ?2, ?3, ?4, ?5, 'confirmed', ?3 * t.price_php + ?4 * ?3 * t.gear_rental_php, ?6
      FROM trips t WHERE t.id = ?7 AND ${used} + ?3 <= ${OPERATIVE('t')}`, id, guest.slice(0, 120), seats, gear, p_source, nowIso(), t.id)
    if (!changes(r)) {
      const left = (await first(ctx.db, `SELECT ${OPERATIVE('t')} - ${used} AS n FROM trips t WHERE t.id = ?`, t.id))?.n ?? 0
      fail('NO_SEATS', `solo quedan ${left} plazas en el barco`)
    }
    return booking(ctx.db, id)
  },

  async record_cash_payment(ctx, { p_booking, p_amount = null }) {
    mfa(ctx)
    const b = await booking(ctx.db, p_booking)
    if (!b || !isStaff(ctx, await tripCenter(ctx.db, b.trip_id))) fail('FORBIDDEN', null, 403)
    if (!['pending_payment', 'confirmed'].includes(b.status)) fail('BAD_STATE', 'la reserva no está activa')
    const due = b.amount_php - b.paid_php
    const amt = p_amount === null || p_amount === undefined ? due : +p_amount
    if (!Number.isInteger(amt) || amt <= 0 || amt > due) fail('BAD_AMOUNT', 'importe no válido')
    const pid = uuid()
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO payments (id, booking_id, kind, method, amount_php, provider, recorded_by) VALUES (?, ?, ?, 'cash', ?, 'cash', ?)")
        .bind(pid, b.id, b.status === 'confirmed' ? 'balance' : 'full', amt, ctx.uid),
      ...settleStatements(ctx.db, pid, b.id, amt),
    ])
    return booking(ctx.db, b.id)
  },

  async set_checkin(ctx, { p_booking, p_in }) {
    mfa(ctx)
    const b = await booking(ctx.db, p_booking)
    if (!b || !isStaff(ctx, await tripCenter(ctx.db, b.trip_id))) fail('FORBIDDEN', null, 403)
    if (!['pending_payment', 'confirmed'].includes(b.status)) fail('BAD_STATE', 'la reserva no está activa')
    await run(ctx.db, 'UPDATE bookings SET checked_in_at = ? WHERE id = ?', p_in ? nowIso() : null, b.id)
    return booking(ctx.db, b.id)
  },

  async cancel_trip_weather(ctx, { p_trip }) {
    mfa(ctx)
    const t = await first(ctx.db, 'SELECT * FROM trips WHERE id = ?', p_trip)
    if (!t) fail('NOT_FOUND')
    if (!isStaff(ctx, t.center_id)) fail('FORBIDDEN', null, 403)
    if (t.status !== 'published') fail('BAD_STATE')
    const now = nowIso()
    const [upd] = await ctx.db.batch([
      ctx.db.prepare("UPDATE trips SET status = 'cancelled_weather' WHERE id = ? AND status = 'published'").bind(t.id),
      ctx.db.prepare(`UPDATE bookings SET status = 'cancelled_by_center', refund_php = paid_php, commission_php = 0, cancelled_at = ?
        WHERE trip_id = ? AND status IN ('pending_payment', 'confirmed') AND EXISTS (SELECT 1 FROM trips WHERE id = ? AND status = 'cancelled_weather')`).bind(now, t.id, t.id),
    ])
    if (!changes(upd)) fail('BAD_STATE')
    return (await first(ctx.db, "SELECT count(*) AS n FROM bookings WHERE trip_id = ? AND status = 'cancelled_by_center'", t.id)).n
  },

  async verify_certification(ctx, { p_cert, p_center }) {
    mfa(ctx)
    if (!isStaff(ctx, p_center)) fail('FORBIDDEN', null, 403)
    const ok = await first(ctx.db, `SELECT 1 AS x FROM certifications ce JOIN bookings b ON b.diver_id = ce.diver_id JOIN trips t ON t.id = b.trip_id
      WHERE ce.id = ? AND t.center_id = ?`, p_cert, p_center)
    if (!ok) fail('FORBIDDEN', 'ese buceador no tiene reservas con tu centro', 403)
    await run(ctx.db, 'UPDATE certifications SET verified_by = ?, verified_at = ? WHERE id = ?', p_center, nowIso(), p_cert)
    return outRow('certifications', await first(ctx.db, 'SELECT * FROM certifications WHERE id = ?', p_cert))
  },

  async register_center(ctx, { p_name, p_phone }) {
    mfa(ctx)
    if (!ctx.uid) fail('FORBIDDEN', 'inicia sesión', 401)
    const name = String(p_name || '').trim()
    if (!name) fail('NO_NAME', 'indica el nombre del centro')
    if (await first(ctx.db, 'SELECT 1 AS x FROM center_staff WHERE user_id = ?', ctx.uid)) fail('BAD_STATE', 'ya gestionas un centro')
    if (await first(ctx.db, "SELECT 1 AS x FROM centers WHERE lower(name) = lower(?) AND listing_status NOT IN ('directorio', 'cerrado')", name)) {
      fail('BAD_STATE', 'ya hay una cuenta para ese centro. Si eres el responsable, escríbenos y lo revisamos')
    }
    const l = await first(ctx.db, "SELECT * FROM centers WHERE lower(name) = lower(?) AND listing_status = 'directorio' AND name NOT LIKE 'Demo ·%' LIMIT 1", name)
    const id = uuid()
    const phone = String(p_phone || '').trim() || l?.phone || null
    await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO centers (id, name, phone, listing_status, verification_status, claims_center_id, area, locality, destination, province, lat, lng, location_precision, website, languages)
        VALUES (?, ?, ?, 'socio', 'unverified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, l?.name || name.slice(0, 120), phone, l?.id || null,
        l?.area || 'Panglao', l?.locality || null, l?.destination || null, l?.province || null, l?.lat ?? null, l?.lng ?? null, l?.location_precision || 'zona', l?.website || null, l?.languages || '[]'),
      ctx.db.prepare("INSERT INTO center_staff (center_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, ctx.uid),
      ctx.db.prepare("UPDATE divers SET account_type = 'center' WHERE user_id = ?").bind(ctx.uid),
    ])
    return publicCenter(ctx.db, id)
  },

  async submit_center_verification(ctx) {
    mfa(ctx)
    const c = await first(ctx.db, 'SELECT ce.* FROM centers ce JOIN center_staff s ON s.center_id = ce.id WHERE s.user_id = ? LIMIT 1', ctx.uid)
    if (!c) fail('FORBIDDEN', 'no gestionas ningún centro', 403)
    if (c.verification_status === 'verified') fail('BAD_STATE', 'tu centro ya está verificado')
    if (c.verification_status === 'suspended') fail('BAD_STATE', 'tu centro está suspendido. Escríbenos para revisarlo')
    const v = await first(ctx.db, 'SELECT * FROM center_verifications WHERE center_id = ?', c.id)
    const blank = (x) => !String(x ?? '').trim()
    if (!v || blank(v.legal_name) || blank(v.owner_name) || blank(v.contact_phone) || blank(v.contact_email) || blank(v.address) ||
      (blank(v.business_reg_number) && blank(v.mayors_permit_number))) fail('MISSING_DATA', 'completa los datos obligatorios del formulario')
    if (!(await first(ctx.db, "SELECT 1 AS x FROM center_documents WHERE center_id = ? AND kind = 'owner_id'", c.id))) fail('MISSING_DOCS', 'sube el documento de identidad del responsable')
    if (!(await first(ctx.db, "SELECT 1 AS x FROM center_documents WHERE center_id = ? AND kind IN ('business_permit', 'dti_sec')", c.id))) fail('MISSING_DOCS', "sube el permiso de negocio (Mayor's permit) o el registro DTI/SEC")
    const now = nowIso()
    await ctx.db.batch([
      ctx.db.prepare('UPDATE center_verifications SET submitted_at = ?, updated_at = ? WHERE center_id = ?').bind(now, now, c.id),
      ctx.db.prepare("UPDATE centers SET verification_status = 'pending', review_note = NULL WHERE id = ?").bind(c.id),
      ...(c.verification_status !== 'pending' ? [audit(ctx.db, ctx.uid, 'center_status', c.id, { name: c.name, from: c.verification_status, to: 'pending', note: null })] : []),
    ])
    return publicCenter(ctx.db, c.id)
  },

  async review_center(ctx, { p_center, p_decision, p_note = null }) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'solo administradores', 403)
    if (!['verified', 'rejected', 'suspended', 'pending'].includes(p_decision)) fail('BAD_DECISION', 'decisión no válida')
    const note = String(p_note ?? '').trim() || null
    if (['rejected', 'suspended'].includes(p_decision) && !note) fail('NO_NOTE', 'explica el motivo al centro')
    const c = await first(ctx.db, 'SELECT * FROM centers WHERE id = ?', p_center)
    if (!c) fail('NOT_FOUND', 'centro no encontrado')
    const now = nowIso()
    const stmts = [
      ctx.db.prepare(`UPDATE centers SET verification_status = ?1, review_note = ?2,
          verified_at = CASE WHEN ?1 = 'verified' THEN ?3 ELSE verified_at END,
          listing_status = CASE WHEN ?1 = 'verified' THEN 'socio' ELSE listing_status END WHERE id = ?4`).bind(p_decision, note, now, c.id),
      ctx.db.prepare('UPDATE center_verifications SET reviewed_at = ?, reviewed_by = ? WHERE center_id = ?').bind(now, ctx.uid, c.id),
    ]
    if (p_decision === 'verified' && c.claims_center_id) {
      stmts.push(ctx.db.prepare('UPDATE centers SET source_url = coalesce(source_url, (SELECT o.source_url FROM centers o WHERE o.id = ?)) WHERE id = ?').bind(c.claims_center_id, c.id))
      stmts.push(ctx.db.prepare("UPDATE centers SET listing_status = 'cerrado' WHERE id = ? AND listing_status = 'directorio'").bind(c.claims_center_id))
    }
    if (p_decision === 'suspended') {
      stmts.push(ctx.db.prepare(`UPDATE trips SET status = 'draft' WHERE center_id = ? AND status = 'published' AND departs_at > ?
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = trips.id AND b.status IN ('confirmed', 'pending_payment'))`).bind(c.id, now))
    }
    if (c.verification_status !== p_decision) stmts.push(audit(ctx.db, ctx.uid, 'center_status', c.id, { name: c.name, from: c.verification_status, to: p_decision, note }))
    await ctx.db.batch(stmts)
    // Aviso por email al responsable del centro (si falla, la revisión queda hecha igualmente)
    if (['verified', 'rejected', 'suspended'].includes(p_decision)) {
      const owner = await first(ctx.db, "SELECT u.email FROM center_staff s JOIN users u ON u.id = s.user_id WHERE s.center_id = ? ORDER BY s.role = 'owner' DESC LIMIT 1", c.id)
      if (owner?.email) {
        const p = sendEmail(ctx.env, owner.email, TEMPLATES.centerReviewed(c.name, p_decision, note, ctx.origin + '/app/#/centro')).catch((e) => console.error('email review', e.message))
        ctx.waitUntil ? ctx.waitUntil(p) : await p
      }
    }
    return publicCenter(ctx.db, c.id)
  },

  async admin_list(ctx) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'no autorizado', 403)
    return (await all(ctx.db, 'SELECT pa.user_id, u.email, pa.created_at, pa.user_id = ? AS is_me FROM platform_admins pa JOIN users u ON u.id = pa.user_id ORDER BY pa.created_at', ctx.uid))
      .map((r) => ({ ...r, is_me: !!r.is_me }))
  },
  async admin_grant(ctx, { p_email }) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'no autorizado', 403)
    const u = await first(ctx.db, 'SELECT id, email FROM users WHERE email = ?', String(p_email || '').trim().toLowerCase())
    if (!u) fail('NOT_FOUND', 'no hay ninguna cuenta con ese email. Regístrala primero en la app.')
    const r = await run(ctx.db, 'INSERT OR IGNORE INTO platform_admins (user_id) VALUES (?)', u.id)
    const stmts = [ctx.db.prepare('UPDATE divers SET show_on_trips = 0 WHERE user_id = ?').bind(u.id)]
    if (changes(r)) stmts.push(audit(ctx.db, ctx.uid, 'admin_grant', u.id, { email: u.email }))
    await ctx.db.batch(stmts)
    return null
  },
  async admin_revoke(ctx, { p_user }) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'no autorizado', 403)
    const u = await first(ctx.db, 'SELECT email FROM users WHERE id = ?', p_user)
    const r = await run(ctx.db, 'DELETE FROM platform_admins WHERE user_id = ? AND (SELECT count(*) FROM platform_admins) > 1', p_user)
    if (!changes(r)) {
      if ((await first(ctx.db, 'SELECT count(*) AS n FROM platform_admins')).n <= 1) fail('LAST_ADMIN', 'tiene que quedar al menos un administrador')
      return null
    }
    await audit(ctx.db, ctx.uid, 'admin_revoke', p_user, { email: u?.email || null }).run()
    return null
  },

  async admin_users(ctx) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'no autorizado', 403)
    const rows = await all(ctx.db, `SELECT d.id AS diver_id, d.user_id, d.full_name, coalesce(u.email, d.email) AS email, d.account_type, d.country, d.languages,
        d.logged_dives, d.bio, d.seeks_buddy, d.show_on_trips, u.created_at AS signed_up_at, u.last_sign_in_at, u.email_confirmed_at IS NOT NULL AS email_confirmed, d.auth_provider,
        (SELECT json_group_array(json_object('agency', c.agency, 'level', c.level, 'verified', json(CASE WHEN c.verified_at IS NOT NULL THEN 'true' ELSE 'false' END))) FROM certifications c WHERE c.diver_id = d.id) AS certifications,
        (SELECT count(*) FROM bookings b WHERE b.diver_id = d.id) AS bookings_total,
        (SELECT count(*) FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.diver_id = d.id AND t.departs_at > ?1 AND b.status IN ('confirmed', 'pending_payment')) AS bookings_upcoming,
        (SELECT json_group_array(json_object('id', ce.id, 'name', ce.name, 'role', s.role, 'status', ce.verification_status)) FROM center_staff s JOIN centers ce ON ce.id = s.center_id WHERE s.user_id = d.user_id) AS centers,
        EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = d.user_id) AS is_admin
      FROM divers d LEFT JOIN users u ON u.id = d.user_id WHERE d.user_id IS NOT NULL ORDER BY u.created_at IS NULL, u.created_at DESC`, nowIso())
    const order = (l) => CERT_LEVELS.indexOf(l)
    return rows.map((r) => ({ ...r, languages: JSON.parse(r.languages || '[]'), seeks_buddy: !!r.seeks_buddy, show_on_trips: !!r.show_on_trips,
      email_confirmed: !!r.email_confirmed, is_admin: !!r.is_admin, certifications: JSON.parse(r.certifications || '[]').sort((a, b) => order(a.level) - order(b.level)),
      centers: JSON.parse(r.centers || '[]') }))
  },

  async admin_dashboard(ctx, { p_days = 30, p_demo = false }) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'no autorizado', 403)
    const { adminDashboard } = await import('./dashboard.js')
    return adminDashboard(ctx.db, p_days, p_demo)
  },

  // Valoraciones entre buddies (migración 032)
  async buddy_rating_targets(ctx, { p_trip }) {
    mfa(ctx)
    if (!ctx.diverId) fail('FORBIDDEN', 'inicia sesión para valorar', 401)
    const t = await first(ctx.db, 'SELECT t.departs_at, c.name AS center_name FROM trips t JOIN centers c ON c.id = t.center_id WHERE t.id = ?', p_trip)
    if (!t) fail('NOT_FOUND', 'no encontramos esta salida', 404)
    if (!(await onBoard(ctx.db, p_trip, ctx.diverId))) fail('FORBIDDEN', 'solo puedes valorar a compañeros de salidas en las que hiciste check-in', 403)
    const closes = addDays(t.departs_at, BUDDY_DAYS), now = nowIso()
    const open = new Date(t.departs_at) <= new Date(now) && new Date(now) <= new Date(closes)
    const rows = open ? await all(ctx.db, `SELECT d.id, d.full_name,
        (SELECT c.level FROM certifications c WHERE c.diver_id = d.id ORDER BY CASE c.level ${CERT_LEVELS.map((l, i) => `WHEN '${l}' THEN ${i}`).join(' ')} END DESC LIMIT 1) AS level,
        coalesce(d.logged_dives, 0) + (SELECT count(*) FROM dive_logs g WHERE g.diver_id = d.id) AS dives,
        EXISTS (SELECT 1 FROM buddy_ratings r WHERE r.trip_id = ? AND r.rater_id = ? AND r.rated_id = d.id) AS rated
      FROM divers d WHERE d.id <> ? AND d.user_id IS NOT NULL AND d.buddy_ratings_enabled = 1
        AND d.id IN (SELECT b.diver_id FROM bookings b WHERE b.trip_id = ? AND b.checked_in_at IS NOT NULL AND b.status = 'confirmed')`,
      p_trip, ctx.diverId, ctx.diverId, p_trip) : []
    const divers = rows.map((d) => ({ diver_id: d.id, name: shortName(d.full_name), level: d.level, dives: d.dives, rated: !!d.rated }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { trip_id: p_trip, departs_at: t.departs_at, center_name: t.center_name, closes_at: closes, divers }
  },

  async rate_buddy(ctx, { p_trip, p_diver, p_scores, p_dive_again = null }) {
    mfa(ctx)
    if (!ctx.diverId) fail('FORBIDDEN', 'inicia sesión para valorar', 401)
    if (p_diver === ctx.diverId) fail('FORBIDDEN', 'no puedes valorarte a ti mismo', 403)
    const t = await first(ctx.db, 'SELECT departs_at FROM trips WHERE id = ?', p_trip)
    if (!t) fail('NOT_FOUND', 'no encontramos esta salida', 404)
    const now = new Date()
    if (now < new Date(t.departs_at)) fail('TOO_EARLY', 'podrás valorar cuando haya salido el barco')
    if (now > new Date(addDays(t.departs_at, BUDDY_DAYS))) fail('CLOSED', 'el plazo para valorar esta salida terminó')
    if (!(await onBoard(ctx.db, p_trip, ctx.diverId)) || !(await onBoard(ctx.db, p_trip, p_diver))) fail('FORBIDDEN', 'solo puedes valorar a quien estuvo a bordo contigo', 403)
    if (!(await first(ctx.db, 'SELECT 1 AS x FROM divers WHERE id = ? AND buddy_ratings_enabled = 1 AND user_id IS NOT NULL', p_diver))) fail('FORBIDDEN', 'este buceador no tiene activadas las valoraciones', 403)
    const s = p_scores && typeof p_scores === 'object' ? p_scores : {}
    for (const [k, v] of Object.entries(s)) {
      if (!BUDDY_KEYS.includes(k)) fail('INVALID', 'criterio desconocido')
      if (!Number.isInteger(Number(v)) || v === null || v === '' || Number(v) < 1 || Number(v) > 5) fail('INVALID', 'las notas van del 1 al 5')
    }
    if (!Object.keys(s).length) fail('INVALID', 'puntúa al menos un criterio')
    const r = await run(ctx.db, `INSERT INTO buddy_ratings (id, trip_id, rater_id, rated_id, buoyancy, air, awareness, safety, reef, dive_again)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (trip_id, rater_id, rated_id) DO NOTHING`,
      uuid(), p_trip, ctx.diverId, p_diver, ...BUDDY_KEYS.map((k) => (s[k] == null ? null : Number(s[k]))),
      p_dive_again == null ? null : (p_dive_again ? 1 : 0))
    if (!changes(r)) fail('ALREADY_RATED', 'ya valoraste a este buddy en esta salida')
    return null
  },

  async my_buddy_summary(ctx) {
    mfa(ctx)
    if (!ctx.diverId) return { count: 0 }
    const s = await buddyStats(ctx.db, ctx.diverId)
    return s.count < BUDDY_MIN ? { count: s.count, pending_reveal: s.pending_reveal } : s
  },

  async my_pending_buddy_ratings(ctx) {
    if (!ctx.diverId || !ctx.mfaOk) return []
    const now = nowIso(), from = addDays(now, -BUDDY_DAYS)
    const rows = await all(ctx.db, `SELECT t.id AS trip_id, t.departs_at, c.name AS center_name,
        (SELECT count(DISTINCT d.id) FROM bookings b2 JOIN divers d ON d.id = b2.diver_id
          WHERE b2.trip_id = t.id AND b2.checked_in_at IS NOT NULL AND b2.status = 'confirmed' AND d.id <> ? AND d.user_id IS NOT NULL
            AND d.buddy_ratings_enabled = 1
            AND NOT EXISTS (SELECT 1 FROM buddy_ratings r WHERE r.trip_id = t.id AND r.rater_id = ? AND r.rated_id = d.id)) AS pending
      FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id
      WHERE b.diver_id = ? AND b.checked_in_at IS NOT NULL AND b.status = 'confirmed' AND t.departs_at <= ? AND t.departs_at >= ?
      ORDER BY t.departs_at DESC`, ctx.diverId, ctx.diverId, ctx.diverId, now, from)
    return rows.filter((r) => r.pending > 0).map((r) => ({ ...r, closes_at: addDays(r.departs_at, BUDDY_DAYS) }))
  },

  async delete_my_account(ctx, { p_dry_run = true }) {
    mfa(ctx)
    if (!ctx.uid) fail('FORBIDDEN', 'inicia sesión para eliminar tu cuenta', 401)
    const db = ctx.db, now = nowIso()
    const d = await first(db, 'SELECT * FROM divers WHERE user_id = ?', ctx.uid)
    const owned = (await all(db, "SELECT center_id FROM center_staff WHERE user_id = ? AND role = 'owner'", ctx.uid)).map((r) => r.center_id)
    const active = "(b.status = 'confirmed' OR (b.status = 'pending_payment' AND coalesce(b.hold_until, ?) > ?))"
    const blockers = []
    if (d) {
      const n = (await first(db, `SELECT count(*) AS n FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.diver_id = ? AND t.departs_at > ? AND ${active}`, d.id, now, now, now)).n
      if (n > 0) blockers.push(`Tienes ${n} reserva(s) futura(s). Cancélalas antes de eliminar la cuenta.`)
    }
    const ph = owned.map(() => '?').join(',')
    if (owned.length) {
      const n = (await first(db, `SELECT count(*) AS n FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE t.center_id IN (${ph}) AND t.departs_at > ? AND ${active}`, ...owned, now, now, now)).n
      if (n > 0) blockers.push(`Tu centro tiene ${n} reserva(s) en salidas futuras. Cancélalas o avisa a los buceadores antes de eliminar la cuenta.`)
    }
    if (p_dry_run || blockers.length) {
      return {
        ok: blockers.length === 0, blockers, centers: owned,
        dive_logs: d ? (await first(db, 'SELECT count(*) AS n FROM dive_logs WHERE diver_id = ?', d.id)).n : 0,
        bookings_kept: d ? (await first(db, 'SELECT count(*) AS n FROM bookings WHERE diver_id = ?', d.id)).n : 0,
      }
    }
    const s = []
    if (owned.length) {
      const names = await all(db, `SELECT id, name, verification_status FROM centers WHERE id IN (${ph})`, ...owned)
      s.push(db.prepare(`UPDATE trips SET status = 'draft' WHERE center_id IN (${ph}) AND status = 'published' AND departs_at > ?`).bind(...owned, now))
      s.push(db.prepare(`UPDATE centers SET listing_status = 'cerrado', verification_status = 'suspended', review_note = 'Cuenta eliminada por el centro', phone = NULL, gcash_number = NULL WHERE id IN (${ph})`).bind(...owned))
      for (const c of names) if (c.verification_status !== 'suspended') s.push(audit(db, ctx.uid, 'center_status', c.id, { name: c.name, from: c.verification_status, to: 'suspended', note: 'Cuenta eliminada por el centro' }))
      s.push(db.prepare(`DELETE FROM center_documents WHERE center_id IN (${ph})`).bind(...owned))
      s.push(db.prepare(`DELETE FROM center_verifications WHERE center_id IN (${ph})`).bind(...owned))
      s.push(db.prepare(`DELETE FROM center_staff WHERE center_id IN (${ph})`).bind(...owned))
    }
    s.push(db.prepare('DELETE FROM center_staff WHERE user_id = ?').bind(ctx.uid))
    if (d) {
      s.push(db.prepare('DELETE FROM dive_logs WHERE diver_id = ?').bind(d.id))
      s.push(db.prepare('DELETE FROM certifications WHERE diver_id = ?').bind(d.id))
      if (await first(db, 'SELECT 1 AS x FROM bookings WHERE diver_id = ?', d.id)) {
        s.push(db.prepare(`UPDATE divers SET user_id = NULL, full_name = 'Cuenta eliminada', email = NULL, avatar_url = NULL, bio = NULL, country = NULL,
          languages = '[]', logged_dives = NULL, seeks_buddy = 0, show_on_trips = 0, buddy_ratings_enabled = 0, wetsuit_size = NULL, bcd_size = NULL,
          fin_size = NULL, last_dive_date = NULL, nitrox = 0, medical_done_at = NULL, medical_result = NULL WHERE id = ?`).bind(d.id))
        s.push(db.prepare('DELETE FROM buddy_ratings WHERE rated_id = ?').bind(d.id))
      } else s.push(db.prepare('DELETE FROM divers WHERE id = ?').bind(d.id))
    }
    const wasAdmin = await first(db, 'SELECT 1 AS x FROM platform_admins WHERE user_id = ?', ctx.uid)
    if (wasAdmin) s.push(audit(db, ctx.uid, 'admin_revoke', ctx.uid, { email: ctx.email }))
    s.push(db.prepare('DELETE FROM platform_admins WHERE user_id = ?').bind(ctx.uid))
    s.push(db.prepare('DELETE FROM users WHERE id = ?').bind(ctx.uid)) // sesiones, tokens y factores en cascada
    await db.batch(s)
    return { ok: true, deleted: true }
  },
}

async function notifyCentreBooking(ctx, t, seats, id) {
  const c = await first(ctx.db, 'SELECT name FROM centers WHERE id = ?', t.center_id)
  if (!c || c.name.startsWith('Demo')) return
  const b = await first(ctx.db, 'SELECT amount_php FROM bookings WHERE id = ?', id)
  const who = await first(ctx.db, 'SELECT full_name FROM divers WHERE id = ?', ctx.diverId)
  const staff = await all(ctx.db, 'SELECT u.email FROM center_staff s JOIN users u ON u.id = s.user_id WHERE s.center_id = ? AND u.email IS NOT NULL ORDER BY s.role DESC LIMIT 3', t.center_id)
  const local = new Date(Date.parse(t.departs_at) + 8 * 36e5).toISOString()
  const title = `Nueva reserva: ${seats} ${seats === 1 ? 'plaza' : 'plazas'} en ${c.name}`
  const lines = [`Salida: ${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`, `Buceador: ${who?.full_name || '—'}`,
    `Importe: ₱${(b?.amount_php || 0).toLocaleString('en-US')}`, 'Origen: app']
  const link = `${ctx.origin || 'https://divingslot.com'}/app/#/centro/agenda?dia=${local.slice(0, 10)}`
  for (const s of staff) await sendEmail(ctx.env, s.email, centreEmail(title, lines, link)).catch((e) => console.error('aviso centro', e.message))
}

const CENTER_PUBLIC = 'id, name, area, phone, default_divers_per_guide, created_at, locality, website, source_url, lat, lng, location_precision, listing_status, destination, province, languages, course_languages, verification_status, claims_center_id, verified_at, agencies, agency_detail, directory_check, checked_at'
const publicCenter = async (db, id) => outRow('centers', await first(db, `SELECT ${CENTER_PUBLIC} FROM centers WHERE id = ?`, id))

export async function handleRpc(ctx, name, args) {
  const f = Object.hasOwn(RPC, name) ? RPC[name] : null
  if (!f) fail('NOT_FOUND', 'función desconocida', 404)
  return f(ctx, args || {})
}
