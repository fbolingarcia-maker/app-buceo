// GET /api/health            → { ok: true } (para monitores)
// GET /api/health?check=1    → qué está listo y qué falta para pasar la app a Cloudflare (solo sí/no, nunca valores).
//   Lo usa el paso 1 de docs/CAMBIO-A-CLOUDFLARE.md: abre https://divingslot.com/api/health?check=1 y mira «missing».
import { json } from './lib/util.js'
import { TABLES } from './schema.js'

export async function handleHealth(req, env, url) {
  if (url.searchParams.get('check') !== '1') return json({ ok: true })
  const missing = []
  const has = (k) => !!(env[k] && String(env[k]).length)
  const c = {
    d1: !!env.DB,
    auth_secret: has('AUTH_SECRET') && String(env.AUTH_SECRET).length >= 32 ? (env.AUTH_SECRET_AUTO ? 'automatico' : 'secreto') : false,
    google: has('GOOGLE_CLIENT_ID') && has('GOOGLE_CLIENT_SECRET'),
    email: env.EMAIL?.send ? 'cloudflare' : has('RESEND_API_KEY') ? 'resend' : has('SMTP_HOST') && has('SMTP_USER') && has('SMTP_PASS') ? 'smtp' : env.EMAIL_DEV_LOG === '1' ? 'solo-log' : 'no',
    notify: has('NOTIFY_KEY') ? 'clave' : 'cola-supabase',
    r2_dive_photos: !!env.DIVE_PHOTOS,
    r2_center_docs: !!env.CENTER_DOCS,
    paymongo: has('PAYMONGO_SECRET_KEY'),
    paymongo_webhook: has('PAYMONGO_WEBHOOK_SECRET'),
  }
  if (!c.d1) missing.push('Base de datos D1 (binding DB en wrangler.jsonc)')
  if (!c.auth_secret) missing.push('AUTH_SECRET: se genera solo en D1 la primera vez que la API recibe una petición')
  if (!c.google) missing.push('Acceso con Google: secreto GOOGLE_CLIENT_SECRET (el GOOGLE_CLIENT_ID ya va en wrangler.jsonc)')
  if (c.email === 'no' || c.email === 'solo-log') missing.push('Email: Workers Paid + Email Sending de divingslot.com (y descomentar send_email en wrangler.jsonc), o RESEND_API_KEY, o SMTP_HOST/SMTP_USER/SMTP_PASS')
  if (!c.r2_dive_photos || !c.r2_center_docs) missing.push('(Opcional) R2: buckets de fotos y documentos; sin ellos la app funciona pero no se pueden subir ficheros')
  if (!c.paymongo) missing.push('(Opcional) PAYMONGO_SECRET_KEY y PAYMONGO_WEBHOOK_SECRET para cobros online')

  let schema = null, data = null, imp = null
  if (env.DB) {
    try {
      // D1 no deja leer pragma_table_info() en una consulta, pero sí PRAGMA table_info(t); en un lote cuenta como una sola
      const names = Object.keys(TABLES)
      const res = await env.DB.batch(names.map((t) => env.DB.prepare(`PRAGMA table_info(${t})`)))
      const have = new Set(res.flatMap((r, i) => (r.results || []).map((c) => names[i] + '.' + c.name)))
      const lack = Object.entries(TABLES).flatMap(([t, d]) => d.cols.map(([col]) => t + '.' + col)).filter((x) => !have.has(x))
      schema = { up_to_date: lack.length === 0, missing_columns: lack.slice(0, 20) }
      if (lack.length) missing.push('Esquema de D1 antiguo: se pone al día solo al importar los datos (reset) o con schema.sql')
    } catch (e) { schema = { error: String(e?.message || e).slice(0, 200) } }
    try {
      const q = (t) => `(SELECT count(*) FROM ${t})`
      data = await env.DB.prepare(`SELECT ${q('users')} AS users, ${q('centers')} AS centers, ${q('trips')} AS trips, ${q('dive_sites')} AS dive_sites, ${q('bookings')} AS bookings`).first()
      if (!data?.users) missing.push('Datos: aún no se han copiado de Supabase (paso de importación)')
    } catch (e) { data = { error: String(e?.message || e).slice(0, 200) } }
    try {
      imp = await env.DB.prepare("SELECT run, status, finished_at FROM import_runs WHERE run <> '#locked' ORDER BY started_at DESC LIMIT 1").first()
      const lock = await env.DB.prepare("SELECT 1 AS x FROM import_runs WHERE run = '#locked'").first()
      imp = { last: imp || null, locked: !!lock }
    } catch { imp = { last: null, locked: false } }
  }
  const ready = c.d1 && c.auth_secret && c.google && ['cloudflare', 'resend', 'smtp'].includes(c.email) && !!schema?.up_to_date && !!data?.users
  return json({ ok: true, ready, checks: c, schema, data, import: imp, missing })
}
