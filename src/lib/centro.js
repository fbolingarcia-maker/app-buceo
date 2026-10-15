// Utilidades compartidas por las pantallas del centro
const HOLD_MS = 15 * 60000

// ¿La reserva ocupa plaza? (confirmada, o sin pagar dentro del tiempo de retención)
export const holds = (b) =>
  b.status === 'confirmed' ||
  (b.status === 'pending_payment' &&
    Math.max(new Date(b.created_at).getTime() + HOLD_MS, b.hold_until ? new Date(b.hold_until).getTime() : 0) > Date.now())

export function seatsSummary(t) {
  const operative = Math.max(0, Math.min(t.boats?.capacity ?? 99, t.guides * t.divers_per_guide, t.seat_override ?? 32767))
  const live = (t.bookings || []).filter(holds)
  const manual = live.filter((b) => b.source !== 'app').reduce((s, b) => s + b.seats, 0)
  const app = live.filter((b) => b.source === 'app').reduce((s, b) => s + b.seats, 0)
  const appFree = t.status === 'published' ? Math.max(0, operative - Math.max(t.blocked_seats, manual) - app) : 0
  const booked = manual + app
  return { operative, manual, app, booked, appFree, boatFree: Math.max(0, operative - booked) }
}

// Totales de dinero de una lista de reservas activas
export function money(bookings) {
  const live = bookings.filter(holds)
  const total = live.reduce((s, b) => s + b.amount_php, 0)
  const paid = live.reduce((s, b) => s + (b.paid_php || 0), 0)
  return { total, paid, pending: total - paid }
}

// Parámetro ?clave=valor del hash (#/centro/agenda?dia=2026-10-16)
export const hashParam = (k) => new URLSearchParams(window.location.hash.split('?')[1] || '').get(k)

export const TRIP_SELECT =
  '*, boats(name, capacity), trip_sites(position, dive_sites(name)), bookings(*, divers(full_name, logged_dives, languages, certifications(id, agency, level, verified_at)))'
