// Cuentas y sesiones (sustituye a Supabase Auth): alta con confirmación por email, entrada, salida,
// nueva contraseña, verificación en dos pasos (TOTP) y la sesión de cada petición (ctx).
import { ApiError, fail, json, nowIso, uuid, all, first, run, changes, parseCookies, SESSION_COOKIE, sessionCookie } from './lib/util.js'
import { hashPassword, verifyPassword, randomToken, sha256, encryptSecret, decryptSecret, base32, randomBytes, totpVerify } from './lib/crypto.js'
import { qrSvgDataUrl } from './lib/qr.js'
import { sendEmail, TEMPLATES } from './email.js'

const SESSION_DAYS = 30
const TOKEN_HOURS = { confirm: 24, recovery: 1 }

// ── Sesión de la petición ──
export async function loadCtx(req, env) {
  const ctx = { db: env.DB, env, uid: null, email: null, aal: null, mfaOk: true, hasFactor: false, isAdmin: false, diverId: null, staff: [], session: null }
  const token = parseCookies(req)[SESSION_COOKIE]
  if (!token) return ctx
  const sid = await sha256(token)
  const s = await first(env.DB, `SELECT s.*, u.email, u.user_metadata, u.provider, u.email_confirmed_at, u.created_at AS user_created_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`, sid, nowIso())
  if (!s) return ctx
  ctx.session = s
  ctx.uid = s.user_id
  ctx.email = s.email
  ctx.aal = s.aal
  ctx.hasFactor = !!(await first(env.DB, "SELECT 1 AS x FROM mfa_factors WHERE user_id = ? AND status = 'verified'", s.user_id))
  ctx.mfaOk = s.aal === 'aal2' || !ctx.hasFactor
  if (ctx.mfaOk) {
    const [adm, dv, st] = await env.DB.batch([
      env.DB.prepare('SELECT 1 AS x FROM platform_admins WHERE user_id = ?').bind(s.user_id),
      env.DB.prepare('SELECT id FROM divers WHERE user_id = ?').bind(s.user_id),
      env.DB.prepare('SELECT center_id FROM center_staff WHERE user_id = ?').bind(s.user_id),
    ])
    ctx.isAdmin = !!adm.results?.length
    ctx.diverId = dv.results?.[0]?.id || null
    ctx.staff = (st.results || []).map((r) => r.center_id)
  }
  // Sesión deslizante: se renueva como mucho una vez al día
  if (Date.parse(s.last_seen_at) < Date.now() - 864e5) {
    ctx.renew = true
    await run(env.DB, 'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', nowIso(), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), sid)
  }
  ctx.sid = sid
  ctx.token = token
  return ctx
}

const userJson = (u) => ({
  id: u.id, email: u.email, user_metadata: safeMeta(u.user_metadata), app_metadata: { provider: u.provider || 'email' },
  email_confirmed_at: u.email_confirmed_at, created_at: u.created_at, aud: 'authenticated',
})
function safeMeta(m) { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}) } catch (e) { return {} } }

async function sessionInfo(ctx) {
  if (!ctx.uid) return { session: null }
  const u = await first(ctx.db, 'SELECT * FROM users WHERE id = ?', ctx.uid)
  const factors = await all(ctx.db, 'SELECT id, status, friendly_name, created_at FROM mfa_factors WHERE user_id = ?', ctx.uid)
  return {
    session: { user: userJson(u), aal: ctx.aal, recovery: !!ctx.session.recovery, expires_at: ctx.session.expires_at },
    aal: { currentLevel: ctx.aal, nextLevel: ctx.hasFactor ? 'aal2' : 'aal1' },
    factors: factors.map((f) => ({ id: f.id, factor_type: 'totp', status: f.status, friendly_name: f.friendly_name, created_at: f.created_at })),
  }
}

async function newSession(env, req, userId, { aal = 'aal1', recovery = false } = {}) {
  const token = randomToken(32)
  await run(env.DB, 'INSERT INTO sessions (id, user_id, aal, recovery, expires_at, ua) VALUES (?, ?, ?, ?, ?, ?)',
    await sha256(token), userId, aal, recovery ? 1 : 0, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), (req.headers.get('User-Agent') || '').slice(0, 200))
  return sessionCookie(token, SESSION_DAYS * 86400)
}

// Límite de intentos (por IP y por email): ventana fija en D1
export async function rateLimit(env, key, max, windowSec) {
  const win = Math.floor(Date.now() / 1000 / windowSec) * windowSec // inicio de la ventana en segundos
  const r = await first(env.DB, `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END, window_start = excluded.window_start
    RETURNING count`, key, win)
  if ((r?.count || 0) > max) throw new ApiError('over_request_rate_limit', 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.', 429)
}

function pwProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return true
  return pw.length > 200
}
const authErr = (code, message, status = 400) => json({ error: { code, message } }, status)
const normEmail = (e) => String(e || '').trim().toLowerCase()
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254

// Solo se vuelve a la propia app (evita redirecciones abiertas)
function safeRedirect(req, to, fallbackHash = '#/') {
  const origin = new URL(req.url).origin
  try { const u = new URL(to, origin); if (u.origin === origin) return u.toString() } catch (e) { /* inválida */ }
  return origin + '/' + fallbackHash
}

async function sendToken(env, req, user, kind, redirect) {
  const token = randomToken(32)
  await run(env.DB, 'INSERT INTO auth_tokens (id, user_id, kind, redirect, expires_at) VALUES (?, ?, ?, ?, ?)',
    await sha256(token), user.id, kind, redirect ? safeRedirect(req, redirect) : null, new Date(Date.now() + TOKEN_HOURS[kind] * 36e5).toISOString())
  const url = `${new URL(req.url).origin}/api/auth/verify?type=${kind}&token=${token}`
  try { await sendEmail(env, user.email, TEMPLATES[kind](url)) } catch (e) {
    console.error('email', e.message)
    throw new ApiError('email_send_failed', kind === 'confirm' ? 'Error sending confirmation email' : 'Error sending recovery email', 500)
  }
}

// Perfil de buceador al crear la cuenta (port de handle_new_user)
async function createDiver(env, user, meta) {
  const name = String(meta.full_name || meta.name || '').trim() || user.email.split('@')[0]
  await run(env.DB, `INSERT INTO divers (id, user_id, full_name, email, auth_provider, locale, account_type) VALUES (?, ?, ?, ?, 'email', ?, ?)
    ON CONFLICT(user_id) DO NOTHING`, uuid(), user.id, name.slice(0, 120), user.email, meta.locale || null, meta.account_type === 'center' ? 'center' : 'diver')
}

export async function handleAuth(req, env, ctx, path) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local'
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}

  if (path === 'session' && req.method === 'GET') {
    const info = await sessionInfo(ctx)
    return json(info)
  }

  if (path === 'signup') {
    await rateLimit(env, 'signup:' + ip, 10, 3600)
    const email = normEmail(body.email)
    if (!validEmail(email)) return authErr('validation_failed', 'Unable to validate email address: invalid format')
    if (pwProblem(body.password)) return authErr('weak_password', 'Password should be at least 8 characters and contain letters and numbers.')
    const meta = {}
    for (const k of ['full_name', 'account_type', 'center_name', 'center_phone', 'locale']) if (typeof body.data?.[k] === 'string') meta[k] = body.data[k].slice(0, 200)
    const existing = await first(env.DB, 'SELECT * FROM users WHERE email = ?', email)
    if (existing) {
      // Igual que Supabase: no se revela si el email ya tiene cuenta; si no la confirmó, se reenvía el email
      if (!existing.email_confirmed_at) { await rateLimit(env, 'mail:' + email, 3, 3600); await sendToken(env, req, existing, 'confirm', body.redirect) }
      return json({ user: { id: uuid(), email, identities: [] }, session: null })
    }
    const user = { id: uuid(), email }
    await run(env.DB, 'INSERT INTO users (id, email, password_hash, user_metadata) VALUES (?, ?, ?, ?)', user.id, email, await hashPassword(body.password, +(env.PBKDF2_ITER || 100000)), JSON.stringify(meta))
    await createDiver(env, user, meta)
    await rateLimit(env, 'mail:' + email, 3, 3600)
    await sendToken(env, req, user, 'confirm', body.redirect)
    return json({ user: { id: user.id, email, user_metadata: meta }, session: null })
  }

  if (path === 'login') {
    const email = normEmail(body.email)
    await rateLimit(env, 'login:' + ip, 30, 900)
    await rateLimit(env, 'login:' + email, 10, 900)
    const u = await first(env.DB, 'SELECT * FROM users WHERE email = ?', email)
    const check = u ? await verifyPassword(String(body.password || ''), u.password_hash) : (await verifyPassword('x', 'pbkdf2$' + (+(env.PBKDF2_ITER || 100000)) + '$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'), { ok: false })
    if (!u || !check.ok) return authErr('invalid_credentials', 'Invalid login credentials')
    if (!u.email_confirmed_at) return authErr('email_not_confirmed', 'Email not confirmed')
    if (check.rehash) await run(env.DB, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(body.password, +(env.PBKDF2_ITER || 100000)), u.id)
    await run(env.DB, 'UPDATE users SET last_sign_in_at = ? WHERE id = ?', nowIso(), u.id)
    const cookie = await newSession(env, req, u.id)
    return json({ user: userJson(u) }, 200, { 'Set-Cookie': cookie })
  }

  if (path === 'logout') {
    if (ctx.sid) await run(env.DB, 'DELETE FROM sessions WHERE id = ?', ctx.sid)
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) })
  }

  if (path === 'resend' || path === 'recover') {
    const email = normEmail(body.email)
    await rateLimit(env, 'mailip:' + ip, 10, 3600)
    const u = validEmail(email) && await first(env.DB, 'SELECT * FROM users WHERE email = ?', email)
    if (u) {
      await rateLimit(env, 'mail:' + email, 3, 3600).catch(() => { throw new ApiError('over_email_send_rate_limit', 'email rate limit exceeded', 429) })
      if (path === 'resend' && !u.email_confirmed_at) await sendToken(env, req, u, 'confirm', body.redirect)
      if (path === 'recover') await sendToken(env, req, u, 'recovery', body.redirect)
    }
    return json({ ok: true })
  }

  // Enlace del email: confirma la cuenta o abre la sesión para crear una contraseña nueva
  if (path === 'verify' && req.method === 'GET') {
    const url = new URL(req.url)
    const kind = url.searchParams.get('type')
    const id = await sha256(url.searchParams.get('token') || '')
    const tok = await first(env.DB, 'SELECT * FROM auth_tokens WHERE id = ? AND kind = ?', id, kind)
    const back = (hash, err) => Response.redirect(new URL(req.url).origin + '/' + hash + (err ? (hash.includes('?') ? '&' : '?') + 'error_description=' + encodeURIComponent(err) : ''), 302)
    if (!tok || tok.used_at || tok.expires_at < nowIso()) return back('#/', 'Email link is invalid or has expired')
    const r = await run(env.DB, 'UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', nowIso(), id)
    if (!changes(r)) return back('#/', 'Email link is invalid or has expired')
    if (kind === 'confirm') await run(env.DB, 'UPDATE users SET email_confirmed_at = coalesce(email_confirmed_at, ?), last_sign_in_at = ? WHERE id = ?', nowIso(), nowIso(), tok.user_id)
    else await run(env.DB, 'UPDATE users SET email_confirmed_at = coalesce(email_confirmed_at, ?) WHERE id = ?', nowIso(), tok.user_id)
    const cookie = await newSession(env, req, tok.user_id, { recovery: kind === 'recovery' })
    const to = kind === 'recovery' ? new URL(req.url).origin + '/app/#/perfil' : (tok.redirect || new URL(req.url).origin + '/app/#/')
    return new Response(null, { status: 302, headers: { Location: to, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } })
  }

  // A partir de aquí hace falta sesión
  if (!ctx.uid) return authErr('no_session', 'Auth session missing!', 401)

  if (path === 'update') {
    if (!ctx.mfaOk) return authErr('insufficient_aal', 'MFA_REQUIRED: introduce el código de verificación en dos pasos', 403)
    if (pwProblem(body.password)) return authErr('weak_password', 'Password should be at least 8 characters and contain letters and numbers.')
    const u = await first(env.DB, 'SELECT * FROM users WHERE id = ?', ctx.uid)
    if ((await verifyPassword(body.password, u.password_hash)).ok) return authErr('same_password', 'New password should be different from the old password.')
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.password, +(env.PBKDF2_ITER || 100000)), ctx.uid),
      env.DB.prepare('UPDATE sessions SET recovery = 0 WHERE id = ?').bind(ctx.sid),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(ctx.uid, ctx.sid), // cierra las demás sesiones
    ])
    return json({ user: userJson(u) })
  }

  // ── Verificación en dos pasos ──
  if (path === 'mfa/enroll') {
    if (!ctx.mfaOk) return authErr('insufficient_aal', 'AAL2 required', 403)
    await run(env.DB, "DELETE FROM mfa_factors WHERE user_id = ? AND status = 'unverified'", ctx.uid)
    const secret = base32(randomBytes(20))
    const id = uuid()
    await run(env.DB, 'INSERT INTO mfa_factors (id, user_id, secret_enc, friendly_name) VALUES (?, ?, ?, ?)', id, ctx.uid, await encryptSecret(env.AUTH_SECRET, secret), String(body.friendlyName || 'DivingSlot').slice(0, 60))
    const uri = `otpauth://totp/${encodeURIComponent('DivingSlot:' + ctx.email)}?secret=${secret}&issuer=DivingSlot&algorithm=SHA1&digits=6&period=30`
    return json({ id, type: 'totp', totp: { qr_code: qrSvgDataUrl(uri), secret, uri } })
  }
  if (path === 'mfa/verify') {
    await rateLimit(env, 'mfa:' + ctx.uid, 10, 300)
    const f = await first(env.DB, 'SELECT * FROM mfa_factors WHERE id = ? AND user_id = ?', String(body.factorId || ''), ctx.uid)
    if (!f) return authErr('mfa_factor_not_found', 'Factor not found', 404)
    const step = await totpVerify(await decryptSecret(env.AUTH_SECRET, f.secret_enc), String(body.code || ''), f.last_step)
    if (!step) return authErr('mfa_verification_failed', 'Invalid TOTP code entered')
    const r = await run(env.DB, 'UPDATE mfa_factors SET last_step = ?, status = ? WHERE id = ? AND last_step < ?', step, 'verified', f.id, step)
    if (!changes(r)) return authErr('mfa_verification_failed', 'Invalid TOTP code entered')
    await run(env.DB, "UPDATE sessions SET aal = 'aal2' WHERE id = ?", ctx.sid)
    return json({ ok: true })
  }
  if (path === 'mfa/unenroll') {
    const f = await first(env.DB, 'SELECT * FROM mfa_factors WHERE id = ? AND user_id = ?', String(body.factorId || ''), ctx.uid)
    if (!f) return authErr('mfa_factor_not_found', 'Factor not found', 404)
    if (f.status === 'verified' && ctx.aal !== 'aal2') return authErr('insufficient_aal', 'AAL2 required to unenroll verified factor', 403)
    await run(env.DB, 'DELETE FROM mfa_factors WHERE id = ?', f.id)
    return json({ ok: true })
  }
  fail('NOT_FOUND', null, 404)
}
