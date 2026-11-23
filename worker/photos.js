// Foto propia del centro (23 nov 2026): el equipo la sube en Ajustes y se ve en Salidas, la ficha del centro, la salida y
// su página para buscadores. El fichero va en el bucket privado dive-photos, en la carpeta del usuario que la sube
// (<uid>/center-photo/<centro>-<n>.jpg, la regla de subida que ya existe), y se sirve en público solo a través de
// GET /api/center-photo/<centro>?v=<n>: nunca se expone la ruta ni el bucket. centers.photo_v cambia con cada foto (caché).
import { fail, first, run, changes } from './lib/util.js'

const isStaff = (ctx, center) => ctx.staff.includes(center)
const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const MAX_BYTES = 4 * 1024 * 1024

export const PHOTOS = {
  // p_path = ruta subida por el propio usuario a dive-photos (<uid>/center-photo/…); null = quitar la foto
  async set_center_photo(ctx, { p_center, p_path = null }) {
    mfa(ctx)
    if (!isStaff(ctx, p_center)) fail('FORBIDDEN', 'solo el equipo del centro puede cambiar su foto', 403)
    if (p_path == null) {
      await run(ctx.db, 'UPDATE centers SET photo_path = NULL, photo_v = 0 WHERE id = ?', p_center)
      return { photo_v: 0 }
    }
    const path = String(p_path)
    if (!path.startsWith(ctx.uid + '/center-photo/') || path.includes('..')) fail('BAD_PATH', 'ruta de foto no válida')
    const obj = await ctx.env.DIVE_PHOTOS?.head(path)
    if (!obj) fail('NOT_FOUND', 'no encontramos la foto subida')
    if (obj.size > MAX_BYTES) fail('TOO_BIG', 'la foto pesa demasiado (máximo 4 MB)')
    const r = await run(ctx.db, 'UPDATE centers SET photo_path = ?, photo_v = photo_v + 1 WHERE id = ?', path, p_center)
    if (!changes(r)) fail('NOT_FOUND', 'centro no encontrado')
    return { photo_v: (await first(ctx.db, 'SELECT photo_v FROM centers WHERE id = ?', p_center)).photo_v }
  },
}

// GET /api/center-photo/<centro>: la foto en público, con caché larga (la URL lleva ?v=<n>, que cambia con cada foto)
export async function handleCenterPhoto(env, id) {
  const c = await first(env.DB, "SELECT photo_path FROM centers WHERE id = ? AND photo_v > 0 AND listing_status <> 'cerrado'", id)
  const obj = c?.photo_path ? await env.DIVE_PHOTOS?.get(c.photo_path) : null
  if (!obj) return new Response('No encontrada', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } })
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
