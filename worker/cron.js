// Tarea programada (Cron Trigger, cada hora): limpieza. Las retenciones de plaza de 15 min no necesitan cron:
// se calculan al leer (holds_seat), igual que en Supabase.
import { nowIso, all, first } from './lib/util.js'
import { tripSea } from './sea.js'
import { notifyDiver } from './push.js'
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

// Cada hora: recordatorio del día antes para toda reserva confirmada por la app (hora, lugar, contacto, estado del mar
// y, si queda algo por pagar, el enlace de pago o el aviso de llevarlo en efectivo). Ventana de 20 a 28 h para no perder
// ninguna aunque falle una ejecución; balance_reminded_at evita repetirlo.
export async function balanceReminders(env, origin = 'https://divingslot.com') {
  const now = Date.now()
  const today = new Date(now + 8 * 36e5).toISOString().slice(0, 10)
  const rows = await all(env.DB, `SELECT b.id, b.trip_id, b.diver_id, b.seats, b.amount_php - b.paid_php AS due, b.pay_on_site, t.departs_at, t.num_dives,
      CASE WHEN bo.show_to_divers = 1 THEN bo.name END AS boat, c.name AS center, c.phone, c.locality, c.destination, c.lat, c.lng,
      CASE WHEN d.insurance_provider IS NOT NULL AND (d.insurance_expiry IS NULL OR d.insurance_expiry >= ?3) THEN 1 ELSE 0 END AS insured, u.email, d.locale
    FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id LEFT JOIN boats bo ON bo.id = t.boat_id
      JOIN divers d ON d.id = b.diver_id JOIN users u ON u.id = d.user_id
    WHERE b.status = 'confirmed' AND b.source = 'app' AND b.balance_reminded_at IS NULL
      AND t.status = 'published' AND t.departs_at BETWEEN ?1 AND ?2 AND u.email IS NOT NULL LIMIT 50`,
  new Date(now + 20 * 36e5).toISOString(), new Date(now + 28 * 36e5).toISOString(), today)
  let sent = 0
  const seaCache = {}
  for (const r of rows) {
    // Se marca antes de enviar: mejor un recordatorio perdido que dos
    const u = await env.DB.prepare('UPDATE bookings SET balance_reminded_at = ? WHERE id = ? AND balance_reminded_at IS NULL').bind(nowIso(), r.id).run()
    if (!u?.meta?.changes) continue
    // El estado del mar es orientativo: si Open-Meteo falla, el email sale sin él
    seaCache[r.trip_id] ??= await tripSea(env, r.trip_id).then((x) => x?.forecast || null).catch(() => null)
    await sendEmail(env, r.email, TEMPLATES.tripTomorrow({ ...r, sea: seaCache[r.trip_id] }, origin + '/app/#/reservas', origin + '/app/#/perfil?ver=buceo', r.locale))
      .then(() => sent++).catch((e) => console.error('recordatorio', e.message))
    await notifyDiver(env, r.diver_id, { title: 'Mañana buceas · Diving tomorrow', body: `${r.center} · ${new Date(r.departs_at).toLocaleString('en-GB', { timeZone: 'Asia/Manila', weekday: 'short', hour: '2-digit', minute: '2-digit' })}${r.sea?.level === 'rough' ? ' · mar movido / rough sea' : ''}`, url: '/reservas', tag: 'tomorrow-' + r.id }).catch(() => 0)
  }
  return sent
}

// Tipos de cambio para mostrar precios aproximados a los extranjeros (el cobro siempre es en pesos). Una vez al día.
export async function updateFx(env, now = Date.now()) {
  const cur = await first(env.DB, "SELECT value FROM app_config WHERE key = 'fx'")
  const at = cur?.value ? JSON.parse(cur.value).at : null
  if (at && now - Date.parse(at) < 20 * 36e5) return false
  const r = await fetch('https://open.er-api.com/v6/latest/PHP')
  if (!r.ok) throw new Error('fx ' + r.status)
  const j = await r.json()
  const pick = ['USD', 'EUR', 'GBP', 'AUD', 'KRW', 'JPY', 'CNY', 'SGD']
  const rates = Object.fromEntries(pick.filter((k) => j?.rates?.[k]).map((k) => [k, j.rates[k]]))
  if (!rates.USD) throw new Error('fx sin datos')
  await env.DB.prepare("INSERT INTO app_config (key, value) VALUES ('fx', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ rates, at: new Date(now).toISOString(), source: 'open.er-api.com' })).run()
  return true
}

// Una vez al día (a las 9:xx de Manila): aviso de que el seguro de buceo caduca en 14 días o menos, una vez por fecha
export async function insuranceReminders(env, origin = 'https://divingslot.com', now = Date.now()) {
  const manila = new Date(now + 8 * 36e5)
  if (manila.getUTCHours() !== 9) return 0
  const today = manila.toISOString().slice(0, 10)
  const limit = new Date(manila.getTime() + 14 * 864e5).toISOString().slice(0, 10)
  const rows = await all(env.DB, `SELECT d.id, d.insurance_provider, d.insurance_expiry, d.locale, u.email FROM divers d JOIN users u ON u.id = d.user_id
    WHERE d.insurance_provider IS NOT NULL AND d.insurance_expiry BETWEEN ? AND ? AND d.insurance_reminded_for IS NOT d.insurance_expiry
      AND u.email IS NOT NULL LIMIT 40`, today, limit)
  let sent = 0
  for (const r of rows) {
    const u = await env.DB.prepare('UPDATE divers SET insurance_reminded_for = insurance_expiry WHERE id = ? AND insurance_reminded_for IS NOT insurance_expiry').bind(r.id).run()
    if (!u?.meta?.changes) continue
    const dan = (await first(env.DB, "SELECT value FROM app_config WHERE key = 'dan_url'"))?.value || 'https://world.dan.org/membership-coverage/asia-pacific/'
    await sendEmail(env, r.email, TEMPLATES.insuranceExpiring(r.insurance_provider, r.insurance_expiry, dan, origin + '/app/#/perfil?ver=buceo', r.locale))
      .then(() => sent++).catch((e) => console.error('aviso seguro', e.message))
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
