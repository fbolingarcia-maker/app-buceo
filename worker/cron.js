// Tarea programada (Cron Trigger, cada hora): limpieza. Las retenciones de plaza de 15 min no necesitan cron:
// se calculan al leer (holds_seat), igual que en Supabase.
import { nowIso } from './lib/util.js'

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
}
