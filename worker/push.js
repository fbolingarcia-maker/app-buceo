// Avisos en el móvil (Web Push, RFC 8291 + VAPID RFC 8292) sin dependencias: cifrado aes128gcm con WebCrypto.
// Las claves VAPID se generan solas la primera vez y se guardan en D1 (app_secrets 'vapid'), como AUTH_SECRET.
// notifyUser() manda el aviso a todos los navegadores del usuario; si el servicio responde 404/410 se borra la suscripción.
import { all, first } from './lib/util.js'

const te = new TextEncoder()
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0))
const concat = (...xs) => { const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length } return out }

let vapidCache = null
export async function vapidKeys(env) {
  if (vapidCache) return vapidCache
  const db = env.DB
  await db.prepare('CREATE TABLE IF NOT EXISTS app_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL)').run()
  let row = await first(db, "SELECT value FROM app_secrets WHERE name = 'vapid'")
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey))
    await db.prepare('INSERT OR IGNORE INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)').bind('vapid', JSON.stringify({ jwk, pub }), new Date().toISOString()).run()
    row = await first(db, "SELECT value FROM app_secrets WHERE name = 'vapid'")
  }
  const v = JSON.parse(row.value)
  vapidCache = { pub: v.pub, key: await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) }
  return vapidCache
}
export function _resetVapid() { vapidCache = null }

async function vapidHeader(env, endpoint) {
  const { pub, key } = await vapidKeys(env)
  const aud = new URL(endpoint).origin
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + (env.NOTIFY_TO || 'divingslot@gmail.com') })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`
}

async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8))
}

// Cuerpo cifrado aes128gcm para una suscripción { p256dh, auth }
export async function encryptPayload(sub, data) {
  const uaPub = unb64u(sub.p256dh), authSecret = unb64u(sub.auth)
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPub, asPub), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(te.encode(data), new Uint8Array([2]))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain))
  const rs = new Uint8Array([0, 0, 16, 0]) // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct)
}

export async function sendPush(env, sub, payload) {
  const body = await encryptPayload(sub, JSON.stringify(payload))
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(env, sub.endpoint), TTL: '86400', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Urgency: payload.urgent ? 'high' : 'normal' },
    body,
  })
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run()
  return r.ok
}

// payload: { title, body, url (ruta de la app, p. ej. '/reservas'), tag, urgent }
export async function notifyUser(env, userId, payload) {
  if (!userId || !env?.DB) return 0
  const subs = await all(env.DB, 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', userId).catch(() => [])
  let n = 0
  for (const s of subs) if (await sendPush(env, s, payload).catch((e) => { console.error('push', e.message); return false })) n++
  return n
}
export async function notifyDiver(env, diverId, payload) {
  const d = await first(env.DB, 'SELECT user_id FROM divers WHERE id = ?', diverId)
  return notifyUser(env, d?.user_id, payload)
}
export async function notifyCentreStaff(env, centerId, payload) {
  const users = await all(env.DB, 'SELECT DISTINCT user_id FROM center_staff WHERE center_id = ?', centerId).catch(() => [])
  let n = 0
  for (const u of users) n += await notifyUser(env, u.user_id, payload)
  return n
}
