// Utilidades HTTP y de base de datos del Worker
import { TYPES } from '../schema.js'

// Error de negocio con el formato de las RPC de Supabase: «CODIGO: mensaje» (errMsg() del frontend lo traduce)
export class ApiError extends Error {
  constructor(code, msg, status = 400) { super(msg ? `${code}: ${msg}` : code); this.code = code; this.status = status }
}
export const fail = (code, msg, status) => { throw new ApiError(code, msg, status) }

export const nowIso = () => new Date().toISOString()
export const addMin = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString()
export const uuid = () => crypto.randomUUID()

export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
}
export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra } })
}
export function errorResponse(e) {
  if (e instanceof ApiError) return json({ error: { message: e.message, code: e.code } }, e.status)
  const m = String(e?.message || e)
  // Restricciones de SQLite → mismos códigos que daba Postgres
  if (/UNIQUE constraint failed/i.test(m)) return json({ error: { message: 'DUPLICATE: ya existe', code: '23505' } }, 409)
  if (/CHECK constraint failed|NOT NULL constraint failed/i.test(m)) return json({ error: { message: 'BAD_DATA: algún dato no es válido', code: '23514' } }, 400)
  if (/FOREIGN KEY constraint failed/i.test(m)) return json({ error: { message: 'BAD_STATE: hay datos relacionados', code: '23503' } }, 409)
  console.error('api', m)
  return json({ error: { message: 'No se pudo completar. Inténtalo de nuevo.', code: 'INTERNAL' } }, 500)
}

export function parseCookies(req) {
  const out = {}
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}
export const SESSION_COOKIE = '__Host-ds_session'
export const sessionCookie = (token, maxAge) =>
  `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? maxAge : 0}`

// ── D1 ──
// Convierte una fila de SQLite (0/1, texto JSON) a lo que esperaba el frontend de Supabase (booleanos, arrays)
export function outRow(table, row) {
  if (!row) return row
  const types = TYPES[table] || {}
  const o = { ...row }
  for (const [k, v] of Object.entries(o)) {
    const ty = types[k]
    if (v === null || v === undefined) continue
    if (ty === 'bool') o[k] = v === 1 || v === true || v === '1'
    else if (ty === 'json' && typeof v === 'string') { try { o[k] = JSON.parse(v) } catch (e) { /* texto tal cual */ } }
  }
  return o
}
// Valor de JS → SQLite según el tipo de la columna
export function inVal(table, col, v) {
  const ty = TYPES[table]?.[col]
  if (v === undefined) return null
  if (v === null) return null
  if (ty === 'bool') return v === true || v === 1 || v === 'true' ? 1 : 0
  if (ty === 'json') return typeof v === 'string' ? v : JSON.stringify(v)
  if (ty === 'ts' && v) { const d = new Date(v); return isNaN(d) ? v : d.toISOString() }
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

export const all = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).all()).results || []
export const first = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).first()) || null
export const run = (db, sql, ...params) => db.prepare(sql).bind(...params).run()
export const changes = (r) => r?.meta?.changes ?? 0
