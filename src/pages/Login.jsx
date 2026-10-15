import { useState } from 'react'
import { supabase, appUrl, errMsg } from '../lib/supabase'
import { t, LangSwitch } from '../lib/i18n'

export default function Login() {
  const [mode, setMode] = useState('login') // login | signup | reset
  const [name, setName] = useState('')
  const [type, setType] = useState('diver') // diver | center
  const [centerName, setCenterName] = useState('')
  const [centerPhone, setCenterPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(() => { const e = sessionStorage.getItem('authError'); sessionStorage.removeItem('authError'); return e || '' })
  const [info, setInfo] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setInfo('')
    let res
    if (mode === 'login') {
      res = await supabase.auth.signInWithPassword({ email, password })
    } else if (mode === 'signup') {
      res = await supabase.auth.signUp({ email, password, options: {
        data: { full_name: name, account_type: type, ...(type === 'center' ? { center_name: centerName, center_phone: centerPhone } : {}) },
        emailRedirectTo: appUrl(),
      } })
      if (!res.error && !res.data.session) setInfo(t('Te hemos enviado un email para confirmar tu cuenta. Ábrelo y pulsa el enlace.'))
    } else {
      res = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
      if (!res.error) setInfo(t('Si el email existe, recibirás un enlace para crear una contraseña nueva.'))
    }
    setBusy(false)
    if (res.error) setError(errMsg(res.error))
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1>{mode === 'login' ? t('Entrar') : mode === 'signup' ? t('Crear cuenta') : t('Recuperar acceso')}</h1>
      <form className="card" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label>{t('Tipo de cuenta')}</label>
            <div className="grid2 field">
              <button type="button" className={type === 'diver' ? 'btn' : 'btn ghost'} onClick={() => setType('diver')}>{t('🤿 Soy buceador')}</button>
              <button type="button" className={type === 'center' ? 'btn' : 'btn ghost'} onClick={() => setType('center')}>{t('⚓ Soy centro de buceo')}</button>
            </div>
            <p className="small muted" style={{ marginTop: -4 }}>
              {type === 'diver' ? t('Reserva salidas y lleva tu bitácora de inmersiones.') : t('Publica salidas, gestiona reservas, cobros y check-in de tus buceadores.')}
            </p>
            <div className="field"><label>{type === 'center' ? t('Tu nombre (responsable)') : t('Nombre')}</label><input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div>
            {type === 'center' && (
              <div className="grid2">
                <div className="field"><label>{t('Nombre del centro')}</label><input value={centerName} onChange={(e) => setCenterName(e.target.value)} required /></div>
                <div className="field"><label>{t('Teléfono / WhatsApp')}</label><input value={centerPhone} onChange={(e) => setCenterPhone(e.target.value)} /></div>
              </div>
            )}
          </>
        )}
        <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
        {mode !== 'reset' && (
          <div className="field"><label>{t('Contraseña')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>
        )}
        {error && <div className="msg err">{error}</div>}
        {info && <div className="msg ok">{info}</div>}
        <button className="btn block" disabled={busy}>
          {busy ? t('Un momento…') : mode === 'login' ? t('Entrar') : mode === 'signup' ? t('Crear cuenta') : t('Enviar enlace')}
        </button>
        <div className="row between wrap" style={{ marginTop: 14, gap: 8 }}>
          <span className="small muted">{t('Idioma')}</span>
          <LangSwitch full />
        </div>
      </form>
      <div className="center small stack">
        {mode !== 'login' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('login') }}>{t('Ya tengo cuenta')}</a></div>}
        {mode !== 'signup' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('signup') }}>{t('Crear cuenta nueva')}</a></div>}
        {mode !== 'reset' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('reset') }}>{t('He olvidado mi contraseña')}</a></div>}
      </div>
    </div>
  )
}
