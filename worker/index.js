// DiveSlot en Cloudflare: un solo Worker sirve la app (Static Assets) y la API (/api/*) sobre D1 y R2.
// Rutas:
//   /api/auth/*             cuentas, sesión (cookie __Host-ds_session), dos pasos       → auth.js
//   POST /api/rest          lecturas y escrituras de tablas con autorización            → rest.js + policies.js
//   POST /api/rpc/<nombre>  funciones de negocio (reservas, cobros, centros, admin)     → rpc.js
//   /api/storage/*          ficheros privados en R2 con enlaces firmados                → storage.js
//   POST /api/functions/crear-pago, POST /api/webhooks/paymongo                         → payments.js
import { json, errorResponse, fail, sessionCookie } from './lib/util.js'
import { loadCtx, handleAuth, rateLimit } from './auth.js'
import { handleRest } from './rest.js'
import { handleRpc } from './rpc.js'
import { handleStorage } from './storage.js'
import { crearPago, paymongoWebhook } from './payments.js'
import { cleanup } from './cron.js'

// Protección CSRF: toda petición que cambia datos lleva la cabecera X-DiveSlot (un formulario de otra web no puede
// ponerla sin un preflight CORS que no permitimos) y, si el navegador manda Origin, tiene que ser el nuestro.
function csrfOk(req, url) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  const origin = req.headers.get('Origin')
  if (origin && origin !== url.origin) return false
  return req.headers.get('X-DiveSlot') === '1'
}

export async function handleApi(req, env, ectx) {
  const url = new URL(req.url)
  const path = url.pathname.slice(5) // sin "/api/"
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 }) // sin CORS: solo la propia app
    if (path === 'webhooks/paymongo' && req.method === 'POST') return await paymongoWebhook(req, env)
    if (path === 'health') return json({ ok: true })
    if (!csrfOk(req, url)) return json({ error: { message: 'FORBIDDEN: origen no permitido', code: 'CSRF' } }, 403)
    if (!env.DB) fail('NOT_CONFIGURED', 'falta la base de datos D1', 503)
    const ctx = await loadCtx(req, env)
    ctx.origin = url.origin
    ctx.waitUntil = ectx?.waitUntil?.bind(ectx)
    let res
    if (path.startsWith('auth/')) res = await handleAuth(req, env, ctx, path.slice(5))
    else if (path === 'rest' && req.method === 'POST') {
      const q = await req.json()
      if (q.op && q.op !== 'select') await rateLimit(env, 'w:' + (ctx.uid || req.headers.get('CF-Connecting-IP')), 300, 60)
      res = json(await handleRest(ctx, q))
    } else if (path.startsWith('rpc/') && req.method === 'POST') {
      const name = path.slice(4)
      if (['book_trip', 'add_manual_booking', 'register_center'].includes(name)) await rateLimit(env, name + ':' + (ctx.uid || 'anon'), 30, 300)
      res = json({ data: await handleRpc(ctx, name, await req.json().catch(() => ({}))) })
    } else if (path.startsWith('storage/')) res = await handleStorage(req, env, ctx, path.slice(8))
    else if (path === 'functions/crear-pago' && req.method === 'POST') res = await crearPago(req, env, ctx)
    else fail('NOT_FOUND', 'ruta desconocida', 404)
    // Sesión deslizante: renueva también la cookie
    if (ctx.renew && ctx.token && !res.headers.get('Set-Cookie')) { res = new Response(res.body, res); res.headers.append('Set-Cookie', sessionCookie(ctx.token, 30 * 86400)) }
    return res
  } catch (e) {
    return errorResponse(e)
  }
}

export default {
  async fetch(req, env, ectx) {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) return handleApi(req, env, ectx)
    return env.ASSETS.fetch(req)
  },
  async scheduled(event, env, ectx) {
    ectx.waitUntil(cleanup(env))
  },
}
