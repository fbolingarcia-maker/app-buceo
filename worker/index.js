// DivingSlot en Cloudflare: un solo Worker sirve la app (Static Assets) y la API (/api/*) sobre D1 y R2.
// Rutas:
//   /api/auth/*             cuentas, sesión (cookie __Host-ds_session), dos pasos       → auth.js
//   POST /api/rest          lecturas y escrituras de tablas con autorización            → rest.js + policies.js
//   POST /api/rpc/<nombre>  funciones de negocio (reservas, cobros, centros, admin)     → rpc.js
//   /api/storage/*          ficheros privados en R2 con enlaces firmados                → storage.js
//   POST /api/functions/crear-pago, POST /api/webhooks/paymongo                         → payments.js
//   POST /api/hit, GET /api/stats, POST /api/notify (visitas y avisos de uso)            → stats.js
//   POST /api/import, GET /api/import/status (copia de datos desde Supabase, una vez)    → import.js
//   GET  /api/sea?trip=<id> (previsión de viento y olas y visibilidad de la bitácora)      → sea.js
//   GET  /api/health[?check=1] (estado y, con check=1, qué falta configurar)             → health.js
import { json, errorResponse, fail, sessionCookie } from './lib/util.js'
import { loadCtx, handleAuth, rateLimit } from './auth.js'
import { handleRest } from './rest.js'
import { handleRpc } from './rpc.js'
import { handleStorage } from './storage.js'
import { crearPago, paymongoWebhook } from './payments.js'
import { cleanup, balanceReminders, insuranceReminders, expireUnpaidWithMoney, updateFx } from './cron.js'
import { processAllWaitlists } from './plus.js'
import { RPC } from './rpc.js'
import { handleSea } from './sea.js'
import { handleImport } from './import.js'
import { handleHealth } from './health.js'
import { withSecrets } from './lib/secrets.js'
import { handleHit, handleStats, handleNotify, dailyDigest, pruneVisits, notifyAdmin } from './stats.js'
import { handleWidget } from './comunidad.js'
import { backupD1, BACKUP_CRON } from './backup.js'

// Protección CSRF: toda petición que cambia datos lleva la cabecera X-DivingSlot (un formulario de otra web no puede
// ponerla sin un preflight CORS que no permitimos) y, si el navegador manda Origin, tiene que ser el nuestro.
function csrfOk(req, url) {
  if (req.method === 'GET' || req.method === 'HEAD') return true
  const origin = req.headers.get('Origin')
  if (origin && origin !== url.origin) return false
  return req.headers.get('X-DivingSlot') === '1'
}

export async function handleApi(req, env, ectx) {
  const url = new URL(req.url)
  env = await withSecrets(env).catch(() => env) // AUTH_SECRET automático si no está configurado (lib/secrets.js)
  const path = url.pathname.slice(5) // sin "/api/"
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 }) // sin CORS: solo la propia app
    if (path === 'webhooks/paymongo' && req.method === 'POST') return await paymongoWebhook(req, env)
    if (path === 'health') return await handleHealth(req, env, url)
    if (path === 'import' || path === 'import/status') return await handleImport(req, env, url)
    // Visitas (sendBeacon no puede poner cabeceras: se comprueba el Origin dentro) y avisos desde Supabase (clave propia)
    if (path === 'hit' && req.method === 'POST') return await handleHit(req, env, url)
    if (path === 'notify' && req.method === 'POST') return await handleNotify(req, env)
    if (path === 'sea' && req.method === 'GET') return await handleSea(req, env, url, ectx)
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
    else if (path === 'stats' && req.method === 'GET') res = await handleStats(req, env, ctx, url)
    else fail('NOT_FOUND', 'ruta desconocida', 404)
    // Sesión deslizante: renueva también la cookie
    if (ctx.renew && ctx.token && !res.headers.get('Set-Cookie')) { res = new Response(res.body, res); res.headers.append('Set-Cookie', sessionCookie(ctx.token, 30 * 86400)) }
    return res
  } catch (e) {
    const res = errorResponse(e)
    if (res.status >= 500) alertError(env, ectx, 'API /api/' + path, e)
    return res
  }
}

// Error inesperado (500 o cron que falla): aviso por email al administrador, como mucho uno por hora
export function alertError(env, ectx, where, e) {
  if (!env?.DB) return null
  const p = rateLimit(env, 'alert:error', 1, 3600)
    .then(() => notifyAdmin(env, { kind: 'error', title: 'Error en ' + where, lines: [
      String(e?.message || e).slice(0, 280),
      'Este aviso se manda como mucho una vez por hora; puede haber más errores.',
      'Detalle: Cloudflare → Workers & Pages → diveslot → Observability.',
    ] }))
    .catch(() => {})
  ectx?.waitUntil?.(p)
  return p
}

export default {
  async fetch(req, env, ectx) {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/')) return handleApi(req, env, ectx)
    // Enlace de reservas propio del centro (web, Instagram, Google): divingslot.com/r/<id> → la ficha del centro, sin comisión
    // ?t=<salida>: viene del widget y abre directamente esa salida (con el canal propio del centro)
    const ref = /^\/r\/([\w-]{2,40})\/?$/.exec(url.pathname)
    if (ref) { const tr = /^[\w-]{2,40}$/.test(url.searchParams.get('t') || '') ? '/' + url.searchParams.get('t') : ''; return Response.redirect(url.origin + '/app/#/r/' + ref[1] + tr, 302) }
    // Widget de reservas para insertar en la web del centro (iframe)
    const wid = /^\/w\/([\w-]{2,40})\/?$/.exec(url.pathname)
    if (wid && env.DB) return handleWidget(req, env, url, wid[1])
    // Verificación de Google Search Console: se sirve tal cual (Static Assets redirigiría *.html a la ruta sin .html)
    if (url.pathname === '/google3f09e05f2c350262.html') return new Response('google-site-verification: google3f09e05f2c350262.html', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    return env.ASSETS.fetch(req)
  },
  async scheduled(event, env, ectx) {
    env = await withSecrets(env).catch(() => env)
    const onFail = (what) => (e) => { console.error(what, e?.message); alertError(env, ectx, 'la tarea programada (' + what + ')', e) }
    // Copia de seguridad semanal de D1 en R2 (backup.js); si falla, aviso al administrador
    if (event?.cron === BACKUP_CRON) return ectx.waitUntil(backupD1(env).then((r) => console.log('backup', JSON.stringify(r))).catch(onFail('copia de seguridad')))
    // Cada 10 min: solo la lista de espera (las ofertas de plaza caducan a los 30 min)
    ectx.waitUntil(processAllWaitlists(env, RPC).catch(onFail('lista de espera')))
    if (event?.cron === '*/10 * * * *') return
    ectx.waitUntil(updateFx(env).catch((e) => console.error('fx', e.message)))
    ectx.waitUntil(cleanup(env).catch(onFail('limpieza')))
    ectx.waitUntil(pruneVisits(env).catch(onFail('visitas')))
    ectx.waitUntil(dailyDigest(env).catch(onFail('resumen diario')))
    ectx.waitUntil(balanceReminders(env, env.APP_ORIGIN || 'https://divingslot.com').catch(onFail('recordatorios de pago')))
    ectx.waitUntil(insuranceReminders(env, env.APP_ORIGIN || 'https://divingslot.com').catch(onFail('avisos de seguro')))
    ectx.waitUntil(expireUnpaidWithMoney(env).catch(onFail('reservas caducadas con pagos')))
  },
}
