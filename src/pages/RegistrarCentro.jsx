import { useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { go } from '../lib/router'
import { t } from '../lib/i18n'
import DestinoSelect from '../lib/DestinoSelect'

// Alta del centro para cuentas de centro que aún no lo tienen registrado
export default function RegistrarCentro() {
  const { user, refresh } = useAuth()
  const meta = user?.user_metadata || {}
  const [name, setName] = useState(meta.center_name || '')
  const [phone, setPhone] = useState(meta.center_phone || '')
  const [dest, setDest] = useState(null)
  const [locality, setLocality] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { data: c, error } = await supabase.rpc('register_center', { p_name: name, p_phone: phone })
    if (error) { setBusy(false); return setError(errMsg(error)) }
    // Zona del centro: destino, provincia y coordenadas aproximadas (si la ficha no tenía)
    if (dest && c?.id) {
      await supabase.from('centers').update({
        destination: dest.name, province: dest.province, area: dest.name,
        ...(locality.trim() ? { locality: locality.trim() } : {}),
        ...(c.lat == null ? { lat: dest.lat, lng: dest.lng, location_precision: 'zona' } : {}),
      }).eq('id', c.id)
    }
    setBusy(false)
    await refresh()
    go('/centro')
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1>{t('Da de alta tu centro')}</h1>
      <p className="muted">{t('Si tu centro ya aparece en el directorio, escribe el mismo nombre y pasarás a gestionar su ficha.')}</p>
      <form className="card" onSubmit={save}>
        <div className="field"><label>{t('Nombre del centro')}</label><input required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>{t('Teléfono / WhatsApp')}</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label>{t('Destino')}</label><DestinoSelect required value={dest?.name} onChange={(_, d) => setDest(d || null)} /></div>
          <div className="field"><label>{t('Playa / barrio (opcional)')}</label><input placeholder={t('p. ej. Alona Beach')} value={locality} onChange={(e) => setLocality(e.target.value)} /></div>
        </div>
        {error && <div className="msg err">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? t('Guardando…') : t('Registrar centro')}</button>
      </form>
      <p className="small muted center">{t('Después podrás añadir tus barcos, publicar salidas y gestionar reservas desde el panel.')}</p>
    </div>
  )
}
