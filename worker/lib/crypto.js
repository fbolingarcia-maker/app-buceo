// Criptografía del Worker, solo con WebCrypto (sin dependencias):
// contraseñas PBKDF2-SHA256, verificación de los hash bcrypt que vienen de Supabase, TOTP (RFC 6238),
// HMAC, cifrado AES-GCM de los secretos TOTP y tokens aleatorios.
import { P_INIT, S_INIT } from './blowfish-pi.js'

const enc = new TextEncoder()
export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
export const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')

export function randomBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a }
export const randomToken = (n = 32) => b64url(randomBytes(n))
export async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s)) }

// Comparación en tiempo constante
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export async function hmacHex(secret, msg, hash = 'SHA-256') {
  const k = await crypto.subtle.importKey('raw', typeof secret === 'string' ? enc.encode(secret) : secret, { name: 'HMAC', hash }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, typeof msg === 'string' ? enc.encode(msg) : msg))
}

// Claves derivadas de AUTH_SECRET (HKDF) para cada uso: 'mfa' (AES-GCM), 'storage' (firmar enlaces)…
const keyCache = new Map()
async function derived(secret, purpose, usage) {
  const id = purpose + '|' + usage
  if (keyCache.has(id) && keyCache.get(id).secret === secret) return keyCache.get(id).key
  if (!secret || secret.length < 16) throw new Error('AUTH_SECRET no configurado')
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey', 'deriveBits'])
  const params = { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('diveslot'), info: enc.encode(purpose) }
  const key = usage === 'aes'
    ? await crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : new Uint8Array(await crypto.subtle.deriveBits(params, base, 256))
  keyCache.set(id, { secret, key })
  return key
}
export async function encryptSecret(authSecret, plain) {
  const key = await derived(authSecret, 'mfa', 'aes')
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain))
  return b64(iv) + '.' + b64(ct)
}
export async function decryptSecret(authSecret, boxed) {
  const key = await derived(authSecret, 'mfa', 'aes')
  const [iv, ct] = boxed.split('.')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct)))
}
export const signingKey = (authSecret, purpose) => derived(authSecret, purpose, 'bits')

// ── Contraseñas ──
// Formato: pbkdf2$<iteraciones>$<sal b64>$<hash b64>. Workers admite como máximo 100 000 iteraciones.
export async function hashPassword(pw, iter = 100000) {
  const salt = randomBytes(16)
  return `pbkdf2$${iter}$${b64(salt)}$${b64(await pbkdf2(pw, salt, iter))}`
}
async function pbkdf2(pw, salt, iter) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256)
}
// Devuelve { ok, rehash } — rehash = true si el hash es antiguo (bcrypt de Supabase) y hay que guardarlo en PBKDF2
export async function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return { ok: false }
  if (stored.startsWith('pbkdf2$')) {
    const [, iter, salt, hash] = stored.split('$')
    return { ok: safeEqual(b64(await pbkdf2(pw, unb64(salt), +iter)), hash), rehash: false }
  }
  if (stored.startsWith('bcrypt$')) return { ok: safeEqual(bcryptHash(pw, stored.slice(7)), stored.slice(7)), rehash: true }
  return { ok: false }
}

// ── bcrypt (solo para comprobar los hash $2a$/$2b$/$2y$ exportados de Supabase Auth) ──
const BC = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function bcDecode(s, n) {
  const out = []; let i = 0
  const v = (c) => BC.indexOf(c)
  while (out.length < n && i < s.length) {
    const c1 = v(s[i++]), c2 = v(s[i++]); out.push(((c1 << 2) | ((c2 & 0x30) >> 4)) & 0xff); if (out.length >= n || i >= s.length) break
    const c3 = v(s[i++]); out.push((((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2)) & 0xff); if (out.length >= n || i >= s.length) break
    const c4 = v(s[i++]); out.push((((c3 & 0x03) << 6) | c4) & 0xff)
  }
  return Uint8Array.from(out)
}
function bcEncode(d) {
  let s = ''; let i = 0
  while (i < d.length) {
    let c1 = d[i++]; s += BC[(c1 >> 2) & 0x3f]; c1 = (c1 & 0x03) << 4
    if (i >= d.length) { s += BC[c1]; break }
    let c2 = d[i++]; c1 |= (c2 >> 4) & 0x0f; s += BC[c1]; c1 = (c2 & 0x0f) << 2
    if (i >= d.length) { s += BC[c1]; break }
    c2 = d[i++]; c1 |= (c2 >> 6) & 0x03; s += BC[c1]; s += BC[c2 & 0x3f]
  }
  return s
}
export function bcryptHash(pw, setting) {
  const m = /^\$(2[aby])\$(\d\d)\$([./A-Za-z0-9]{22})/.exec(setting || '')
  if (!m) return ''
  const cost = +m[2]
  if (cost < 4 || cost > 16) return ''
  const salt = bcDecode(m[3], 16)
  const pwBytes = enc.encode(pw)
  const key = new Uint8Array(Math.min(pwBytes.length + 1, 72)); key.set(pwBytes.subarray(0, 72)) // termina en 0
  const P = Uint32Array.from(P_INIT), S = Uint32Array.from(S_INIT)
  const F = (x) => ((((S[x >>> 24] + S[256 | ((x >>> 16) & 0xff)]) ^ S[512 | ((x >>> 8) & 0xff)]) + S[768 | (x & 0xff)]) >>> 0)
  const lr = new Uint32Array(2)
  const encipher = () => {
    let l = lr[0], r = lr[1]
    l ^= P[0]
    for (let i = 1; i <= 16; i += 2) { r ^= F(l) ^ P[i]; l ^= F(r) ^ P[i + 1] }
    lr[0] = r ^ P[17]; lr[1] = l
  }
  const stream = (data) => { let pos = 0; return () => { let w = 0; for (let i = 0; i < 4; i++) { w = (w << 8) | data[pos]; pos = (pos + 1) % data.length } return w >>> 0 } }
  const expand = (data, sdata) => {
    const k = stream(data)
    for (let i = 0; i < 18; i++) P[i] ^= k()
    const s = sdata && stream(sdata)
    lr[0] = 0; lr[1] = 0
    for (let i = 0; i < 18; i += 2) { if (s) { lr[0] ^= s(); lr[1] ^= s() } encipher(); P[i] = lr[0]; P[i + 1] = lr[1] }
    for (let i = 0; i < 1024; i += 2) { if (s) { lr[0] ^= s(); lr[1] ^= s() } encipher(); S[i] = lr[0]; S[i + 1] = lr[1] }
  }
  expand(key, salt)
  for (let r = 0, n = 1 << cost; r < n; r++) { expand(key); expand(salt) }
  const ctext = Uint32Array.from([0x4f727068, 0x65616e42, 0x65686f6c, 0x64657253, 0x63727944, 0x6f756274]) // "OrpheanBeholderScryDoubt"
  for (let i = 0; i < 64; i++) for (let j = 0; j < 6; j += 2) { lr[0] = ctext[j]; lr[1] = ctext[j + 1]; encipher(); ctext[j] = lr[0]; ctext[j + 1] = lr[1] }
  const out = new Uint8Array(24)
  for (let i = 0; i < 6; i++) { out[i * 4] = ctext[i] >>> 24; out[i * 4 + 1] = ctext[i] >>> 16; out[i * 4 + 2] = ctext[i] >>> 8; out[i * 4 + 3] = ctext[i] }
  return `$${m[1]}$${m[2]}$${m[3]}${bcEncode(out.subarray(0, 23))}`
}

// ── TOTP (Google Authenticator, Microsoft Authenticator, 1Password…) ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32(bytes) {
  let bits = 0, val = 0, s = ''
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { s += B32[(val >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) s += B32[(val << (5 - bits)) & 31]
  return s
}
export function unbase32(s) {
  const out = []; let bits = 0, val = 0
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8 } }
  return Uint8Array.from(out)
}
export async function totpAt(secretB32, step) {
  const msg = new Uint8Array(8)
  let x = step
  for (let i = 7; i >= 0; i--) { msg[i] = x & 0xff; x = Math.floor(x / 256) }
  const k = await crypto.subtle.importKey('raw', unbase32(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg))
  const o = h[19] & 0xf
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6
  return String(code).padStart(6, '0')
}
// Comprueba el código con ±1 intervalo de 30 s. Devuelve el intervalo usado (para no aceptarlo dos veces) o 0
export async function totpVerify(secretB32, code, lastStep = 0, now = Date.now()) {
  if (!/^\d{6}$/.test(code || '')) return 0
  const cur = Math.floor(now / 30000)
  for (const s of [cur, cur - 1, cur + 1]) if (s > lastStep && safeEqual(await totpAt(secretB32, s), code)) return s
  return 0
}
