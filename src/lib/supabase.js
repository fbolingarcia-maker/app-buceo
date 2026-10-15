import { createClient } from '@supabase/supabase-js'
import { t } from './i18n'

// Claves PÚBLICAS (publishable). La seguridad está en RLS y en las funciones de la base de datos.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://tosgzcpnkpsrrkfqctgy.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_QVcivbJNNX5TmEet6jv19A_uDR45c7R'

export const supabase = createClient(url, key, {
  // flujo implícito: el enlace del email funciona aunque se abra en otro navegador/dispositivo
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
})

// URL a la que vuelven los emails de confirmación / recuperación
export const appUrl = () => window.location.origin + import.meta.env.BASE_URL

// Convierte "NO_SEATS: solo quedan 2 plazas" en "Solo quedan 2 plazas" (traducido al idioma activo)
export function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e)
  const i = m.indexOf(': ')
  const raw = /^[A-Z_]+: /.test(m) ? m.slice(i + 2) : m
  const map = {
    NOT_FOUND: 'No encontrado',
    FORBIDDEN: 'No tienes permiso para esto',
    BAD_STATE: 'Ese cambio no es posible ahora',
    BAD_SEATS: 'Número de plazas no válido',
    BAD_SOURCE: 'Origen no válido',
    'Invalid login credentials': 'Email o contraseña incorrectos',
    'User already registered': 'Ese email ya tiene cuenta',
    'Email not confirmed': 'Confirma tu email (revisa tu bandeja de entrada)',
    'Failed to fetch': 'Sin conexión. Revisa tu internet e inténtalo de nuevo',
  }
  if (map[raw]) return t(map[raw])
  const seats = raw.match(/^solo quedan (\d+) plazas( en el barco)?$/)
  if (seats) return t(seats[2] ? 'Solo quedan {n} plazas en el barco' : 'Solo quedan {n} plazas', { n: seats[1] })
  const txt = raw.charAt(0).toUpperCase() + raw.slice(1)
  return t(txt)
}
