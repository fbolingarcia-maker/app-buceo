import { useEffect, useState } from 'react'
import { supabase, errMsg, pwProblem } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { t } from '../lib/i18n'
import { go } from '../lib/router'
import { CodeInput } from './DosPasos'

// Cambiar (o crear, en cuentas de Google) la contraseña desde el Perfil.
// Siempre se confirma con un código de 6 cifras que llega por email (supabase.auth.reauthenticate),
// y, si la cuenta tiene la verificación en dos pasos, también con el código de la app de autenticación.
// «He olvidado mi contraseña» va por NuevaClave: allí el enlace del email ya es la verificación.
export default function CambiarClave() {
  const { user, signOut } = useAuth()
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [step, setStep] = useState('pw') // pw | code
  const [code, setCode] = useState('')
  const [totp, setTotp] = useState('')
  const [factor, setFactor] = useState(null) // factor TOTP verificado, si lo hay
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [wait, setWait] = useState(0) // segundos hasta poder reenviar el código

  // Cuentas creadas con Google sin contraseña propia: el mismo flujo sirve para crearla
  const hasPassword = !user?.identities || user.identities.some((i) => i.provider === 'email')

  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  async function sendCode(e) {
    e?.preventDefault()
    if (pwProblem(pw)) return setMsg({ ok: false, text: pwProblem(pw) })
    setBusy(true); setMsg(null)
    const [{ error }, { data: f }] = await Promise.all([supabase.auth.reauthenticate(), supabase.auth.mfa.listFactors()])
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    setFactor((f?.totp || []).find((x) => x.status === 'verified') || null)
    setStep('code'); setCode(''); setTotp(''); setWait(60)
    setMsg({ ok: true, text: t('Te hemos enviado un código de 6 cifras a {email}.', { email: user.email }) })
  }

  async function confirm(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    if (factor) {
      const { error: fe } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp })
      if (fe) { setBusy(false); setTotp(''); return setMsg({ ok: false, text: errMsg(fe) }) }
    }
    const { error } = await supabase.auth.updateUser({ password: pw, nonce: code })
    setBusy(false)
    if (error) { setCode(''); return setMsg({ ok: false, text: errMsg(error) }) }
    setStep('pw'); setPw(''); setCode(''); setTotp('')
    setMsg({ ok: true, text: hasPassword ? t('Contraseña cambiada') : t('Contraseña creada: ya puedes entrar también con tu email.') })
  }

  function cancel() { setStep('pw'); setCode(''); setTotp(''); setMsg(null) }

  return (
    <div className="card">
      {step === 'pw' ? (
        <form onSubmit={sendCode}>
          <div className="field">
            <label htmlFor="cc-pw">{hasPassword ? t('Nueva contraseña') : t('Crea una contraseña')}</label>
            <div className="row" style={{ gap: 6 }}>
              <input id="cc-pw" className="grow" type={show ? 'text' : 'password'} minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-describedby="cc-pw-hint" />
              <button type="button" className="btn small ghost" onClick={() => setShow(!show)} aria-pressed={show}>{show ? t('Ocultar') : t('Mostrar')}</button>
            </div>
            <span id="cc-pw-hint" className="small muted hint">{t('Mínimo 8 caracteres, con letras y números. Para confirmar el cambio te enviaremos un código por email.')}</span>
          </div>
          {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
          <div className="row between wrap" style={{ gap: 8 }}>
            <button className="btn ghost" disabled={busy || pw.length < 8}>{busy ? t('Un momento…') : t('Enviarme el código')}</button>
            <button type="button" className="btn danger" onClick={async () => { await signOut(); go('/') }}>{t('Cerrar sesión')}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={confirm} className="stack">
          <b>{t('Confirma que eres tú')}</b>
          {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
          <div className="field"><label htmlFor="cc-code">{t('Código del email')}</label><CodeInput id="cc-code" value={code} onChange={setCode} /></div>
          {factor && <div className="field"><label htmlFor="cc-totp">{t('Código de tu app de autenticación')}</label><CodeInput id="cc-totp" value={totp} onChange={setTotp} /></div>}
          <p className="small muted" style={{ margin: 0 }}>
            {t('¿No te ha llegado? Mira en spam o promociones.')}{' '}
            <button type="button" className="linkish" disabled={busy || wait > 0} onClick={() => sendCode()}>{wait > 0 ? t('Reenviar en {n} s', { n: wait }) : t('Reenviar código')}</button>
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={busy || code.length !== 6 || (factor && totp.length !== 6)}>{busy ? t('Un momento…') : hasPassword ? t('Cambiar contraseña') : t('Crear contraseña')}</button>
            <button type="button" className="btn ghost" onClick={cancel}>{t('Cancelar')}</button>
          </div>
        </form>
      )}
    </div>
  )
}
