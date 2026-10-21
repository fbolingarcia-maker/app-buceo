// Ficheros privados en R2 (sustituye a Supabase Storage): fotos de la bitácora y documentos de verificación.
//   dive-photos/<user_id>/…   solo el propio usuario
//   center-docs/<center_id>/… el equipo del centro (y la plataforma para leer)
// Las descargas van siempre con enlace firmado y caducidad (createSignedUrl), nunca hay listados públicos.
import { fail, json, SECURITY_HEADERS } from './lib/util.js'
import { hmacHex, safeEqual, signingKey } from './lib/crypto.js'

const BUCKETS = {
  'dive-photos': { binding: 'DIVE_PHOTOS', mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] },
  'center-docs': { binding: 'CENTER_DOCS', mimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'] },
}
const MAX_BYTES = 10 * 1024 * 1024

function bucketOf(env, name) {
  const b = BUCKETS[name]
  if (!b) fail('NOT_FOUND', 'bucket desconocido', 404)
  const r2 = env[b.binding]
  if (!r2) fail('STORAGE_DISABLED', 'el almacenamiento de ficheros aún no está activado', 503)
  return { ...b, r2 }
}
function cleanPath(p) {
  const s = String(p || '')
  if (s.length > 300 || !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(s) || s.split('/').some((x) => x === '.' || x === '..')) fail('BAD_PATH', 'nombre de fichero no válido')
  return s
}
function canRead(ctx, bucket, path) {
  if (!ctx.uid || !ctx.mfaOk) return false
  const owner = path.split('/')[0]
  if (bucket === 'dive-photos') return owner === ctx.uid
  return ctx.staff.includes(owner) || ctx.isAdmin
}
function canWrite(ctx, bucket, path) {
  if (!ctx.uid || !ctx.mfaOk) return false
  const owner = path.split('/')[0]
  return bucket === 'dive-photos' ? owner === ctx.uid : ctx.staff.includes(owner)
}

// Tipo real del fichero por sus primeros bytes (no nos fiamos del Content-Type)
export function sniff(bytes) {
  const b = (i) => bytes[i]
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to))
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg'
  if (b(0) === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(0, 5) === '%PDF-') return 'application/pdf'
  if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'hevc', 'heim', 'heis'].includes(ascii(8, 12))) return 'image/heic'
  return null
}

async function sign(env, bucket, path, exp) {
  return hmacHex(await signingKey(env.AUTH_SECRET, 'storage'), `${bucket}/${path}:${exp}`)
}

export async function handleStorage(req, env, ctx, rest) {
  const url = new URL(req.url)
  // Descarga con enlace firmado: /api/storage/object/<bucket>/<path>?exp=…&sig=…
  if (req.method === 'GET' && rest.startsWith('object/')) {
    const [bucket, ...p] = rest.slice(7).split('/')
    const path = cleanPath(p.join('/'))
    const exp = +url.searchParams.get('exp'), sig = url.searchParams.get('sig') || ''
    if (!exp || exp < Date.now() / 1000 || !safeEqual(sig, await sign(env, bucket, path, exp))) return new Response('Enlace caducado', { status: 403, headers: SECURITY_HEADERS })
    const obj = await bucketOf(env, bucket).r2.get(path)
    if (!obj) return new Response('No encontrado', { status: 404, headers: SECURITY_HEADERS })
    return new Response(obj.body, { headers: { ...SECURITY_HEADERS, 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=300', 'Content-Security-Policy': "default-src 'none'; sandbox" } })
  }
  if (!ctx.uid) fail('FORBIDDEN', 'inicia sesión', 401)

  // Subida: PUT /api/storage/upload/<bucket>/<path>
  if (req.method === 'PUT' && rest.startsWith('upload/')) {
    const [bucket, ...p] = rest.slice(7).split('/')
    const path = cleanPath(p.join('/'))
    const b = bucketOf(env, bucket)
    if (!canWrite(ctx, bucket, path)) fail('FORBIDDEN', 'new row violates row-level security policy', 403)
    if (+(req.headers.get('Content-Length') || 0) > MAX_BYTES) fail('TOO_BIG', 'el fichero supera los 10 MB', 413)
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length > MAX_BYTES) fail('TOO_BIG', 'el fichero supera los 10 MB', 413)
    const type = sniff(bytes)
    if (!type || !b.mimes.includes(type)) fail('BAD_TYPE', 'tipo de fichero no permitido', 415)
    if (await b.r2.head(path)) fail('DUPLICATE', 'The resource already exists', 409)
    await b.r2.put(path, bytes, { httpMetadata: { contentType: type }, customMetadata: { owner: ctx.uid } })
    return json({ data: { path, fullPath: `${bucket}/${path}` } })
  }

  const body = await req.json().catch(() => ({}))
  // Enlaces firmados: POST /api/storage/sign { bucket, paths, expiresIn }
  if (req.method === 'POST' && rest === 'sign') {
    const bucket = body.bucket
    bucketOf(env, bucket)
    const ttl = Math.max(30, Math.min(+body.expiresIn || 300, 3600))
    const exp = Math.floor(Date.now() / 1000) + ttl
    const out = []
    for (const raw of (body.paths || []).slice(0, 200)) {
      let path
      try { path = cleanPath(raw) } catch (e) { out.push({ path: raw, signedUrl: null, error: 'Invalid path' }); continue }
      if (!canRead(ctx, bucket, path)) { out.push({ path, signedUrl: null, error: 'Object not found' }); continue }
      const sig = await sign(env, bucket, path, exp)
      out.push({ path, signedUrl: `${url.origin}/api/storage/object/${bucket}/${path}?exp=${exp}&sig=${sig}`, error: null })
    }
    return json({ data: out })
  }
  // Borrar: POST /api/storage/remove { bucket, paths }
  if (req.method === 'POST' && rest === 'remove') {
    const b = bucketOf(env, body.bucket)
    const ok = []
    for (const raw of (body.paths || []).slice(0, 1000)) {
      let path
      try { path = cleanPath(raw) } catch (e) { continue }
      if (canWrite(ctx, body.bucket, path)) ok.push(path)
    }
    for (let i = 0; i < ok.length; i += 1000) await b.r2.delete(ok.slice(i, i + 1000))
    return json({ data: ok.map((name) => ({ name })) })
  }
  fail('NOT_FOUND', null, 404)
}
