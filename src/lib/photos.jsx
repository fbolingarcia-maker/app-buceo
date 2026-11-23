// Foto propia del centro (23 nov 2026): el equipo la sube en Ajustes; se sirve en /api/center-photo/<centro>?v=<n>
// (worker/photos.js). Antes de subirla se reduce en el móvil a 1600 px de lado y JPEG, para que cargue rápido.
import { useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t } from './i18n'
import Icon from './Icon'
import { Camera, X } from 'lucide-react'

export const centerPhotoUrl = (id, v) => (v > 0 ? `/api/center-photo/${id}?v=${v}` : null)

// Reduce la imagen (máx. 1600 px de lado) y la pasa a JPEG; si el navegador no puede, se sube tal cual
async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise((ok) => c.toBlob((b) => ok(b || file), 'image/jpeg', 0.84))
  } catch (e) { return file }
}

// Ajustes del centro: subir, cambiar o quitar la foto
export function CenterPhoto({ center, uid, refresh, readOnly }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [v, setV] = useState(center.photo_v || 0)
  async function pick(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true); setErr('')
    const blob = await shrink(f)
    const path = `${uid}/center-photo/${center.id}-${Date.now()}.jpg`
    const up = await supabase.storage.from('dive-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
    if (up.error) { setBusy(false); return setErr(errMsg(up.error)) }
    const { data, error } = await supabase.rpc('set_center_photo', { p_center: center.id, p_path: path })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setV(data.photo_v); refresh?.()
  }
  async function remove() {
    if (!window.confirm(t('¿Quitar la foto del centro?'))) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('set_center_photo', { p_center: center.id, p_path: null })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setV(0); refresh?.()
  }
  const url = centerPhotoUrl(center.id, v)
  return (
    <div className="card stack">
      <p className="small muted" style={{ margin: 0 }}>{t('Sale en Salidas, en la ficha de tu centro y en tu página de Google. Mejor en horizontal: tu barco, el equipo o un buceo vuestro.')}</p>
      {url ? <img className="hero-photo" src={url} alt={t('Foto de {name}', { name: center.name })} /> : <div className="hero-photo empty" aria-hidden="true"><Icon icon={Camera} size={28} /></div>}
      {!readOnly && (
        <div className="row wrap" style={{ gap: 8 }}>
          <label className={'btn small' + (busy ? ' disabled' : '')} style={{ cursor: 'pointer' }}>
            <Icon icon={Camera} size={16} /> {busy ? t('Subiendo…') : url ? t('Cambiar la foto') : t('Subir una foto')}
            <input type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} disabled={busy} />
          </label>
          {url && <button type="button" className="btn small ghost" disabled={busy} onClick={remove}><Icon icon={X} size={16} /> {t('Quitar')}</button>}
        </div>
      )}
      {err && <div className="msg err" role="alert">{err}</div>}
    </div>
  )
}
