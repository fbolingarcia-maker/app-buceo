import { createClient } from '@supabase/supabase-js'
import { createCfClient } from './cf-client'
import { t } from './i18n'

// Backend: Supabase (por defecto) o la API propia en Cloudflare (Worker + D1 + R2) si se compila con
// VITE_BACKEND=cloudflare. Las dos tienen la misma forma, así que las pantallas no cambian.
export const BACKEND = import.meta.env.VITE_BACKEND === 'cloudflare' ? 'cloudflare' : 'supabase'

// Claves PÚBLICAS (publishable). La seguridad está en RLS y en las funciones de la base de datos.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://tosgzcpnkpsrrkfqctgy.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_QVcivbJNNX5TmEet6jv19A_uDR45c7R'

export const supabase = BACKEND === 'cloudflare' ? createCfClient() : createClient(url, key, {
  // flujo implícito: el enlace del email funciona aunque se abra en otro navegador/dispositivo
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
})

// Raíz del sitio (la landing): a ella vuelven los emails de confirmación / recuperación y los pagos; la landing
// reenvía a la app todo lo que llega con #… Así no hay que cambiar las URLs permitidas en Supabase ni en PayMongo.
export const siteUrl = () => window.location.origin + import.meta.env.BASE_URL
// La app vive en /app/ (enlaces para compartir)
export const appUrl = () => siteUrl() + 'app/'

// Contraseñas nuevas: lo mismo que exige Supabase (mínimo 8, letras y números). Devuelve el problema o ''
export function pwProblem(pw) {
  if (!pw || pw.length < 8) return t('Mínimo 8 caracteres, con letras y números')
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return t('La contraseña necesita letras y números')
  return ''
}

// Convierte "NO_SEATS: solo quedan 2 plazas" en "Solo quedan 2 plazas" (traducido al idioma activo)
export function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e)
  // Errores de Auth en inglés: contraseña débil, repetida o código de dos pasos incorrecto
  if (e?.code === 'weak_password' || /^Password should/i.test(m)) return t('La contraseña es demasiado débil: usa al menos 8 caracteres, con letras y números')
  // Envío de emails (confirmación y recuperación)
  if (e?.code === 'over_email_send_rate_limit' || /email rate limit exceeded/i.test(m)) return t('Hemos enviado demasiados emails en poco tiempo. Espera unos minutos y vuelve a intentarlo.')
  if (/error sending (confirmation|recovery|magic link|email change) email/i.test(m)) return t('No hemos podido enviar el email ahora mismo. Inténtalo de nuevo más tarde.')
  if (e?.code === 'over_request_rate_limit') return t('Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.')
  if (e?.code === 'same_password' || /should be different from the old password/i.test(m)) return t('La nueva contraseña debe ser distinta de la actual')
  if (/invalid totp code|mfa_verification_failed|code.*(expired|invalid)/i.test(m) || e?.code === 'mfa_verification_failed') return t('Código incorrecto o caducado. Prueba con el código actual de tu app.')
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
