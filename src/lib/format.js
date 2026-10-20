import { t, locale } from './i18n'

export const TZ = 'Asia/Manila'

export const LEVELS = [
  ['open_water', 'Open Water'],
  ['advanced', 'Advanced'],
  ['rescue', 'Rescue'],
  ['divemaster', 'Divemaster'],
  ['instructor', 'Instructor'],
]
export const levelName = (l) => (LEVELS.find(([k]) => k === l) || [, l])[1]
export const levelRank = (l) => LEVELS.findIndex(([k]) => k === l)

export const SOURCES = [
  ['whatsapp', 'WhatsApp'],
  ['walk_in', 'Mostrador'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
]
export const sourceName = (s) => (s === 'app' ? 'App' : t((SOURCES.find(([k]) => k === s) || [, s])[1]))

// Los textos se traducen al leerlos: BOOKING_STATUS[x] devuelve el texto en el idioma activo
const translated = (o) => new Proxy(o, { get: (obj, k) => (typeof obj[k] === 'string' ? t(obj[k]) : obj[k]) })

export const BOOKING_STATUS = translated({
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  cancelled_by_diver: 'Cancelada por ti',
  cancelled_by_center: 'Cancelada por el centro',
})
export const TRIP_STATUS = translated({
  draft: 'Borrador',
  published: 'Publicada',
  cancelled_weather: 'Cancelada por meteo',
  completed: 'Completada',
})

export const php = (n) => '₱' + Number(n || 0).toLocaleString('en-PH')

// Fecha "YYYY-MM-DD" en hora de Manila
export function manilaDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
}
export function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00+08:00')
  d.setUTCDate(d.getUTCDate() + n)
  return manilaDate(d)
}
// Rango UTC [inicio, fin) de un día de Manila
export function dayRange(ymd) {
  return [new Date(ymd + 'T00:00:00+08:00').toISOString(), new Date(addDays(ymd, 1) + 'T00:00:00+08:00').toISOString()]
}
// "YYYY-MM-DD" + "HH:MM" (hora Manila) -> ISO UTC
export const manilaToIso = (ymd, hm) => new Date(`${ymd}T${hm}:00+08:00`).toISOString()

export const time = (iso) =>
  new Intl.DateTimeFormat(locale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
export const dayLabel = (ymd, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Intl.DateTimeFormat(locale(), { timeZone: TZ, ...opts }).format(new Date(ymd + 'T12:00:00+08:00'))
export const dateTime = (iso) =>
  new Intl.DateTimeFormat(locale(), { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

// Color de la escala de profundidad según el nivel mínimo (límites reales de cada certificación)
export const levelColor = (l) => ({ open_water: 'var(--depth-2)', advanced: 'var(--depth-3)', rescue: 'var(--depth-3)', divemaster: 'var(--depth-4)', instructor: 'var(--depth-4)' })[l] || 'var(--depth-2)'
// Iniciales de un centro para su avatar, sin palabras genéricas (Dive, Divers, Center…)
export const initials = (name) => (name || '').split(/\s+/).filter((w) => /^[\p{L}]/u.test(w) && !/^(dive|divers|diving|center|centre|resort)$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·'
// Color de la escala de profundidad para una profundidad en metros
export const depthColor = (m) => (m <= 5 ? 'var(--depth-1)' : m <= 18 ? 'var(--depth-2)' : m <= 30 ? 'var(--depth-3)' : m <= 40 ? 'var(--depth-4)' : 'var(--depth-5)')

