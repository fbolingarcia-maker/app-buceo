// Salida cancelada por el centro (23 nov 2026): en lugar de devolver el dinero sin más, el buceador elige
// entre pasar lo pagado a otra salida del mismo centro o el reembolso. Tiene 7 días; si no elige, reembolso automático.
// Decisiones de Fernando (23 nov): plazo de 7 días, la diferencia de precio se paga o se devuelve, motivos «mar» u «otro imprevisto».
//
// Estado en bookings (solo reservas de la app con algo pagado):
//   refund_choice = 'pending'   → esperando a que elija (choice_until = fin del plazo); refund_php = 0 de momento
//                   'rebooking' → reservando la salida nueva (lo pone rebook_booking mientras crea la reserva)
//                   'rebooked'  → pasó moved_php a la reserva rebooked_to; refund_php = la diferencia a su favor
//                   'refund'    → reembolso de todo lo pagado (lo eligió o venció el plazo)
// La reserva nueva lleva rebooked_from y empieza con paid_php = lo pasado (sin fila en payments: ese dinero ya se cobró).
import { APP_AVAILABLE, FEES, LAST_MINUTE, EARLY } from './schema.js'
import { fail, nowIso, all, first, run, changes, outRow } from './lib/util.js'
import { sendEmail } from './email.js'
import { notifyLater, notifyAdmin } from './stats.js'
import { notifyDiver, notifyCentreStaff } from './push.js'

export const CHOICE_DAYS = 7
export const CANCEL_REASONS = ['weather', 'other']
const REBOOK_DAYS = 90 // se puede elegir una salida de los próximos 90 días
const MIN_LEAD_MIN = 60

const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const booking = async (db, id) => outRow('bookings', await first(db, 'SELECT * FROM bookings WHERE id = ?', id))
const plusDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString()
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-US')
const manila = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Manila', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Sentencias que cancelan las reservas activas de una salida que el centro ya ha marcado como cancelada.
// Las de la app con algo pagado quedan esperando la elección del buceador; el resto (sin pagar o manuales) se cierran como antes.
export function centreCancelStatements(db, tripId, now = nowIso()) {
  const cancelled = "EXISTS (SELECT 1 FROM trips WHERE id = ?3 AND status = 'cancelled_weather')"
  return [
    db.prepare(`UPDATE bookings SET status = 'cancelled_by_center', refund_php = 0, commission_php = 0, commission_vat_php = 0, commission_paid_php = 0, cancelled_at = ?1,
        refund_choice = 'pending', choice_until = ?2
      WHERE trip_id = ?3 AND status IN ('pending_payment', 'confirmed') AND source = 'app' AND diver_id IS NOT NULL AND paid_php > 0 AND ${cancelled}`)
      .bind(now, plusDays(now, CHOICE_DAYS), tripId),
    db.prepare(`UPDATE bookings SET status = 'cancelled_by_center', refund_php = paid_php, commission_php = 0, commission_vat_php = 0, commission_paid_php = 0, cancelled_at = ?1
      WHERE trip_id = ?3 AND status IN ('pending_payment', 'confirmed') AND ${cancelled}`).bind(now, null, tripId),
  ]
}

// Avisos a los buceadores de una salida recién cancelada: push a todos y email a quien tiene que elegir
export async function notifyCancelled(env, tripId, origin = 'https://divingslot.com') {
  const t = await first(env.DB, 'SELECT t.departs_at, t.cancel_reason, t.cancel_note, c.name AS center FROM trips t JOIN centers c ON c.id = t.center_id WHERE t.id = ?', tripId)
  if (!t) return 0
  const rows = await all(env.DB, `SELECT b.id, b.diver_id, b.paid_php, b.refund_choice, b.choice_until, u.email, d.locale
    FROM bookings b JOIN divers d ON d.id = b.diver_id JOIN users u ON u.id = d.user_id
    WHERE b.trip_id = ? AND b.status = 'cancelled_by_center' AND b.diver_id IS NOT NULL`, tripId)
  const weather = t.cancel_reason !== 'other'
  for (const r of rows) {
    const choose = r.refund_choice === 'pending'
    await notifyDiver(env, r.diver_id, {
      title: 'Salida cancelada · Trip cancelled',
      body: choose
        ? (weather ? 'El centro ha cancelado por el estado del mar. ' : 'El centro ha cancelado por un imprevisto. ') + 'Elige otro día o el reembolso. · ' + (weather ? 'Cancelled due to sea conditions. ' : 'Cancelled by the centre. ') + 'Pick another day or a refund.'
        : (weather ? 'El centro ha cancelado la salida por el estado del mar. · Cancelled due to sea conditions.' : 'El centro ha cancelado la salida. · The centre cancelled the trip.'),
      url: '/reservas', urgent: true, tag: 'cancel-' + r.id,
    }).catch(() => {})
    if (choose && r.email) {
      await sendEmail(env, r.email, cancelledEmail(t.center, t.departs_at, t.cancel_reason, t.cancel_note, r.paid_php, r.choice_until, origin + '/app/#/reservas?elegir=' + r.id, r.locale))
        .catch((e) => console.error('aviso cancelación', e.message))
    }
  }
  return rows.length
}

// Email «Tu salida se ha cancelado: elige otro día o el reembolso» (español o inglés; el resto de idiomas, inglés)
export function cancelledEmail(center, departs, reason, note, paid, until, url, lang) {
  const l = String(lang || '').toLowerCase().startsWith('es') ? 'es' : 'en'
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const loc = l === 'es' ? 'es-ES' : 'en-GB'
  const when = (iso, opt) => new Date(iso).toLocaleString(loc, { timeZone: 'Asia/Manila', ...opt })
  const dep = when(departs, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  const end = when(until, { day: 'numeric', month: 'long' })
  const why = reason === 'other'
    ? (l === 'es' ? 'por un imprevisto' : 'due to an unforeseen problem')
    : (l === 'es' ? 'por el estado del mar' : 'due to sea conditions')
  const T = {
    es: { s: `Salida cancelada: elige otro día o el reembolso`, b: `${esc(center)} ha cancelado la salida del ${esc(dep)} ${why}.`,
      c: `Tienes <b>${peso(paid)}</b> pagados. Puedes pasarlos a otra salida del mismo centro o pedir el reembolso.`,
      n: 'Nota del centro', btn: 'Elegir otro día o el reembolso', f: `Tienes hasta el ${esc(end)} para elegir. Si no eliges, te devolvemos todo lo pagado.` },
    en: { s: `Trip cancelled: pick another day or a refund`, b: `${esc(center)} has cancelled the trip on ${esc(dep)} ${why}.`,
      c: `You have paid <b>${peso(paid)}</b>. You can move it to another trip with the same centre or ask for a refund.`,
      n: 'Note from the centre', btn: 'Choose another day or a refund', f: `You have until ${esc(end)} to choose. If you don't, we refund everything you paid.` },
  }[l]
  const noteHtml = note ? `<p style="background:#f3f6f8;padding:10px 12px;border-radius:8px"><b>${T.n}:</b> ${esc(note)}</p>` : ''
  return {
    subject: T.s,
    html: `<div lang="${l}" style="font-family:-apple-system,Segoe UI,Roboto,'Noto Sans',sans-serif;max-width:520px"><h2>DivingSlot</h2><p>${T.b}</p>${noteHtml}<p>${T.c}</p>`
      + `<p><a href="${esc(url)}" style="background:#0b5e8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">${T.btn}</a></p>`
      + `<p style="color:#5d7282;font-size:13px">${T.f}</p></div>`,
  }
}

// Reserva cancelada por el centro, del propio buceador, con la elección aún abierta
async function openChoice(ctx, id) {
  mfa(ctx)
  const b = await booking(ctx.db, id)
  if (!b || !ctx.diverId || b.diver_id !== ctx.diverId) fail('NOT_FOUND', 'reserva no encontrada')
  if (b.status !== 'cancelled_by_center' || b.refund_choice !== 'pending') fail('BAD_STATE', 'esta reserva ya no tiene nada que elegir')
  if (!b.choice_until || Date.parse(b.choice_until) <= Date.now()) fail('EXPIRED', 'el plazo para elegir ha terminado: se te devuelve todo lo pagado')
  return b
}

export const REBOOK = {
  // Salidas del mismo centro a las que se puede pasar la reserva, con el importe estimado y la diferencia
  async rebook_options(ctx, { p_booking }) {
    const b = await openChoice(ctx, p_booking)
    const old = await first(ctx.db, 'SELECT center_id FROM trips WHERE id = ?', b.trip_id)
    const now = Date.now()
    const rows = await all(ctx.db, `SELECT t.id, t.departs_at, t.price_php, t.gear_rental_php, t.num_dives, t.kind, t.course_name, t.activity,
        ${APP_AVAILABLE('t')} AS free, ${FEES('t')} AS fees_seat,
        max(CASE WHEN ${LAST_MINUTE('t')} THEN t.last_minute_pct ELSE 0 END, CASE WHEN ${EARLY('t')} THEN t.early_pct ELSE 0 END) AS pct
      FROM trips t JOIN centers c ON c.id = t.center_id
      WHERE t.center_id = ?1 AND t.status = 'published' AND c.verification_status = 'verified' AND t.id <> ?2
        AND t.departs_at > ?3 AND t.departs_at < ?4 AND ${APP_AVAILABLE('t')} >= ?5
        AND NOT EXISTS (SELECT 1 FROM bookings x WHERE x.trip_id = t.id AND x.diver_id = ?6 AND x.status IN ('pending_payment', 'confirmed'))
      ORDER BY t.departs_at LIMIT 40`,
    old.center_id, b.trip_id, new Date(now + MIN_LEAD_MIN * 60000).toISOString(), new Date(now + REBOOK_DAYS * 864e5).toISOString(), b.seats, ctx.diverId)
    const trips = rows.map((t) => {
      const unit = Math.floor((t.price_php * (100 - t.pct)) / 100)
      const amount = b.seats * unit + (b.with_gear ? b.seats * t.gear_rental_php : 0) + b.seats * t.fees_seat
      return { id: t.id, departs_at: t.departs_at, num_dives: t.num_dives, kind: t.kind, course_name: t.course_name, activity: t.activity,
        free: t.free, amount_php: amount, difference_php: amount - b.paid_php }
    })
    return { credit_php: b.paid_php, seats: b.seats, with_gear: !!b.with_gear, choice_until: b.choice_until, trips }
  },

  // Pasa lo pagado a otra salida del mismo centro. Si la nueva cuesta más, queda el resto por pagar; si cuesta menos, se devuelve la diferencia
  async rebook_booking(ctx, { p_booking, p_trip, p_extras = [] }) {
    const b = await openChoice(ctx, p_booking)
    const old = await first(ctx.db, 'SELECT center_id FROM trips WHERE id = ?', b.trip_id)
    const nt = await first(ctx.db, 'SELECT center_id FROM trips WHERE id = ?', p_trip)
    if (!nt || nt.center_id !== old.center_id) fail('OTHER_CENTER', 'elige una salida del mismo centro')
    if (p_trip === b.trip_id) fail('SAME_TRIP', 'elige otra salida')
    // Se reserva la elección para que dos pulsaciones no creen dos reservas
    const claim = await run(ctx.db, "UPDATE bookings SET refund_choice = 'rebooking' WHERE id = ? AND refund_choice = 'pending' AND choice_until > ?", b.id, nowIso())
    if (!changes(claim)) fail('BAD_STATE', 'esta reserva ya no tiene nada que elegir')
    const { RPC } = await import('./rpc.js')
    let nb
    try {
      // La declaración médica ya acompañaba a la reserva cancelada (como «¿Buceas más días?» en Salida)
      nb = await RPC.book_trip(ctx, { p_trip, p_seats: b.seats, p_with_gear: !!b.with_gear, p_medical_signed: true, p_extras })
    } catch (e) {
      await run(ctx.db, "UPDATE bookings SET refund_choice = 'pending' WHERE id = ? AND refund_choice = 'rebooking'", b.id)
      throw e
    }
    const moved = Math.min(b.paid_php, nb.amount_php)
    const back = b.paid_php - moved
    const now = nowIso()
    await ctx.db.batch([
      ctx.db.prepare(`UPDATE bookings SET paid_php = ?1, rebooked_from = ?2,
          status = CASE WHEN ?1 >= deposit_php THEN 'confirmed' ELSE status END,
          paid_at = CASE WHEN ?1 >= deposit_php THEN ?3 ELSE paid_at END,
          balance_paid_at = CASE WHEN ?1 >= amount_php THEN ?3 ELSE balance_paid_at END,
          hold_until = CASE WHEN ?1 >= deposit_php THEN hold_until ELSE ?4 END,
          commission_paid_php = min(commission_php + commission_vat_php, ?1)
        WHERE id = ?5 AND status = 'pending_payment'`).bind(moved, b.id, now, new Date(Date.now() + 30 * 60000).toISOString(), nb.id),
      ctx.db.prepare(`UPDATE bookings SET refund_choice = 'rebooked', rebooked_to = ?1, moved_php = ?2, refund_php = ?3
        WHERE id = ?4 AND refund_choice = 'rebooking'`).bind(nb.id, moved, back, b.id),
    ])
    const tr = await first(ctx.db, 'SELECT t.departs_at, c.name FROM trips t JOIN centers c ON c.id = t.center_id WHERE t.id = ?', p_trip)
    const p = Promise.all([
      notifyCentreStaff(ctx.env, old.center_id, { title: 'Cambio de fecha · Rebooked', body: `${b.seats} ${b.seats === 1 ? 'plaza' : 'plazas'} → ${manila(tr.departs_at)}`, url: '/centro/agenda', tag: 'rebook-' + nb.id }),
      back > 0 ? notifyAdmin(ctx.env, { kind: 'reembolso', title: 'Reembolso pendiente: ' + peso(back),
        lines: [`${tr.name}: el buceador pasó su reserva a otra salida más barata.`, `Reserva ${b.id.slice(0, 8)} → ${nb.id.slice(0, 8)}.`, 'Devuelve la diferencia desde PayMongo.'] }) : null,
    ]).catch((e) => console.error('aviso cambio de fecha', e.message))
    if (ctx.waitUntil) ctx.waitUntil(p)
    const fresh = await booking(ctx.db, nb.id)
    return { booking: fresh, moved_php: moved, refund_php: back, due_php: Math.max(0, fresh.amount_php - fresh.paid_php) }
  },

  // Prefiere el reembolso de todo lo pagado
  async choose_refund(ctx, { p_booking }) {
    const b = await openChoice(ctx, p_booking)
    const r = await run(ctx.db, "UPDATE bookings SET refund_choice = 'refund', refund_php = paid_php WHERE id = ? AND refund_choice = 'pending'", b.id)
    if (!changes(r)) fail('BAD_STATE', 'esta reserva ya no tiene nada que elegir')
    const c = await first(ctx.db, 'SELECT c.name FROM trips t JOIN centers c ON c.id = t.center_id WHERE t.id = ?', b.trip_id)
    notifyLater(ctx, ctx.waitUntil, { kind: 'reembolso', title: 'Reembolso pendiente: ' + peso(b.paid_php),
      lines: [`${c?.name || 'Centro'} canceló la salida y el buceador eligió el reembolso.`, `Reserva ${b.id.slice(0, 8)}.`, 'Devuelve lo pagado desde PayMongo.'] })
    return booking(ctx.db, b.id)
  },
}

// Cron (cada hora): plazo vencido sin elegir → reembolso de todo lo pagado y aviso al administrador para devolverlo
export async function expireRebookChoices(env) {
  const rows = await all(env.DB, `SELECT b.id, b.paid_php, b.diver_id, c.name FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id
    WHERE b.refund_choice = 'pending' AND b.choice_until <= ? LIMIT 50`, nowIso())
  let n = 0
  for (const r of rows) {
    const u = await env.DB.prepare("UPDATE bookings SET refund_choice = 'refund', refund_php = paid_php WHERE id = ? AND refund_choice = 'pending'").bind(r.id).run()
    if (!u?.meta?.changes) continue
    n++
    await notifyAdmin(env, { kind: 'reembolso', title: 'Reembolso pendiente: ' + peso(r.paid_php),
      lines: [`${r.name} canceló la salida y el buceador no eligió otro día en ${CHOICE_DAYS} días.`, `Reserva ${r.id.slice(0, 8)}.`, 'Devuelve lo pagado desde PayMongo.'] }).catch(() => {})
    await notifyDiver(env, r.diver_id, { title: 'Reembolso · Refund', body: `Te devolvemos ${peso(r.paid_php)} de la salida cancelada. · We are refunding ${peso(r.paid_php)} for the cancelled trip.`, url: '/reservas' }).catch(() => {})
  }
  return n
}
