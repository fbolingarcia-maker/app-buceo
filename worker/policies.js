// Autorización (sustituye a las políticas RLS de Supabase). Denegado por defecto.
// Cada política es un predicado SQL sobre el alias de la fila: sirve para filtrar lecturas (USING)
// y para comprobar filas nuevas o modificadas (WITH CHECK), evaluándolo sobre los valores de la fila.
// Equivalencias: is_staff(x) → x IN (centros del usuario), my_diver_id() → ctx.diverId, is_platform_admin() → ctx.isAdmin.
// Como en Supabase (mfa_ok), con la verificación en dos pasos activada y sin el código, todo se deniega (ver rest.js).

const NO = { sql: '0', params: [] }
const YES = { sql: '1', params: [] }
const or = (...ps) => {
  const live = ps.filter((p) => p && p.sql !== '0')
  if (live.some((p) => p.sql === '1')) return YES
  if (!live.length) return NO
  return { sql: '(' + live.map((p) => p.sql).join(' OR ') + ')', params: live.flatMap((p) => p.params) }
}
const and = (...ps) => {
  if (ps.some((p) => p.sql === '0')) return NO
  const live = ps.filter((p) => p.sql !== '1')
  if (!live.length) return YES
  return { sql: '(' + live.map((p) => p.sql).join(' AND ') + ')', params: live.flatMap((p) => p.params) }
}
const P = (sql, ...params) => ({ sql, params })

// Fragmentos (equivalentes a las funciones auxiliares de la base de datos)
const staffIn = (ctx, col) => (ctx.staff.length ? P(`${col} IN (${ctx.staff.map(() => '?').join(',')})`, ...ctx.staff) : NO)
const admin = (ctx) => (ctx.isAdmin ? YES : NO)
const me = (ctx, col) => (ctx.uid ? P(`${col} = ?`, ctx.uid) : NO)
const myDiver = (ctx, col) => (ctx.diverId ? P(`${col} = ?`, ctx.diverId) : NO)
const staffTrip = (ctx, col) => (ctx.staff.length ? P(`${col} IN (SELECT id FROM trips WHERE center_id IN (${ctx.staff.map(() => '?').join(',')}))`, ...ctx.staff) : NO)
const staffSeesDiver = (ctx, col) => (ctx.staff.length
  ? P(`${col} IN (SELECT b.diver_id FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.diver_id IS NOT NULL AND t.center_id IN (${ctx.staff.map(() => '?').join(',')}))`, ...ctx.staff)
  : NO)
const diverBookedCenter = (ctx, col) => (ctx.diverId ? P(`${col} IN (SELECT t.center_id FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.diver_id = ?)`, ctx.diverId) : NO)
const hasBookingOn = (ctx, col) => (ctx.diverId ? P(`${col} IN (SELECT trip_id FROM bookings WHERE diver_id = ?)`, ctx.diverId) : NO)

// select: lectura · write: USING de update/delete · check: WITH CHECK de insert/update
// ops: operaciones de escritura permitidas por REST (las demás solo con RPC)
export const POLICIES = {
  destinations: { select: () => YES },
  dive_sites: { select: () => YES },
  app_config: { select: () => YES },
  published_trips: { select: () => YES },
  boats: { select: () => YES, ops: ['insert', 'update', 'delete'],
    write: (c, a) => staffIn(c, `${a}.center_id`), check: (c, a) => staffIn(c, `${a}.center_id`) },
  trip_sites: { select: () => YES, ops: ['insert', 'update', 'delete'],
    write: (c, a) => staffTrip(c, `${a}.trip_id`), check: (c, a) => staffTrip(c, `${a}.trip_id`) },
  trips: { ops: ['insert', 'update', 'delete'],
    select: (c, a) => or(P(`${a}.status = 'published'`), staffIn(c, `${a}.center_id`), admin(c), hasBookingOn(c, `${a}.id`)),
    write: (c, a) => staffIn(c, `${a}.center_id`), check: (c, a) => staffIn(c, `${a}.center_id`) },
  centers: { ops: ['update'],
    select: (c, a) => or(P(`${a}.listing_status = 'directorio'`), P(`${a}.verification_status = 'verified'`), staffIn(c, `${a}.id`), admin(c), diverBookedCenter(c, `${a}.id`)),
    write: (c, a) => staffIn(c, `${a}.id`), check: (c, a) => staffIn(c, `${a}.id`) },
  center_staff: { select: (c, a) => me(c, `${a}.user_id`) },
  platform_admins: { select: (c, a) => me(c, `${a}.user_id`) },
  admin_audit: { select: (c) => admin(c) },
  center_verifications: { ops: ['insert', 'update', 'delete'],
    select: (c, a) => or(staffIn(c, `${a}.center_id`), admin(c)),
    write: (c, a) => or(staffIn(c, `${a}.center_id`), admin(c)), check: (c, a) => or(staffIn(c, `${a}.center_id`), admin(c)) },
  center_documents: { ops: ['insert', 'update', 'delete'],
    select: (c, a) => or(staffIn(c, `${a}.center_id`), admin(c)),
    write: (c, a) => or(staffIn(c, `${a}.center_id`), admin(c)), check: (c, a) => staffIn(c, `${a}.center_id`) },
  divers: { ops: ['insert', 'update', 'delete'],
    select: (c, a) => or(admin(c), staffSeesDiver(c, `${a}.id`), me(c, `${a}.user_id`)),
    write: (c, a) => me(c, `${a}.user_id`), check: (c, a) => me(c, `${a}.user_id`) },
  certifications: { ops: ['insert', 'update', 'delete'],
    select: (c, a) => or(admin(c), staffSeesDiver(c, `${a}.diver_id`), myDiver(c, `${a}.diver_id`)),
    write: (c, a) => myDiver(c, `${a}.diver_id`),
    check: (c, a) => and(myDiver(c, `${a}.diver_id`), P(`${a}.verified_by IS NULL AND ${a}.verified_at IS NULL`)) },
  bookings: {
    select: (c, a) => or(admin(c), staffTrip(c, `${a}.trip_id`), myDiver(c, `${a}.diver_id`)) },
  payments: {
    select: (c, a) => or(admin(c),
      c.staff.length ? P(`${a}.booking_id IN (SELECT b.id FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE t.center_id IN (${c.staff.map(() => '?').join(',')}))`, ...c.staff) : NO,
      c.diverId ? P(`${a}.booking_id IN (SELECT id FROM bookings WHERE diver_id = ?)`, c.diverId) : NO) },
  dive_logs: { ops: ['insert', 'update', 'delete'],
    select: (c, a) => or(and(P(`${a}.share_with_center = 1 AND ${a}.center_id IS NOT NULL`), staffIn(c, `${a}.center_id`)), myDiver(c, `${a}.diver_id`)),
    write: (c, a) => myDiver(c, `${a}.diver_id`), check: (c, a) => myDiver(c, `${a}.diver_id`) },
  dive_log_photos: { ops: ['insert', 'update', 'delete'],
    select: (c, a) => (c.diverId ? P(`${a}.log_id IN (SELECT id FROM dive_logs WHERE diver_id = ?)`, c.diverId) : NO),
    write: (c, a) => (c.diverId ? P(`${a}.log_id IN (SELECT id FROM dive_logs WHERE diver_id = ?)`, c.diverId) : NO),
    check: (c, a) => (c.diverId ? P(`${a}.log_id IN (SELECT id FROM dive_logs WHERE diver_id = ?)`, c.diverId) : NO) },
}

// Columnas que no se leen nunca por REST (solo con RPC): datos privados del centro
export const HIDDEN = { centers: ['gcash_number', 'notes', 'review_note'] }
// Columnas que solo cambian las RPC de la plataforma (port de protect_center_columns)
export const PROTECTED = { centers: ['verification_status', 'verified_at', 'claims_center_id', 'listing_status', 'review_note'] }

export { NO, YES, or, and, P }
