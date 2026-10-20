import { useState } from 'react'
import { supabase, appUrl, errMsg, pwProblem } from '../lib/supabase'
import { t, useLang } from '../lib/i18n'
import Icon from '../lib/Icon'
import { Languages, Ship, Waves } from 'lucide-react'

// Página a la que volver tras entrar (la guarda la ficha de la salida)
function afterLogin() {
  try { return sessionStorage.getItem('afterLogin') || '' } catch (e) { return '' }
}

// embedded: el login va debajo del título de otra pantalla (Reservas, Bitácora), así que su título es un h2
export default function Login({ embedded }) {
  const { lang, setLang } = useLang()
  // #/login?alta=centro abre directamente el alta de centro (p. ej. desde «¿Es tu centro?» del directorio)
  const alta = new URLSearchParams(window.location.hash.split('?')[1] || '').get('alta')
  const [mode, setMode] = useState(alta ? 'signup' : 'login') // login | signup | reset
  const [name, setName] = useState('')
  const [type, setType] = useState(alta === 'centro' ? 'center' : 'diver') // diver | center
  const [centerName, setCenterName] = useState(() => { try { return sessionStorage.getItem('claimCenter') || '' } catch (e) { return '' } })
  const [centerPhone, setCenterPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(() => { const e = sessionStorage.getItem('authError'); sessionStorage.removeItem('authError'); return e || '' })
  const [info, setInfo] = useState('')
  const [resend, setResend] = useState(false) // mostrar «Reenviar email de confirmación»
  const [resent, setResent] = useState(false)

  // Vuelve a enviar el email de confirmación (si el primero no llegó)
  async function resendEmail() {
    setBusy(true); setError('')
    const back = afterLogin()
    const { error: re } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: appUrl() + (back ? '#' + back : '') } })
    setBusy(false)
    if (re) return setError(errMsg(re))
    setResent(true); setInfo(t('Te hemos vuelto a enviar el email de confirmación a {email}. Revisa también la carpeta de spam o promociones.', { email }))
  }

  async function submit(e) {
    e.preventDefault()
    if (mode === 'signup' && pwProblem(password)) return setError(pwProblem(password))
    setBusy(true); setError(''); setInfo(''); setResend(false); setResent(false)
    let res
    if (mode === 'login') {
      res = await supabase.auth.signInWithPassword({ email, password })
    } else if (mode === 'signup') {
      const back = afterLogin()
      res = await supabase.auth.signUp({ email, password, options: {
        data: { full_name: name, account_type: type, ...(type === 'center' ? { center_name: centerName, center_phone: centerPhone } : {}) },
        emailRedirectTo: appUrl() + (back && type === 'diver' ? '#' + back : ''),
      } })
      if (!res.error && !res.data.session) { setInfo(t('Te hemos enviado un email a {email} para confirmar tu cuenta. Ábrelo y pulsa el enlace (mira también en spam o promociones).', { email })); setResend(true) }
    } else {
      res = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
      if (!res.error) setInfo(t('Si el email existe, recibirás un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.'))
    }
    setBusy(false)
    if (res.error) {
      setError(errMsg(res.error))
      if (res.error.code === 'email_not_confirmed' || /email not confirmed/i.test(res.error.message || '')) setResend(true)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      {(() => { const H = embedded ? 'h2' : 'h1'; return <H>{mode === 'login' ? t('Entrar') : mode === 'signup' ? t('Crear cuenta') : t('Recuperar acceso')}</H> })()}
      <form className="card" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label id="acc-type">{t('Tipo de cuenta')}</label>
            <div className="grid2 field" role="group" aria-labelledby="acc-type">
              <button type="button" aria-pressed={type === 'diver'} className={type === 'diver' ? 'btn' : 'btn ghost'} onClick={() => setType('diver')}><Icon icon={Waves} />{t('Soy buceador')}</button>
              <button type="button" aria-pressed={type === 'center'} className={type === 'center' ? 'btn' : 'btn ghost'} onClick={() => setType('center')}><Icon icon={Ship} />{t('Soy centro de buceo')}</button>
            </div>
            <p className="small muted" style={{ marginTop: -4 }}>
              {type === 'diver'
                ? t('Reserva salidas y lleva tu bitácora de inmersiones.')
                : t('Publica salidas, gestiona reservas, cobros y check-in de tus buceadores.') + ' ' + t('Antes de aparecer en la app verificaremos tu centro (permiso de negocio e identidad).')}
            </p>
            <div className="field"><label htmlFor="su-name">{type === 'center' ? t('Tu nombre (responsable)') : t('Nombre')}</label><input id="su-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div>
            {type === 'center' && (
              <div className="grid2">
                <div className="field"><label htmlFor="su-center">{t('Nombre del centro')}</label><input id="su-center" value={centerName} onChange={(e) => setCenterName(e.target.value)} required autoComplete="organization" /></div>
                <div className="field"><label htmlFor="su-phone">{t('Teléfono / WhatsApp')}</label><input id="su-phone" type="tel" inputMode="tel" autoComplete="tel" value={centerPhone} onChange={(e) => setCenterPhone(e.target.value)} /></div>
              </div>
            )}
          </>
        )}
        <div className="field"><label htmlFor="li-email">Email</label><input id="li-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
        {mode !== 'reset' && (
          <div className="field"><label htmlFor="li-pw">{t('Contraseña')}</label>
            <div className="row" style={{ gap: 6 }}>
              <input id="li-pw" className="grow" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 8 : 6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode === 'signup' ? 'pw-hint' : undefined} />
              <button type="button" className="btn small ghost" onClick={() => setShowPw(!showPw)} aria-pressed={showPw}>{showPw ? t('Ocultar') : t('Mostrar')}</button>
            </div>
            {mode === 'signup' && <span id="pw-hint" className="small muted hint">{t('Mínimo 8 caracteres, con letras y números')}</span>}
          </div>
        )}
        {error && <div className="msg err" role="alert">{error}</div>}
        {info && <div className="msg ok" role="status">{info}</div>}
        {resend && !resent && (
          <p className="small" style={{ marginTop: 0 }}>{t('¿No te ha llegado?')} <button type="button" className="linkish" disabled={busy || !email} onClick={resendEmail}>{t('Reenviar email de confirmación')}</button></p>
        )}
        <button className="btn block" disabled={busy}>
          {busy ? t('Un momento…') : mode === 'login' ? t('Entrar') : mode === 'signup' ? t('Crear cuenta') : t('Enviar enlace')}
        </button>
      </form>
      <div className="center small stack">
        {mode !== 'login' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('login') }}>{t('Ya tengo cuenta')}</a></div>}
        {mode !== 'signup' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('signup') }}>{t('Crear cuenta nueva')}</a></div>}
        {mode !== 'reset' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('reset') }}>{t('He olvidado mi contraseña')}</a></div>}
        {/* Cambio de idioma para quien aún no tiene cuenta: el otro idioma, nombrado en su propio idioma (sin t()) */}
        <div><button type="button" className="linkish small" onClick={() => setLang(lang === 'es' ? 'en' : 'es')}><Icon icon={Languages} size={16} /> {lang === 'es' ? 'English' : 'Español'}</button></div>
      </div>
    </div>
  )
}
