// Cuadro de mando de la plataforma (port de admin_dashboard(p_days, p_demo)). Fechas por día en hora de Manila.
import { APP_AVAILABLE, BOOKED } from './schema.js'
import { all, first } from './lib/util.js'

export async function adminDashboard(db, pDays = 30, pDemo = false) {
  const d = Math.max(1, Math.min(+pDays || 30, 366))
  const now = new Date()
  const iso = (ms) => new Date(ms).toISOString()
  const since = iso(now.getTime() - d * 864e5), until = iso(now.getTime() + d * 864e5), nowS = now.toISOString()
  const today = new Date(now.getTime() + 8 * 36e5).toISOString().slice(0, 10)
  const days = Array.from({ length: d }, (_, i) => new Date(Date.parse(today) - (d - 1 - i) * 864e5).toISOString().slice(0, 10))
  const demo = pDemo ? '1' : "c.name NOT LIKE 'Demo%'"
  const CTE = `WITH ctr AS (SELECT * FROM centers c WHERE ${demo}),
    trp AS (SELECT t.* FROM trips t JOIN ctr ON ctr.id = t.center_id),
    bk AS (SELECT b.*, t.center_id, t.departs_at FROM bookings b JOIN trp t ON t.id = b.trip_id),
    pay AS (SELECT p.* FROM payments p JOIN bk ON bk.id = p.booking_id),
    usr AS (SELECT u.id, u.created_at, u.last_sign_in_at, u.email_confirmed_at, dv.account_type, dv.country FROM users u LEFT JOIN divers dv ON dv.user_id = u.id)`
  const one = async (sql, ...p) => Object.values((await first(db, `${CTE} ${sql}`, ...p)) || { n: 0 })[0] ?? 0
  const rows = (sql, ...p) => all(db, `${CTE} ${sql}`, ...p)
  const obj = (list, k, v = 'n') => Object.fromEntries(list.map((r) => [r[k], r[v]]))
  const manila = (col) => `date(${col}, '+8 hours')`
  const perDay = async (sql, ...p) => { const m = obj(await rows(sql, ...p), 'day'); return days.map((day) => m[day] || 0) }

  const signups = await perDay(`SELECT ${manila('created_at')} AS day, count(*) AS n FROM usr GROUP BY 1`)
  const bkN = await perDay(`SELECT ${manila('created_at')} AS day, count(*) AS n FROM bk WHERE status IN ('confirmed', 'pending_payment') GROUP BY 1`)
  const bkPhp = await perDay(`SELECT ${manila('created_at')} AS day, coalesce(sum(amount_php), 0) AS n FROM bk WHERE status = 'confirmed' GROUP BY 1`)
  const up = await rows(`SELECT ${BOOKED('t')} AS booked, ${APP_AVAILABLE('t')} AS free FROM trp t WHERE t.status = 'published' AND t.departs_at > ? AND t.departs_at <= ?`, nowS, until)

  return {
    days: d,
    generated_at: nowS,
    users: {
      total: await one('SELECT count(*) FROM usr'),
      divers: await one("SELECT count(*) FROM usr WHERE coalesce(account_type, 'diver') = 'diver'"),
      center_accounts: await one("SELECT count(*) FROM usr WHERE account_type = 'center'"),
      new: await one('SELECT count(*) FROM usr WHERE created_at >= ?', since),
      active: await one('SELECT count(*) FROM usr WHERE last_sign_in_at >= ?', since),
      unconfirmed: await one('SELECT count(*) FROM usr WHERE email_confirmed_at IS NULL'),
      countries: await rows("SELECT coalesce(nullif(country, ''), '—') AS country, count(*) AS n FROM usr GROUP BY 1 ORDER BY 2 DESC LIMIT 6"),
      signups: days.map((day, i) => ({ day, n: signups[i] })),
    },
    centers: {
      by_status: obj(await rows("SELECT verification_status AS k, count(*) AS n FROM ctr WHERE listing_status <> 'directorio' GROUP BY 1"), 'k'),
      directory: await one("SELECT count(*) FROM ctr WHERE listing_status = 'directorio'"),
      claims_pending: await one("SELECT count(*) FROM ctr WHERE claims_center_id IS NOT NULL AND verification_status = 'pending'"),
      new: await one("SELECT count(*) FROM ctr WHERE listing_status <> 'directorio' AND created_at >= ?", since),
      top: await rows(`SELECT c.id, c.name, c.destination,
          sum(b.status IN ('confirmed', 'pending_payment')) AS bookings,
          coalesce(sum(CASE WHEN b.status = 'confirmed' THEN b.seats END), 0) AS divers,
          coalesce(sum(CASE WHEN b.status = 'confirmed' THEN b.amount_php END), 0) AS revenue
        FROM ctr c JOIN bk b ON b.center_id = c.id WHERE b.created_at >= ? GROUP BY c.id, c.name, c.destination ORDER BY revenue DESC, bookings DESC LIMIT 8`, since),
      by_destination: await rows("SELECT coalesce(destination, '—') AS destination, count(*) AS n FROM ctr WHERE verification_status = 'verified' GROUP BY 1 ORDER BY 2 DESC LIMIT 8"),
    },
    trips: {
      upcoming: up.length,
      seats_total: up.reduce((s, t) => s + t.booked + t.free, 0),
      seats_booked: up.reduce((s, t) => s + t.booked, 0),
      empty_upcoming: up.filter((t) => t.booked === 0).length,
      completed: await one("SELECT count(*) FROM trp WHERE status = 'completed' AND departs_at >= ? AND departs_at <= ?", since, nowS),
      cancelled_weather: await one("SELECT count(*) FROM trp WHERE status = 'cancelled_weather' AND departs_at >= ?", since),
      drafts: await one("SELECT count(*) FROM trp WHERE status = 'draft' AND departs_at > ?", nowS),
    },
    bookings: {
      by_status: obj(await rows('SELECT status AS k, count(*) AS n FROM bk WHERE created_at >= ? GROUP BY 1', since), 'k'),
      by_source: obj(await rows("SELECT source AS k, count(*) AS n FROM bk WHERE created_at >= ? AND status <> 'cancelled_by_diver' GROUP BY 1", since), 'k'),
      divers: await one("SELECT coalesce(sum(seats), 0) FROM bk WHERE created_at >= ? AND status = 'confirmed'", since),
      gross: await one("SELECT coalesce(sum(amount_php), 0) FROM bk WHERE created_at >= ? AND status = 'confirmed'", since),
      collected: await one("SELECT coalesce(sum(paid_php), 0) FROM bk WHERE created_at >= ? AND status = 'confirmed'", since),
      outstanding: await one("SELECT coalesce(sum(amount_php - coalesce(paid_php, 0)), 0) FROM bk WHERE status = 'confirmed' AND departs_at > ?", nowS),
      commission: await one("SELECT coalesce(sum(commission_php), 0) FROM bk WHERE created_at >= ? AND status = 'confirmed'", since),
      refunds: await one('SELECT coalesce(sum(refund_php), 0) FROM bk WHERE cancelled_at >= ?', since),
      per_day: days.map((day, i) => ({ day, n: bkN[i], php: bkPhp[i] })),
    },
    payments: {
      by_method: obj(await rows("SELECT method AS k, sum(amount_php) AS n FROM pay WHERE status = 'paid' AND coalesce(paid_at, created_at) >= ? GROUP BY 1", since), 'k'),
      failed: await one("SELECT count(*) FROM pay WHERE status = 'failed' AND created_at >= ?", since),
      pending_online: await one("SELECT count(*) FROM pay WHERE status = 'pending' AND created_at >= ?", since),
    },
    activity: {
      dive_logs: await one('SELECT count(*) FROM dive_logs WHERE created_at >= ?', since),
      certs_unverified: await one('SELECT count(*) FROM certifications WHERE verified_at IS NULL'),
    },
    alerts: {
      centers_pending: await one("SELECT count(*) FROM ctr WHERE verification_status = 'pending'"),
      expired_holds: await one("SELECT count(*) FROM bk WHERE status = 'pending_payment' AND hold_until < ?", nowS),
      unpaid_soon: await one("SELECT count(*) FROM bk WHERE status = 'confirmed' AND coalesce(paid_php, 0) < amount_php AND departs_at BETWEEN ? AND ?", nowS, iso(now.getTime() + 48 * 36e5)),
    },
  }
}
