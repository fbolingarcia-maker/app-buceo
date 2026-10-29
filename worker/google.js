// Acceso con Google en el backend de Cloudflare (equivale al proveedor «google» de Supabase Auth + migración 033).
//
//   GET /api/auth/oauth/google?redirect=…   → Google (OAuth 2.0 con PKCE y state en una cookie firmada de 10 min)
//   GET /api/auth/callback/google?code&state → crea o enlaza la cuenta, abre la sesión y vuelve a la app
//
// Configuración del Worker: GOOGLE_CLIENT_ID (variable, es pública) y GOOGLE_CLIENT_SECRET (secreto).
// En Google Cloud, el cliente web tiene que tener como URI de redirección https://divingslot.com/api/auth/callback/google.
//
// Reglas (las mismas que Supabase):
// - Si ya hay una cuenta con ese email, se enlaza (y se completa la foto y el nombre si faltaban).
//   Si esa cuenta no tenía el email confirmado, se borra su contraseña: Google ya ha confirmado que el email es de quien entra.
// - Si no hay cuenta, se crea como buceador con nombre, email, foto e idioma de Google, con el email confirmado.
import { nowIso, uuid, first, run, parseCookies } from './lib/util.js'
import { randomToken, hmacHex, b64url } from './lib/crypto.js'

const OAUTH_COOKIE = '__Host-ds_oauth'
const APP_LANGS = ['en', 'es', 'tl', 'de', 'fr', 'it', 'nl', 'pt', 'ru', 'zh', 'ja', 'ko']

const cookie = (v, maxAge) => `${OAUTH_COOKIE}=${v ? encodeURIComponent(v) : ''}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${v ? maxAge : 0}`
const callbackUrl = (origin) => origin + '/api/auth/callback/google'
const enc = new TextEncoder()

// A dónde volver: solo a la propia web. La raíz (siteUrl) es la landing: se va a la app, que manda a donde estaba el usuario.
function backTo(origin, to) {
  try {
    const u = new URL(to || '', origin)
    if (u.origin === origin && u.pathname.startsWith('/app/')) return u.toString()
  } catch (e) { /* inválida */ }
  return origin + '/app/#/login'
}
const fail = (origin, msg) => new Response(null, { status: 302, headers: {
  Location: origin + '/app/?error_description=' + encodeURIComponent(msg) + '#/login', 'Set-Cookie': cookie('', 0), 'Cache-Control': 'no-store' } })

export function googleConfigured(env) { return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_SECRET) }

export async function googleStart(req, env) {
  const url = new URL(req.url)
  if (!googleConfigured(env)) return fail(url.origin, 'El acceso con Google no está configurado')
  const state = randomToken(24)
  const verifier = randomToken(48)
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))
  const payload = b64url(enc.encode(JSON.stringify({ s: state, v: verifier, r: backTo(url.origin, url.searchParams.get('redirect')), e: Date.now() + 600e3 })))
  const sig = await hmacHex(env.AUTH_SECRET, 'oauth:' + payload)
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: callbackUrl(url.origin), response_type: 'code', scope: 'openid email profile',
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: url.searchParams.get('prompt') || 'select_account',
  })
  return new Response(null, { status: 302, headers: { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'Set-Cookie': cookie(payload + '.' + sig, 600), 'Cache-Control': 'no-store' } })
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1]
  if (!part) return null
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) } catch (e) { return null }
}

// newSession y createDiver vienen de auth.js (se pasan para no crear un import circular)
export async function googleCallback(req, env, { newSession, createDiver, notify }) {
  const url = new URL(req.url)
  const origin = url.origin
  if (!googleConfigured(env)) return fail(origin, 'El acceso con Google no está configurado')
  if (url.searchParams.get('error')) return fail(origin, url.searchParams.get('error') === 'access_denied' ? 'Has cancelado el acceso con Google' : 'Google no ha permitido el acceso')
  // state y PKCE desde la cookie firmada
  const raw = parseCookies(req)[OAUTH_COOKIE] || ''
  const [payload, sig] = raw.split('.')
  if (!payload || !sig || sig !== await hmacHex(env.AUTH_SECRET, 'oauth:' + payload)) return fail(origin, 'La sesión con Google ha caducado. Vuelve a intentarlo')
  let st
  try { st = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) } catch (e) { st = null }
  if (!st || st.e < Date.now() || st.s !== url.searchParams.get('state')) return fail(origin, 'La sesión con Google ha caducado. Vuelve a intentarlo')
  // Código → id_token (directo a Google por TLS: no hace falta comprobar la firma del token, sí sus datos)
  let tok
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      code: url.searchParams.get('code') || '', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(origin), grant_type: 'authorization_code', code_verifier: st.v }) })
    tok = await r.json()
    if (!r.ok) throw new Error(tok?.error || 'token ' + r.status)
  } catch (e) { console.error('google token', e.message); return fail(origin, 'No hemos podido entrar con Google. Vuelve a intentarlo') }
  const p = decodeJwtPayload(tok.id_token)
  const iss = p?.iss === 'https://accounts.google.com' || p?.iss === 'accounts.google.com'
  if (!p || !iss || p.aud !== env.GOOGLE_CLIENT_ID || !p.sub || (p.exp || 0) * 1000 < Date.now() - 60e3) return fail(origin, 'No hemos podido entrar con Google. Vuelve a intentarlo')
  const email = String(p.email || '').trim().toLowerCase()
  if (!email || p.email_verified === false || p.email_verified === 'false') return fail(origin, 'Tu cuenta de Google no tiene un email verificado')
  const name = String(p.name || [p.given_name, p.family_name].filter(Boolean).join(' ') || '').trim().slice(0, 120) || null
  const avatar = typeof p.picture === 'string' && /^https:\/\//.test(p.picture) ? p.picture.slice(0, 500) : null
  const locale = typeof p.locale === 'string' ? p.locale.slice(0, 20) : null

  let u = await first(env.DB, 'SELECT * FROM users WHERE google_sub = ?', p.sub)
  if (!u) {
    const existing = await first(env.DB, 'SELECT * FROM users WHERE email = ?', email)
    if (existing) {
      // Enlazar con la cuenta que ya existe (si no estaba confirmada, su contraseña deja de valer)
      await run(env.DB, `UPDATE users SET google_sub = ?, email_confirmed_at = coalesce(email_confirmed_at, ?),
        password_hash = CASE WHEN email_confirmed_at IS NULL THEN NULL ELSE password_hash END WHERE id = ?`, p.sub, nowIso(), existing.id)
      await run(env.DB, `UPDATE divers SET avatar_url = coalesce(avatar_url, ?),
        full_name = CASE WHEN ? IS NOT NULL AND full_name = ? THEN ? ELSE full_name END WHERE user_id = ?`,
        avatar, name, email.split('@')[0], name, existing.id)
      u = await first(env.DB, 'SELECT * FROM users WHERE id = ?', existing.id)
    } else {
      const meta = { full_name: name, name, avatar_url: avatar, locale, email_verified: true }
      u = { id: uuid(), email }
      await run(env.DB, `INSERT INTO users (id, email, password_hash, email_confirmed_at, user_metadata, provider, google_sub) VALUES (?, ?, NULL, ?, ?, 'google', ?)`,
        u.id, email, nowIso(), JSON.stringify(meta), p.sub)
      const lang = String(locale || '').toLowerCase().replace('_', '-').split('-')[0]
      await createDiver(env, u, { ...meta, account_type: 'diver' }, { provider: 'google', avatar, languages: APP_LANGS.includes(lang) ? [lang] : [] })
      await notify(env, u, { full_name: name || email.split('@')[0], account_type: 'diver', provider: 'google' })
      u = await first(env.DB, 'SELECT * FROM users WHERE id = ?', u.id)
    }
  }
  await run(env.DB, 'UPDATE users SET last_sign_in_at = ? WHERE id = ?', nowIso(), u.id)
  const session = await newSession(env, req, u.id)
  const h = new Headers({ Location: backTo(origin, st.r), 'Cache-Control': 'no-store' })
  h.append('Set-Cookie', session)
  h.append('Set-Cookie', cookie('', 0))
  return new Response(null, { status: 302, headers: h })
}

