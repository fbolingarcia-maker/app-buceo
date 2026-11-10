// Equipo del centro, check-in con QR, widget de reservas y comunidad (11 nov 2026).
//   Equipo:      invitaciones por email (responsable o guía), guías asignados a cada salida y el día del guía.
//   Check-in:    pase con QR para el buceador; el guía o el centro lo escanean (o teclean el código de 8 caracteres).
//   Widget:      GET /w/<centro> → página para insertar en la web del centro (iframe), reserva por el enlace propio.
//   Comunidad:   seguir a buceadores (con perfil público) y centros, muro, avistamientos por punto de buceo,
//                rangos y retos de la bitácora y ranking por destino.
// Las RPC se suman a las de rpc.js (handleRpc).
import { HOLDS, NO_CERT_ACTIVITIES } from './schema.js'
import { fail, nowIso, uuid, all, first, run, changes } from './lib/util.js'
import { sha256, randomToken, hmacHex } from './lib/crypto.js'
import { qrSvgDataUrl } from './lib/qr.js'
import { sendEmail, TEMPLATES } from './email.js'
import { rateLimit } from './auth.js'
import { shortName } from './plus.js'

const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const needUser = (ctx) => { if (!ctx.uid) fail('NO_SESSION', 'inicia sesión', 401); mfa(ctx) }
const isStaff = (ctx, center) => ctx.staff.includes(center)
const manilaDay = (ms = Date.now()) => new Date(ms + 8 * 36e5).toISOString().slice(0, 10)
const dayStart = (ymd) => new Date(Date.parse(ymd + 'T00:00:00+08:00')).toISOString()
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,}$/i
const INVITE_DAYS = 7

// Centros en los que el usuario es guía (tabla nueva: si aún no existe en D1, ninguno)
export async function guideCenters(db, uid) {
  if (!uid) return []
  return (await all(db, 'SELECT center_id FROM center_guides WHERE user_id = ?', uid).catch(() => [])).map((r) => r.center_id)
}
const canWorkCenter = async (ctx, center) => isStaff(ctx, center) || (await guideCenters(ctx.db, ctx.uid)).includes(center)

// ── Rangos y retos (bitácora) ──
export const RANKS = [[0, 'new'], [10, 'explorer'], [50, 'regular'], [100, 'veteran'], [300, 'master'], [1000, 'legend']]
export function rankOf(n) {
  let i = 0
  while (i + 1 < RANKS.length && n >= RANKS[i + 1][0]) i++
  return { key: RANKS[i][1], at: RANKS[i][0], next: RANKS[i + 1]?.[0] ?? null, nextKey: RANKS[i + 1]?.[1] ?? null }
}
export const CHALLENGES = [
  ['logs10', 10], ['sites5', 5], ['dest3', 3], ['deep30', 1], ['signed5', 5], ['sight3', 3], ['year25', 25], ['logs100', 100],
]

// ── Pase de check-in ──
const passCode = async (env, bookingId) => (await hmacHex(env.AUTH_SECRET || 'ds', 'checkin:' + bookingId)).slice(0, 8).toUpperCase()

async function manifestRows(db, tripIds) {
  if (!tripIds.length) return []
  return all(db, `SELECT b.id, b.trip_id, b.seats, b.status, b.with_gear, b.checked_in_at, b.amount_php, b.paid_php, b.source, b.guest_name, b.pay_on_site,
      d.id AS diver_id, d.full_name, d.wetsuit_size, d.bcd_size, d.fin_size, d.nitrox, d.allergies, d.insurance_provider, d.insurance_expiry,
      d.medical_done_at, d.medical_result, d.last_dive_date,
      (SELECT ce.agency FROM certifications ce WHERE ce.diver_id = d.id ORDER BY CASE ce.level WHEN 'instructor' THEN 4 WHEN 'divemaster' THEN 3 WHEN 'rescue' THEN 2 WHEN 'advanced' THEN 1 ELSE 0 END DESC LIMIT 1) AS cert_agency,
      (SELECT ce.level FROM certifications ce WHERE ce.diver_id = d.id ORDER BY CASE ce.level WHEN 'instructor' THEN 4 WHEN 'divemaster' THEN 3 WHEN 'rescue' THEN 2 WHEN 'advanced' THEN 1 ELSE 0 END DESC LIMIT 1) AS cert_level,
      (SELECT count(*) FROM certifications ce WHERE ce.diver_id = d.id AND ce.verified_at IS NOT NULL) AS cert_verified
    FROM bookings b LEFT JOIN divers d ON d.id = b.diver_id
    WHERE b.trip_id IN (${tripIds.map(() => '?').join(',')}) AND (b.status = 'confirmed' OR ${HOLDS('b')})
    ORDER BY b.created_at`, ...tripIds)
}

export const COMUNIDAD = {
  // ── Equipo del centro ──
  async team_list(ctx, { p_center }) {
    needUser(ctx)
    if (!isStaff(ctx, p_center) && !ctx.isAdmin) fail('FORBIDDEN', null, 403)
    const [staff, guides, invites] = await Promise.all([
      all(ctx.db, `SELECT s.user_id, s.role, u.email, d.full_name FROM center_staff s JOIN users u ON u.id = s.user_id LEFT JOIN divers d ON d.user_id = u.id
        WHERE s.center_id = ? ORDER BY s.role = 'owner' DESC, u.email`, p_center),
      all(ctx.db, `SELECT g.user_id, 'guide' AS role, u.email, d.full_name FROM center_guides g JOIN users u ON u.id = g.user_id LEFT JOIN divers d ON d.user_id = u.id
        WHERE g.center_id = ? ORDER BY d.full_name, u.email`, p_center),
      all(ctx.db, `SELECT id, email, role, created_at, expires_at FROM center_invites WHERE center_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`, p_center, nowIso()),
    ])
    return { members: [...staff, ...guides].map((m) => ({ ...m, me: m.user_id === ctx.uid })), invites }
  },
  async team_invite(ctx, { p_center, p_email, p_role }) {
    needUser(ctx)
    if (!isStaff(ctx, p_center)) fail('FORBIDDEN', null, 403)
    const email = String(p_email || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) fail('BAD_EMAIL', 'email no válido')
    if (!['manager', 'guide'].includes(p_role)) fail('BAD_ROLE', 'papel no válido')
    await rateLimit(ctx.env, 'invite:' + p_center, 20, 86400)
    const already = await first(ctx.db, `SELECT 1 AS x FROM users u WHERE lower(u.email) = ? AND (
        EXISTS (SELECT 1 FROM center_staff s WHERE s.user_id = u.id AND s.center_id = ?) OR EXISTS (SELECT 1 FROM center_guides g WHERE g.user_id = u.id AND g.center_id = ?))`, email, p_center, p_center)
    if (already) fail('ALREADY_MEMBER', 'esa persona ya está en tu equipo')
    const c = await first(ctx.db, 'SELECT name FROM centers WHERE id = ?', p_center)
    const token = randomToken(24)
    // Una invitación pendiente por email y centro: la nueva sustituye a la anterior
    await ctx.db.batch([
      ctx.db.prepare('DELETE FROM center_invites WHERE center_id = ? AND lower(email) = ? AND accepted_at IS NULL').bind(p_center, email),
      ctx.db.prepare('INSERT INTO center_invites (id, center_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(uuid(), p_center, email, p_role, await sha256(token), ctx.uid, new Date(Date.now() + INVITE_DAYS * 864e5).toISOString()),
    ])
    // Idioma: el de la persona invitada si ya tiene cuenta; si no, el de quien invita
    const lang = (await first(ctx.db, 'SELECT d.locale FROM users u JOIN divers d ON d.user_id = u.id WHERE lower(u.email) = ?', email))?.locale
      || (await first(ctx.db, 'SELECT locale FROM divers WHERE user_id = ?', ctx.uid))?.locale
    const url = (ctx.origin || 'https://divingslot.com') + '/app/#/equipo/aceptar?token=' + encodeURIComponent(token)
    const p = sendEmail(ctx.env, email, TEMPLATES.teamInvite(c?.name || 'DivingSlot', p_role, url, lang)).catch((e) => console.error('invitación', e.message))
    if (ctx.waitUntil) ctx.waitUntil(p); else await p
    return { ok: true }
  },
  async team_revoke_invite(ctx, { p_invite }) {
    needUser(ctx)
    const i = await first(ctx.db, 'SELECT center_id FROM center_invites WHERE id = ?', p_invite)
    if (!i || !isStaff(ctx, i.center_id)) fail('FORBIDDEN', null, 403)
    await run(ctx.db, 'DELETE FROM center_invites WHERE id = ? AND accepted_at IS NULL', p_invite)
    return { ok: true }
  },
  async team_invite_info(ctx, { p_token }) {
    const i = await first(ctx.db, `SELECT i.email, i.role, i.expires_at, i.accepted_at, c.name AS center_name FROM center_invites i JOIN centers c ON c.id = i.center_id
      WHERE i.token_hash = ?`, await sha256(String(p_token || '')))
    if (!i) fail('NOT_FOUND', 'la invitación no existe o ya no es válida', 404)
    return { center_name: i.center_name, role: i.role, email: i.email.replace(/^(.).*(@.*)$/, '$1•••$2'), expired: Date.parse(i.expires_at) < Date.now(), accepted: !!i.accepted_at }
  },
  async team_accept(ctx, { p_token }) {
    needUser(ctx)
    if (!ctx.session?.email_confirmed_at) fail('EMAIL_NOT_CONFIRMED', 'confirma tu email antes de unirte al equipo')
    const i = await first(ctx.db, 'SELECT * FROM center_invites WHERE token_hash = ?', await sha256(String(p_token || '')))
    if (!i || i.accepted_at || Date.parse(i.expires_at) < Date.now()) fail('INVITE_INVALID', 'la invitación no existe, caducó o ya se usó')
    if (String(ctx.email || '').toLowerCase() !== i.email.toLowerCase()) fail('WRONG_ACCOUNT', 'entra con el email al que llegó la invitación')
    if (i.role === 'manager') {
      const other = await first(ctx.db, 'SELECT center_id FROM center_staff WHERE user_id = ?', ctx.uid)
      if (other && other.center_id !== i.center_id) fail('OTHER_CENTER', 'tu cuenta ya gestiona otro centro')
      if (!other) await run(ctx.db, "INSERT INTO center_staff (center_id, user_id, role) VALUES (?, ?, 'manager')", i.center_id, ctx.uid)
      await run(ctx.db, 'DELETE FROM center_guides WHERE center_id = ? AND user_id = ?', i.center_id, ctx.uid)
    } else {
      if (isStaff(ctx, i.center_id)) fail('ALREADY_MEMBER', 'ya eres responsable de este centro')
      await run(ctx.db, 'INSERT OR IGNORE INTO center_guides (center_id, user_id) VALUES (?, ?)', i.center_id, ctx.uid)
    }
    await run(ctx.db, 'UPDATE center_invites SET accepted_at = ?, accepted_by = ? WHERE id = ?', nowIso(), ctx.uid, i.id)
    return { role: i.role, center_id: i.center_id }
  },
  async team_remove(ctx, { p_center, p_user }) {
    needUser(ctx)
    if (!isStaff(ctx, p_center)) fail('FORBIDDEN', null, 403)
    const owner = await first(ctx.db, "SELECT 1 AS x FROM center_staff WHERE center_id = ? AND user_id = ? AND role = 'owner'", p_center, p_user)
    if (owner) fail('OWNER', 'el titular del centro no se puede quitar')
    if (p_user === ctx.uid) fail('SELF', 'no puedes quitarte a ti mismo')
    const now = nowIso()
    const r = await ctx.db.batch([
      ctx.db.prepare("DELETE FROM center_staff WHERE center_id = ? AND user_id = ? AND role <> 'owner'").bind(p_center, p_user),
      ctx.db.prepare('DELETE FROM center_guides WHERE center_id = ? AND user_id = ?').bind(p_center, p_user),
      ctx.db.prepare('DELETE FROM trip_guides WHERE user_id = ? AND trip_id IN (SELECT id FROM trips WHERE center_id = ? AND departs_at > ?)').bind(p_user, p_center, now),
    ])
    return { removed: changes(r[0]) + changes(r[1]) }
  },
  // Guías asignados: lista del centro en un rango de días (agenda) y asignación de una salida
  async trip_guides_list(ctx, { p_center, p_from, p_to }) {
    needUser(ctx)
    if (!isStaff(ctx, p_center) && !ctx.isAdmin) fail('FORBIDDEN', null, 403)
    return all(ctx.db, `SELECT tg.trip_id, tg.user_id, coalesce(d.full_name, u.email) AS name FROM trip_guides tg JOIN trips t ON t.id = tg.trip_id
      JOIN users u ON u.id = tg.user_id LEFT JOIN divers d ON d.user_id = u.id
      WHERE t.center_id = ? AND t.departs_at >= ? AND t.departs_at < ? ORDER BY name`, p_center, String(p_from || ''), String(p_to || '9999'))
  },
  async assign_guides(ctx, { p_trip, p_users = [] }) {
    needUser(ctx)
    const t = await first(ctx.db, 'SELECT id, center_id FROM trips WHERE id = ?', p_trip)
    if (!t || !isStaff(ctx, t.center_id)) fail('FORBIDDEN', null, 403)
    const ids = [...new Set((Array.isArray(p_users) ? p_users : []).map(String))].slice(0, 15)
    if (ids.length) {
      const ok = await all(ctx.db, `SELECT user_id FROM center_guides WHERE center_id = ?1 AND user_id IN (${ids.map((_, i) => '?' + (i + 2)).join(',')})
        UNION SELECT user_id FROM center_staff WHERE center_id = ?1 AND user_id IN (${ids.map((_, i) => '?' + (i + 2)).join(',')})`, t.center_id, ...ids)
      if (ok.length !== ids.length) fail('NOT_MEMBER', 'solo puedes asignar a personas de tu equipo')
    }
    await ctx.db.batch([
      ctx.db.prepare('DELETE FROM trip_guides WHERE trip_id = ?').bind(t.id),
      ...ids.map((u) => ctx.db.prepare('INSERT INTO trip_guides (trip_id, user_id) VALUES (?, ?)').bind(t.id, u)),
    ])
    return { assigned: ids.length }
  },
  async my_guide_centers(ctx) {
    if (!ctx.uid) return []
    return all(ctx.db, 'SELECT c.id, c.name FROM center_guides g JOIN centers c ON c.id = g.center_id WHERE g.user_id = ? ORDER BY c.name', ctx.uid).catch(() => [])
  },
  // El día del guía: salidas del día de sus centros (las suyas primero) con el manifiesto
  async guide_day(ctx, { p_day = null }) {
    needUser(ctx)
    const centers = await guideCenters(ctx.db, ctx.uid)
    if (!centers.length) fail('FORBIDDEN', 'no eres guía de ningún centro', 403)
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(p_day || '')) ? p_day : manilaDay()
    const from = dayStart(day), to = new Date(Date.parse(from) + 864e5).toISOString()
    const trips = await all(ctx.db, `SELECT t.id, t.center_id, t.departs_at, t.num_dives, t.min_level, t.status, t.activity, t.kind, t.course_name, c.name AS center_name, bo.name AS boat,
        (SELECT json_group_array(name) FROM (SELECT ds.name FROM trip_sites ts JOIN dive_sites ds ON ds.id = ts.site_id WHERE ts.trip_id = t.id ORDER BY ts.position)) AS sites,
        EXISTS (SELECT 1 FROM trip_guides tg WHERE tg.trip_id = t.id AND tg.user_id = ?) AS mine,
        (SELECT json_group_array(coalesce(d.full_name, u.email)) FROM trip_guides tg JOIN users u ON u.id = tg.user_id LEFT JOIN divers d ON d.user_id = u.id WHERE tg.trip_id = t.id) AS guides
      FROM trips t JOIN centers c ON c.id = t.center_id JOIN boats bo ON bo.id = t.boat_id
      WHERE t.center_id IN (${centers.map(() => '?').join(',')}) AND t.departs_at >= ? AND t.departs_at < ? AND t.status IN ('published', 'completed')
      ORDER BY mine DESC, t.departs_at`, ctx.uid, ...centers, from, to)
    const rows = await manifestRows(ctx.db, trips.map((t) => t.id))
    return trips.map((t) => ({ ...t, mine: !!t.mine, sites: JSON.parse(t.sites || '[]'), guides: JSON.parse(t.guides || '[]'),
      bookings: rows.filter((b) => b.trip_id === t.id).map((b) => ({ ...b, nitrox: !!b.nitrox, pay_on_site: !!b.pay_on_site, full_name: b.full_name || b.guest_name || null })) }))
  },

  // ── Check-in con QR ──
  async checkin_pass(ctx, { p_booking }) {
    needUser(ctx)
    const b = await first(ctx.db, `SELECT b.id, b.status, b.checked_in_at, t.departs_at FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.id = ? AND b.diver_id = ?`, p_booking, ctx.diverId || '')
    if (!b) fail('NOT_FOUND', 'reserva no encontrada', 404)
    if (!['confirmed', 'pending_payment'].includes(b.status)) fail('BAD_STATE', 'la reserva no está activa')
    const code = await passCode(ctx.env, b.id)
    return { code, qr: qrSvgDataUrl('DSCHK:' + b.id + ':' + code), checked_in_at: b.checked_in_at }
  },
  async checkin_scan(ctx, { p_code }) {
    needUser(ctx)
    const raw = String(p_code || '').trim()
    const centers = [...new Set([...ctx.staff, ...(await guideCenters(ctx.db, ctx.uid))])]
    if (!centers.length) fail('FORBIDDEN', 'solo el equipo del centro hace el check-in', 403)
    await rateLimit(ctx.env, 'scan:' + ctx.uid, 120, 600)
    // Salidas del centro entre 12 h antes y 18 h después de ahora
    const from = new Date(Date.now() - 18 * 36e5).toISOString(), to = new Date(Date.now() + 18 * 36e5).toISOString()
    let id = null
    const m = /^DSCHK:([0-9a-f-]{36}):([0-9A-F]{8})$/i.exec(raw)
    if (m) {
      if ((await passCode(ctx.env, m[1])) !== m[2].toUpperCase()) fail('BAD_CODE', 'código no válido')
      id = m[1]
    } else {
      const short = raw.replace(/[\s-]/g, '').toUpperCase()
      if (!/^[0-9A-F]{8}$/.test(short)) fail('BAD_CODE', 'código no válido')
      const cand = await all(ctx.db, `SELECT b.id FROM bookings b JOIN trips t ON t.id = b.trip_id
        WHERE t.center_id IN (${centers.map(() => '?').join(',')}) AND t.departs_at BETWEEN ? AND ? AND b.status IN ('confirmed', 'pending_payment')`, ...centers, from, to)
      for (const c of cand) if ((await passCode(ctx.env, c.id)) === short) { id = c.id; break }
      if (!id) fail('NOT_FOUND', 'no hay ninguna reserva de hoy con ese código', 404)
    }
    const b = await first(ctx.db, `SELECT b.id, b.status, b.seats, b.checked_in_at, b.amount_php, b.paid_php, b.trip_id, t.center_id, t.departs_at, d.full_name, b.guest_name
      FROM bookings b JOIN trips t ON t.id = b.trip_id LEFT JOIN divers d ON d.id = b.diver_id WHERE b.id = ?`, id)
    if (!b || !centers.includes(b.center_id)) fail('FORBIDDEN', 'esta reserva es de otro centro', 403)
    if (!['confirmed', 'pending_payment'].includes(b.status)) fail('BAD_STATE', 'la reserva está cancelada')
    if (b.departs_at < from || b.departs_at > to) fail('NOT_TODAY', 'la reserva es de otro día')
    const already = !!b.checked_in_at
    if (!already) await run(ctx.db, 'UPDATE bookings SET checked_in_at = ? WHERE id = ? AND checked_in_at IS NULL', nowIso(), b.id)
    return { booking_id: b.id, trip_id: b.trip_id, name: b.full_name || b.guest_name || '—', seats: b.seats, already, status: b.status, due_php: Math.max(0, b.amount_php - b.paid_php) }
  },

  // ── Seguir y muro ──
  async follow(ctx, { p_type, p_id }) {
    needUser(ctx)
    if (!ctx.diverId) fail('NO_PROFILE', 'crea tu perfil de buceador')
    if (p_type === 'diver') {
      if (p_id === ctx.diverId) fail('SELF', 'no puedes seguirte a ti mismo')
      const d = await first(ctx.db, 'SELECT public_profile FROM divers WHERE id = ?', p_id)
      if (!d?.public_profile) fail('PRIVATE', 'este perfil no es público')
    } else if (p_type === 'center') {
      if (!(await first(ctx.db, 'SELECT 1 AS x FROM centers WHERE id = ?', p_id))) fail('NOT_FOUND', null, 404)
    } else fail('BAD_TYPE', 'tipo no válido')
    await rateLimit(ctx.env, 'follow:' + ctx.uid, 100, 3600)
    await run(ctx.db, 'INSERT OR IGNORE INTO follows (follower_id, target_type, target_id) VALUES (?, ?, ?)', ctx.diverId, p_type, p_id)
    return { following: true }
  },
  async unfollow(ctx, { p_type, p_id }) {
    needUser(ctx)
    await run(ctx.db, 'DELETE FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ?', ctx.diverId || '', String(p_type), String(p_id))
    return { following: false }
  },
  async my_follows(ctx) {
    if (!ctx.diverId) return { divers: [], centers: [] }
    const [divers, centers] = await Promise.all([
      all(ctx.db, `SELECT d.id, d.full_name, d.country FROM follows f JOIN divers d ON d.id = f.target_id WHERE f.follower_id = ? AND f.target_type = 'diver' AND d.public_profile = 1 ORDER BY d.full_name`, ctx.diverId),
      all(ctx.db, `SELECT c.id, c.name, c.destination FROM follows f JOIN centers c ON c.id = f.target_id WHERE f.follower_id = ? AND f.target_type = 'center' ORDER BY c.name`, ctx.diverId),
    ])
    return { divers: divers.map((d) => ({ id: d.id, name: shortName(d.full_name), country: d.country })), centers }
  },
  async follow_state(ctx, { p_type, p_id }) {
    const n = (await first(ctx.db, 'SELECT count(*) AS n FROM follows WHERE target_type = ? AND target_id = ?', String(p_type), String(p_id)))?.n || 0
    const me = ctx.diverId ? !!(await first(ctx.db, 'SELECT 1 AS x FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ?', ctx.diverId, String(p_type), String(p_id))) : false
    return { followers: n, following: me }
  },
  // Perfil público de un buceador: nombre corto, rango, inmersiones y las que comparte en el muro
  async public_diver(ctx, { p_id }) {
    const d = await first(ctx.db, 'SELECT id, full_name, country, bio, logged_dives, public_profile, languages FROM divers WHERE id = ?', p_id)
    if (!d || (!d.public_profile && d.id !== ctx.diverId)) fail('PRIVATE', 'este perfil no es público', 404)
    const [cnt, level, logs, fol] = await Promise.all([
      first(ctx.db, 'SELECT count(*) AS n FROM dive_logs WHERE diver_id = ?', d.id),
      first(ctx.db, `SELECT level FROM certifications WHERE diver_id = ? ORDER BY CASE level WHEN 'instructor' THEN 4 WHEN 'divemaster' THEN 3 WHEN 'rescue' THEN 2 WHEN 'advanced' THEN 1 ELSE 0 END DESC LIMIT 1`, d.id),
      all(ctx.db, `SELECT l.id, l.dive_date, coalesce(ds.name, l.site_name) AS site, ds.area, l.max_depth_m, l.duration_min, l.marine_life, l.rating, c.name AS center_name, l.signed_at IS NOT NULL AS signed
        FROM dive_logs l LEFT JOIN dive_sites ds ON ds.id = l.site_id LEFT JOIN centers c ON c.id = l.center_id
        WHERE l.diver_id = ? AND l.share_public = 1 ORDER BY l.dive_date DESC, l.created_at DESC LIMIT 30`, d.id),
      COMUNIDAD.follow_state(ctx, { p_type: 'diver', p_id: d.id }),
    ])
    const total = Math.max(cnt.n, d.logged_dives || 0)
    return { id: d.id, name: shortName(d.full_name), country: d.country, bio: d.bio, languages: JSON.parse(d.languages || '[]'), level: level?.level || null,
      dives: total, rank: rankOf(total), logs: logs.map((l) => ({ ...l, signed: !!l.signed })), ...fol, me: d.id === ctx.diverId }
  },
  // Muro: inmersiones compartidas de quien sigues, avistamientos de tus centros y sus próximas salidas
  async feed(ctx, { p_before = null }) {
    needUser(ctx)
    if (!ctx.diverId) return []
    const before = p_before || '9999'
    const [logs, sights, trips] = await Promise.all([
      all(ctx.db, `SELECT 'log' AS type, l.id, l.created_at, l.dive_date, coalesce(ds.name, l.site_name) AS site, ds.area, l.max_depth_m, l.duration_min, l.marine_life, l.rating,
          d.id AS diver_id, d.full_name, c.name AS center_name
        FROM dive_logs l JOIN divers d ON d.id = l.diver_id LEFT JOIN dive_sites ds ON ds.id = l.site_id LEFT JOIN centers c ON c.id = l.center_id
        WHERE l.share_public = 1 AND d.public_profile = 1 AND l.created_at < ?
          AND l.diver_id IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'diver')
        ORDER BY l.created_at DESC LIMIT 30`, before, ctx.diverId),
      all(ctx.db, `SELECT 'sighting' AS type, s.id, s.created_at, s.seen_on, s.species, s.note, ds.name AS site, ds.area, c.id AS center_id, c.name AS center_name
        FROM sightings s JOIN dive_sites ds ON ds.id = s.site_id LEFT JOIN centers c ON c.id = s.center_id
        WHERE s.created_at < ?1 AND (s.center_id IN (SELECT target_id FROM follows WHERE follower_id = ?2 AND target_type = 'center')
          OR s.diver_id IN (SELECT f.target_id FROM follows f JOIN divers x ON x.id = f.target_id WHERE f.follower_id = ?2 AND f.target_type = 'diver' AND x.public_profile = 1))
        ORDER BY s.created_at DESC LIMIT 30`, before, ctx.diverId),
      p_before ? [] : all(ctx.db, `SELECT 'trip' AS type, p.id, p.departs_at AS created_at, p.departs_at, p.center_id, p.center_name, p.sites, p.available_seats, p.price_php, p.activity, p.kind, p.course_name, p.last_minute_pct
        FROM published_trips p WHERE p.center_id IN (SELECT target_id FROM follows WHERE follower_id = ? AND target_type = 'center')
          AND p.departs_at > ? AND p.departs_at < ? AND p.available_seats > 0 ORDER BY p.departs_at LIMIT 10`, ctx.diverId, nowIso(), new Date(Date.now() + 7 * 864e5).toISOString()),
    ])
    const items = [...logs.map((l) => ({ ...l, who: shortName(l.full_name), full_name: undefined })), ...sights].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 30)
    return { items, trips: trips.map((x) => ({ ...x, sites: JSON.parse(x.sites || '[]') })) }
  },

  // ── Avistamientos ──
  async add_sighting(ctx, { p_site, p_species, p_note = '', p_seen_on = null }) {
    needUser(ctx)
    const species = String(p_species || '').trim()
    if (species.length < 2 || species.length > 40) fail('BAD_SPECIES', 'escribe qué viste (2 a 40 caracteres)')
    const note = String(p_note || '').trim().slice(0, 200)
    const today = manilaDay()
    const seen = /^\d{4}-\d{2}-\d{2}$/.test(String(p_seen_on || '')) ? p_seen_on : today
    if (seen > today || seen < manilaDay(Date.now() - 7 * 864e5)) fail('BAD_DATE', 'solo avistamientos de los últimos 7 días')
    if (!(await first(ctx.db, 'SELECT 1 AS x FROM dive_sites WHERE id = ?', p_site))) fail('NOT_FOUND', 'punto de buceo no encontrado', 404)
    await rateLimit(ctx.env, 'sight:' + ctx.uid, 20, 86400)
    const center = ctx.staff[0] || (await guideCenters(ctx.db, ctx.uid))[0] || null
    if (!center && !ctx.diverId) fail('NO_PROFILE', 'crea tu perfil de buceador')
    const id = uuid()
    await run(ctx.db, 'INSERT INTO sightings (id, site_id, species, note, seen_on, center_id, diver_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, p_site, species, note || null, seen, center, center ? null : ctx.diverId, ctx.uid)
    return { id }
  },
  async delete_sighting(ctx, { p_id }) {
    needUser(ctx)
    const r = await run(ctx.db, 'DELETE FROM sightings WHERE id = ? AND (user_id = ? OR ?)', p_id, ctx.uid, ctx.isAdmin ? 1 : 0)
    return { deleted: changes(r) }
  },
  // Públicos: por punto, por zona (destino) o los últimos de todo el país
  async sightings(ctx, { p_site = null, p_area = null, p_days = 14, p_limit = 60 }) {
    const days = Math.min(60, Math.max(1, +p_days || 14))
    const since = manilaDay(Date.now() - days * 864e5)
    const where = ['s.seen_on >= ?'], params = [since]
    if (p_site) { where.push('s.site_id = ?'); params.push(p_site) }
    if (p_area) { where.push('ds.area = ?'); params.push(p_area) }
    const rows = await all(ctx.db, `SELECT s.id, s.site_id, s.species, s.note, s.seen_on, s.created_at, ds.name AS site, ds.area, c.id AS center_id, c.name AS center_name, d.full_name,
        s.user_id = ? AS mine
      FROM sightings s JOIN dive_sites ds ON ds.id = s.site_id LEFT JOIN centers c ON c.id = s.center_id LEFT JOIN divers d ON d.id = s.diver_id
      WHERE ${where.join(' AND ')} ORDER BY s.seen_on DESC, s.created_at DESC LIMIT ?`, ctx.uid || '', ...params, Math.min(200, +p_limit || 60))
    return rows.map((r) => ({ ...r, by: r.center_name || shortName(r.full_name), full_name: undefined, mine: !!r.mine }))
  },

  // ── Rangos, retos y ranking ──
  async my_progress(ctx) {
    needUser(ctx)
    if (!ctx.diverId) return null
    const yearStart = manilaDay().slice(0, 4) + '-01-01'
    const s = await first(ctx.db, `SELECT count(*) AS logs, count(DISTINCT coalesce(l.site_id, lower(l.site_name))) AS sites,
        count(DISTINCT coalesce(ds.area, c.destination)) AS dests, max(l.max_depth_m) AS deepest, sum(l.signed_at IS NOT NULL) AS signed,
        sum(l.dive_date >= ?) AS year
      FROM dive_logs l LEFT JOIN dive_sites ds ON ds.id = l.site_id LEFT JOIN centers c ON c.id = l.center_id WHERE l.diver_id = ?`, yearStart, ctx.diverId)
    const d = await first(ctx.db, 'SELECT logged_dives, public_profile FROM divers WHERE id = ?', ctx.diverId)
    const sight = (await first(ctx.db, 'SELECT count(*) AS n FROM sightings WHERE user_id = ?', ctx.uid))?.n || 0
    const total = Math.max(s.logs || 0, d?.logged_dives || 0)
    const val = { logs10: s.logs, sites5: s.sites, dest3: s.dests, deep30: (s.deepest || 0) >= 30 ? 1 : 0, signed5: s.signed || 0, sight3: sight, year25: s.year || 0, logs100: s.logs }
    return { total, logs: s.logs || 0, rank: rankOf(total), public_profile: !!d?.public_profile,
      challenges: CHALLENGES.map(([k, goal]) => ({ key: k, goal, progress: Math.min(goal, +val[k] || 0), done: (+val[k] || 0) >= goal })) }
  },
  // Ranking de un destino: buceadores con perfil público por inmersiones registradas allí en los últimos 12 meses
  async leaderboard(ctx, { p_area }) {
    const since = manilaDay(Date.now() - 365 * 864e5)
    const rows = await all(ctx.db, `SELECT d.id, d.full_name, d.country, count(*) AS n FROM dive_logs l JOIN divers d ON d.id = l.diver_id
        LEFT JOIN dive_sites ds ON ds.id = l.site_id LEFT JOIN centers c ON c.id = l.center_id
      WHERE d.public_profile = 1 AND l.dive_date >= ? AND coalesce(ds.area, c.destination) = ?
      GROUP BY d.id ORDER BY n DESC, d.full_name LIMIT 10`, since, String(p_area || ''))
    return rows.map((r, i) => ({ pos: i + 1, id: r.id, name: shortName(r.full_name), country: r.country, dives: r.n, me: r.id === ctx.diverId }))
  },

  // Pago en un toque: guarda el método preferido en el perfil (sirve en todos los dispositivos)
  async set_pay_method(ctx, { p_method }) {
    needUser(ctx)
    if (!['gcash', 'paymaya', 'qrph', 'card', 'grab_pay'].includes(p_method)) fail('BAD_METHOD', 'método no válido')
    await run(ctx.db, 'UPDATE divers SET pay_method = ? WHERE id = ?', p_method, ctx.diverId || '')
    return { ok: true }
  },
}

// Actividades que no piden certificación (y el esnórquel tampoco el cuestionario médico)
export const needsCert = (t) => !NO_CERT_ACTIVITIES.includes(t?.activity || 'scuba')
export const needsMedical = (t) => (t?.activity || 'scuba') !== 'snorkel'

// ── Widget de reservas para la web del centro: divingslot.com/w/<centro>[?lang=en|es] ──
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const W = {
  es: { title: 'Próximas salidas', none: 'No hay salidas publicadas en los próximos 14 días.', book: 'Reservar', full: 'Completa', seats: (n) => (n === 1 ? '1 plaza' : n + ' plazas'), dives: (n) => (n === 1 ? '1 inmersión' : n + ' inmersiones'), by: 'Reservas con', act: { scuba: 'Buceo', snorkel: 'Esnórquel', freedive: 'Apnea', try_dive: 'Bautismo', course: 'Curso' }, locale: 'es-ES' },
  en: { title: 'Upcoming trips', none: 'No trips published for the next 14 days.', book: 'Book', full: 'Full', seats: (n) => (n === 1 ? '1 spot' : n + ' spots'), dives: (n) => (n === 1 ? '1 dive' : n + ' dives'), by: 'Bookings by', act: { scuba: 'Diving', snorkel: 'Snorkelling', freedive: 'Freediving', try_dive: 'Try dive', course: 'Course' }, locale: 'en-GB' },
}
export async function handleWidget(req, env, url, id) {
  const lang = url.searchParams.get('lang') === 'es' || (!url.searchParams.get('lang') && /^es\b/i.test(req.headers.get('Accept-Language') || '')) ? 'es' : 'en'
  const L = W[lang]
  const color = /^[0-9a-f]{6}$/i.test(url.searchParams.get('color') || '') ? '#' + url.searchParams.get('color') : '#0b5e8a'
  const c = await first(env.DB, "SELECT id, name, destination FROM centers WHERE id = ? AND verification_status = 'verified'", id).catch(() => null)
  const trips = c ? await all(env.DB, `SELECT id, departs_at, num_dives, price_php, available_seats, sites, activity, kind, course_name, last_minute_pct, early_pct FROM published_trips
    WHERE center_id = ? AND departs_at > ? AND departs_at < ? ORDER BY departs_at LIMIT 40`, id, new Date(Date.now() + 36e5).toISOString(), new Date(Date.now() + 14 * 864e5).toISOString()) : []
  const day = (iso) => new Date(iso).toLocaleDateString(L.locale, { timeZone: 'Asia/Manila', weekday: 'long', day: 'numeric', month: 'long' })
  const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })
  const groups = []
  for (const t of trips) { const d = day(t.departs_at); if (!groups.length || groups[groups.length - 1][0] !== d) groups.push([d, []]); groups[groups.length - 1][1].push(t) }
  const row = (t) => {
    const sites = JSON.parse(t.sites || '[]').join(' · ')
    const pct = Math.max(t.last_minute_pct || 0, t.early_pct || 0)
    const price = Math.floor((t.price_php * (100 - pct)) / 100)
    const what = t.kind === 'course' ? (t.course_name || L.act.course) : (t.activity && t.activity !== 'scuba' ? L.act[t.activity] : L.dives(t.num_dives))
    const href = `${url.origin}/r/${c.id}?t=${t.id}`
    return `<li><div class="t">${time(t.departs_at)}</div><div class="m"><b>${esc(what)}</b>${sites ? `<span>${esc(sites)}</span>` : ''}<span>${t.available_seats > 0 ? L.seats(t.available_seats) : L.full}</span></div>
<div class="p">₱${price.toLocaleString('en-US')}${pct ? ` <s>₱${t.price_php.toLocaleString('en-US')}</s>` : ''}${t.available_seats > 0 ? `<a class="b" href="${esc(href)}" target="_blank" rel="noopener">${L.book}</a>` : ''}</div></li>`
  }
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c?.name || 'DivingSlot')}</title>
<style>:root{--c:${color}}*{box-sizing:border-box}body{margin:0;font:15px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#10222e;background:#fff}
.w{padding:12px}h1{font-size:17px;margin:0 0 10px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#5d7282;margin:14px 0 6px}
ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #e3ebf0}
.t{font-weight:700;font-size:17px}.m span{display:block;color:#5d7282;font-size:13px}.p{text-align:right;font-weight:700}.p s{color:#8a9aa6;font-weight:400;font-size:12px}
.b{display:block;margin-top:4px;background:var(--c);color:#fff;text-decoration:none;padding:8px 14px;border-radius:10px;font-weight:700;min-height:40px;line-height:24px}
.f{margin-top:12px;font-size:12px;color:#5d7282}.f a{color:inherit}.e{color:#5d7282}</style></head>
<body><div class="w"><h1>${esc(c?.name || '')} · ${L.title}</h1>${groups.length ? groups.map(([d, ts]) => `<h2>${esc(d)}</h2><ul>${ts.map(row).join('')}</ul>`).join('') : `<p class="e">${L.none}</p>`}
<p class="f">${L.by} <a href="${url.origin}/" target="_blank" rel="noopener">DivingSlot</a></p></div></body></html>`
  return new Response(html, { status: c ? 200 : 404, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  } })
}
