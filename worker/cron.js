// Tarea programada (Cron Trigger, cada hora): limpieza. Las retenciones de plaza de 15 min no necesitan cron:
// se calculan al leer (holds_seat), igual que en Supabase.
import { nowIso, all } from './lib/util.js'
import { sendEmail, TEMPLATES } from './email.js'
import { notifyAdmin } from './stats.js'
import { checkImportLock } from './import.js'

export async function cleanup(env) {
  const now = nowIso()
  const old = new Date(Date.now() - 7 * 864e5).toISOString()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(old),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Math.floor(Date.now() / 1000) - 86400),
    env.DB.prepare("DELETE FROM mfa_factors WHERE status = 'unverified' AND created_at < ?").bind(old),
    // Pagos online abandonados (la página de PayMongo caduca): pasan a «expired» a las 24 h
    env.DB.prepare("UPDATE payments SET status = 'expired' WHERE status = 'pending' AND provider = 'paymongo' AND created_at < ?").bind(new Date(Date.now() - 864e5).toISOString()),
  ])
  await checkImportLock(env).catch((e) => console.error('import lock', e.message))
}

// Cada hora: recordatorio del resto 24 h antes (enlace de pago, o aviso de llevarlo en efectivo si lo eligió así).
// Ventana de 20 a 28 h para no perder ninguna aunque falle una ejecución; balance_reminded_at evita repetirlo.
export async function balanceReminders(env, origin = 'https://divingslot.com') {
  const now = Date.now()
  const rows = await all(env.DB, `SELECT b.id, b.amount_php - b.paid_php AS due, b.pay_on_site, t.departs_at, c.name AS center, u.email
    FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id JOIN divers d ON d.id = b.diver_id JOIN users u ON u.id = d.user_id
    WHERE b.status = 'confirmed' AND b.source = 'app' AND b.paid_php < b.amount_php AND b.balance_reminded_at IS NULL
      AND t.status = 'published' AND t.departs_at BETWEEN ? AND ? AND u.email IS NOT NULL LIMIT 50`,
  new Date(now + 20 * 36e5).toISOString(), new Date(now + 28 * 36e5).toISOString())
  let sent = 0
  for (const r of rows) {
    // Se marca antes de enviar: mejor un recordatorio perdido que dos
    const u = await env.DB.prepare('UPDATE bookings SET balance_reminded_at = ? WHERE id = ? AND balance_reminded_at IS NULL').bind(nowIso(), r.id).run()
    if (!u?.meta?.changes) continue
    await sendEmail(env, r.email, TEMPLATES.balanceDue(r.center, r.departs_at, r.due, origin + '/app/#/reservas', !!r.pay_on_site)).then(() => sent++).catch((e) => console.error('recordatorio', e.message))
  }
  return sent
}

// Reserva sin señal completa cuya retención caducó pero con algo pagado (p. ej. un pago online que llegó tarde):
// se cancela con reembolso de lo pagado y se avisa al administrador para devolverlo.
export async function expireUnpaidWithMoney(env) {
  const rows = await all(env.DB, `SELECT b.id, b.paid_php FROM bookings b WHERE b.status = 'pending_payment' AND b.paid_php > 0
    AND max(strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at, '+15 minutes'), coalesce(b.hold_until, '')) < ? LIMIT 50`, nowIso())
  for (const r of rows) {
    const u = await env.DB.prepare(`UPDATE bookings SET status = 'cancelled_by_diver', refund_php = paid_php, commission_php = 0, cancelled_at = ?
      WHERE id = ? AND status = 'pending_payment'`).bind(nowIso(), r.id).run()
    if (u?.meta?.changes) await notifyAdmin(env, { kind: 'reembolso', title: 'Reembolso pendiente: ₱' + r.paid_php.toLocaleString('en-US'),
      lines: ['Reserva ' + r.id.slice(0, 8) + ' caducó sin completar la señal.', 'Devuelve lo pagado desde PayMongo.'] }).catch(() => {})
  }
  return rows.length
}
