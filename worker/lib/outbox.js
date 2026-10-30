// Avisos e importación desde Supabase SIN clave compartida: Supabase guarda el contenido en private.outbox y manda al
// Worker solo { claim: <uuid> }. El Worker lo recoge con la RPC pública outbox_claim(uuid) (migración 035), que lo
// devuelve una sola vez y solo durante 30 minutos. Nadie puede colar contenido: solo vale lo que la propia base de
// datos de Supabase ha puesto en la cola, y el uuid aleatorio no se puede adivinar.
import { fail } from './util.js'

const SUPABASE_URL = 'https://tosgzcpnkpsrrkfqctgy.supabase.co'
const SUPABASE_KEY = 'sb_publishable_QVcivbJNNX5TmEet6jv19A_uDR45c7R' // clave publishable: es pública

export async function claimFromSupabase(env, id, kind) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) fail('INVALID', 'claim no válido')
  const r = await fetch((env.SUPABASE_URL || SUPABASE_URL) + '/rest/v1/rpc/outbox_claim', {
    method: 'POST',
    headers: { apikey: env.SUPABASE_KEY || SUPABASE_KEY, Authorization: 'Bearer ' + (env.SUPABASE_KEY || SUPABASE_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_id: id }),
  }).catch(() => null)
  if (!r?.ok) fail('UPSTREAM', 'no se pudo recoger el aviso de Supabase', 502)
  const j = await r.json().catch(() => null)
  if (!j || j.kind !== kind || typeof j.body !== 'object') fail('FORBIDDEN', 'aviso desconocido o ya recogido', 403)
  return j.body
}

// ¿Viene con la clave X-Notify-Key correcta? (se sigue aceptando si el Worker tiene NOTIFY_KEY)
import { safeEqual } from './crypto.js'
export const hasNotifyKey = (req, env) => !!env.NOTIFY_KEY && safeEqual(req.headers.get('X-Notify-Key') || '', env.NOTIFY_KEY)
