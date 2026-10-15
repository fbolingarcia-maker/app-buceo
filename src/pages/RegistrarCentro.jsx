import { useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { go } from '../lib/router'
import { t } from '../lib/i18n'

// Alta del centro para cuentas de centro que aún no lo tienen registrado
export default function RegistrarCentro() {
  const { user, refresh } = useAuth()
  const meta = user?.user_metadata || {}
  const [name, setName] = useState(meta.center_name || '')
  const [phone, setPhone] = useState(meta.center_phone || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.rpc('register_center', { p_name: name, p_phone: phone })
    setBusy(false)
    if (error) return setError(errMsg(error))
    await refresh()
    go('/centro')
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1>{t('Da de alta tu centro')}</h1>
      <p className="muted">{t('Si tu centro ya aparece en el directorio de Panglao, escribe el mismo nombre y pasarás a gestionar su ficha.')}</p>
      <form className="card" onSubmit={save}>
        <div className="field"><label>{t('Nombre del centro')}</label><input required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>{t('Teléfono / WhatsApp')}</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        {error && <div className="msg err">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? t('Guardando…') : t('Registrar centro')}</button>
      </form>
      <p className="small muted center">{t('Después podrás añadir tus barcos, publicar salidas y gestionar reservas desde el panel.')}</p>
    </div>
  )
}
