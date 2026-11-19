// Valoraciones de los guías / divemasters (17 nov 2026).
// - Quién valora: el buceador que estuvo a bordo (check-in, reserva confirmada) de una salida con guías asignados
//   (`trip_guides`), en los 14 días siguientes. Una valoración por salida, guía y buceador.
// - Qué: nota general 1–5 (obligatoria) y, opcionales, explicación previa (briefing), seguridad, encontrar vida marina
//   y trato/idioma, más un comentario privado.
// - Quién lo ve: la media es pública (ficha del centro) cuando la han valorado al menos 3 buceadores distintos; cuenta
//   la valoración más reciente de cada buceador y solo la de los últimos 12 meses. Los comentarios solo los ven el
//   equipo del centro y el propio guía, sin el nombre de quien los escribe. Nadie ve quién ha puesto qué nota.
// - Privacidad: se borran las del buceador al eliminar su cuenta y las del guía al eliminar la suya (cascada).
// Las tablas se crean solas (ensureGuideRatings).
import { fail, nowIso, uuid, all, first, run } from './lib/util.js'
import { rateLimit } from './auth.js'

const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const WINDOW_DAYS = 14
export const GUIDE_MIN = 3
const KEEP_MONTHS = 12
export const GUIDE_KEYS = ['briefing', 'safety', 'spotting', 'friendly']
const shortName = (n) => {
  const w = String(n || '').trim().split(/\s+/).filter(Boolean)
  return !w.length ? 'Guía' : w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]
}
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString()

let ready = false
export async function ensureGuideRatings(db) {
  if (ready) return
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS guide_ratings (
      id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
      guide_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      diver_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE,
      overall INTEGER NOT NULL CHECK (overall BETWEEN 1 AND 5),
      briefing INTEGER CHECK (briefing BETWEEN 1 AND 5), safety INTEGER CHECK (safety BETWEEN 1 AND 5),
      spotting INTEGER CHECK (spotting BETWEEN 1 AND 5), friendly INTEGER CHECK (friendly BETWEEN 1 AND 5),
      comment TEXT CHECK (comment IS NULL OR length(comment) <= 500),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (trip_id, guide_user_id, diver_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS guide_ratings_g ON guide_ratings (guide_user_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS guide_ratings_c ON guide_ratings (center_id)'),
  ])
  ready = true
}

const onBoard = async (db, trip, diver) => !!(diver && await first(db,
  "SELECT 1 AS x FROM bookings WHERE trip_id = ? AND diver_id = ? AND checked_in_at IS NOT NULL AND status = 'confirmed'", trip, diver))

// Media por guía: la valoración más reciente de cada buceador en los últimos 12 meses
function summarize(rows) {
  const latest = new Map()
  for (const r of rows) { const p = latest.get(r.diver_id); if (!p || r.created_at > p.created_at) latest.set(r.diver_id, r) }
  const xs = [...latest.values()]
  const avg = (k) => { const v = xs.map((r) => r[k]).filter((n) => n != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null }
  return { raters: xs.length, overall: avg('overall'), scores: Object.fromEntries(GUIDE_KEYS.map((k) => [k, avg(k)]).filter(([, v]) => v != null)) }
}
const since = () => new Date(Date.now() - KEEP_MONTHS * 30.44 * 864e5).toISOString()
const comments = (rows) => rows.filter((r) => r.comment).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 30)
  .map((r) => ({ comment: r.comment, overall: r.overall, at: r.created_at }))

export const GUIDES = {
  // Guías de una salida que el buceador puede valorar
  async guide_rating_targets(ctx, { p_trip }) {
    mfa(ctx)
    if (!ctx.diverId) fail('FORBIDDEN', 'inicia sesión para valorar', 401)
    await ensureGuideRatings(ctx.db)
    const t = await first(ctx.db, 'SELECT id, departs_at FROM trips WHERE id = ?', String(p_trip || ''))
    if (!t) fail('NOT_FOUND', 'no encontramos esta salida', 404)
    if (!(await onBoard(ctx.db, t.id, ctx.diverId))) return { guides: [], open: false }
    const closes = addDays(t.departs_at, WINDOW_DAYS)
    const open = Date.now() >= Date.parse(t.departs_at) && Date.now() <= Date.parse(closes)
    const rows = await all(ctx.db, `SELECT tg.user_id, coalesce(d.full_name, '') AS full_name,
        EXISTS (SELECT 1 FROM guide_ratings r WHERE r.trip_id = tg.trip_id AND r.guide_user_id = tg.user_id AND r.diver_id = ?) AS rated
      FROM trip_guides tg LEFT JOIN divers d ON d.user_id = tg.user_id WHERE tg.trip_id = ?`, ctx.diverId, t.id)
    return { open, closes_at: closes, guides: rows.map((g) => ({ user_id: g.user_id, name: shortName(g.full_name), rated: !!g.rated })) }
  },

  async rate_guide(ctx, { p_trip, p_guide, p_overall, p_scores = {}, p_comment = null }) {
    mfa(ctx)
    if (!ctx.diverId) fail('FORBIDDEN', 'inicia sesión para valorar', 401)
    await ensureGuideRatings(ctx.db)
    const t = await first(ctx.db, 'SELECT id, center_id, departs_at FROM trips WHERE id = ?', String(p_trip || ''))
    if (!t) fail('NOT_FOUND', 'no encontramos esta salida', 404)
    if (Date.now() < Date.parse(t.departs_at)) fail('TOO_EARLY', 'podrás valorar cuando haya salido el barco')
    if (Date.now() > Date.parse(addDays(t.departs_at, WINDOW_DAYS))) fail('CLOSED', 'el plazo para valorar esta salida terminó')
    if (!(await onBoard(ctx.db, t.id, ctx.diverId))) fail('FORBIDDEN', 'solo puede valorar quien estuvo a bordo (check-in)', 403)
    if (!(await first(ctx.db, 'SELECT 1 AS x FROM trip_guides WHERE trip_id = ? AND user_id = ?', t.id, String(p_guide || '')))) fail('FORBIDDEN', 'esa persona no fue guía en esta salida', 403)
    const n = Number(p_overall)
    if (!Number.isInteger(n) || n < 1 || n > 5) fail('INVALID', 'la nota general va del 1 al 5')
    const s = p_scores && typeof p_scores === 'object' ? p_scores : {}
    for (const [k, v] of Object.entries(s)) {
      if (!GUIDE_KEYS.includes(k)) fail('INVALID', 'criterio desconocido')
      if (v != null && (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 5)) fail('INVALID', 'las notas van del 1 al 5')
    }
    const comment = p_comment == null ? null : String(p_comment).trim().slice(0, 500) || null
    await rateLimit(ctx.env, 'grate:' + ctx.uid, 20, 3600)
    const r = await run(ctx.db, `INSERT INTO guide_ratings (id, trip_id, center_id, guide_user_id, diver_id, overall, briefing, safety, spotting, friendly, comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (trip_id, guide_user_id, diver_id) DO NOTHING`,
    uuid(), t.id, t.center_id, p_guide, ctx.diverId, n, ...GUIDE_KEYS.map((k) => (s[k] == null ? null : Number(s[k]))), comment)
    if (!(r?.meta?.changes ?? r?.changes)) fail('ALREADY_RATED', 'ya valoraste a este guía en esta salida')
    return { ok: true }
  },

  // Salidas recientes con guías por valorar (aviso en Reservas)
  async my_pending_guide_ratings(ctx) {
    if (!ctx.diverId || !ctx.mfaOk) return []
    await ensureGuideRatings(ctx.db)
    const now = nowIso()
    return all(ctx.db, `SELECT t.id AS trip_id, t.departs_at, c.name AS center_name, count(*) AS pending
      FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id JOIN trip_guides tg ON tg.trip_id = t.id
      WHERE b.diver_id = ? AND b.status = 'confirmed' AND b.checked_in_at IS NOT NULL AND t.departs_at <= ? AND t.departs_at >= ?
        AND NOT EXISTS (SELECT 1 FROM guide_ratings r WHERE r.trip_id = t.id AND r.guide_user_id = tg.user_id AND r.diver_id = b.diver_id)
      GROUP BY t.id ORDER BY t.departs_at DESC`, ctx.diverId, now, addDays(now, -WINDOW_DAYS))
  },

  // Valoraciones de los guías de un centro. Público: solo medias con 3+ buceadores. Equipo del centro: todo + comentarios.
  async guide_ratings(ctx, { p_center }) {
    await ensureGuideRatings(ctx.db)
    const staff = ctx.mfaOk && ctx.staff.includes(p_center)
    const rows = await all(ctx.db, `SELECT r.guide_user_id, r.diver_id, r.overall, r.briefing, r.safety, r.spotting, r.friendly, r.comment, r.created_at,
        coalesce(d.full_name, '') AS full_name
      FROM guide_ratings r LEFT JOIN divers d ON d.user_id = r.guide_user_id WHERE r.center_id = ? AND r.created_at >= ?`, String(p_center || ''), since())
    const by = new Map()
    for (const r of rows) { if (!by.has(r.guide_user_id)) by.set(r.guide_user_id, []); by.get(r.guide_user_id).push(r) }
    const out = []
    for (const [uid, rs] of by) {
      const s = summarize(rs)
      if (!staff && s.raters < GUIDE_MIN) continue
      out.push({ name: staff ? (rs[0].full_name || 'Guía') : shortName(rs[0].full_name), ...s, ...(staff ? { user_id: uid, comments: comments(rs) } : {}) })
    }
    return out.sort((a, b) => (b.overall || 0) - (a.overall || 0))
  },

  // El guía ve las suyas (todas, con comentarios anónimos)
  async my_guide_ratings(ctx) {
    mfa(ctx)
    if (!ctx.uid) return null
    await ensureGuideRatings(ctx.db)
    const rows = await all(ctx.db, 'SELECT diver_id, overall, briefing, safety, spotting, friendly, comment, created_at FROM guide_ratings WHERE guide_user_id = ? AND created_at >= ?', ctx.uid, since())
    if (!rows.length) return { raters: 0 }
    return { ...summarize(rows), comments: comments(rows), public: summarize(rows).raters >= GUIDE_MIN }
  },
}

// Al eliminar la cuenta del buceador se borran sus valoraciones a guías
export async function deleteDiverGuideRatings(db, diverId) {
  await ensureGuideRatings(db)
  return [db.prepare('DELETE FROM guide_ratings WHERE diver_id = ?').bind(diverId)]
}
