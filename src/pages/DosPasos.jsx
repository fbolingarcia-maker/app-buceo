import { useCallback, useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { t } from '../lib/i18n'

// Verificación en dos pasos (TOTP: Google Authenticator, Microsoft Authenticator, 1Password…)
// La base de datos la exige (mfa_ok(), migración 027): con el factor activado, sin el código no se ve nada privado.

const clean = (v) => v.replace(/\D/g, '').slice(0, 6)

function CodeInput({ value, onChange, id }) {
  return (
    <input id={id} value={value} onChange={(e) => onChange(clean(e.target.value))} inputMode="numeric" pattern="[0-9]{6}"
      autoComplete="one-time-code" placeholder="123456" maxLength={6} required
      style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center', maxWidth: 200 }} />
  )
}

// Pantalla tras la contraseña cuando la cuenta tiene el segundo paso activado
export function DosPasosReto() {
  const { signOut } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { data, error: le } = await supabase.auth.mfa.listFactors()
    const factor = (data?.totp || []).find((f) => f.status === 'verified')
    if (le || !factor) { setBusy(false); return setError(le ? errMsg(le) : t('No encontramos tu app de verificación. Sal y vuelve a entrar.')) }
    const { error: ve } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    setBusy(false)
    if (ve) { setCode(''); setError(errMsg(ve)) }
    // Si va bien, Supabase emite MFA_CHALLENGE_VERIFIED y la app carga el perfil sola
  }

  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1>🔐 {t('Verificación en dos pasos')}</h1>
      <p className="muted">{t('Abre tu app de autenticación y escribe el código de 6 cifras de DivingSlot.')}</p>
      <div className="field"><label htmlFor="mfa-code">{t('Código')}</label><CodeInput id="mfa-code" value={code} onChange={setCode} /></div>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="row between">
        <button className="btn" disabled={busy || code.length !== 6}>{busy ? t('Un momento…') : t('Verificar')}</button>
        <button type="button" className="btn ghost" onClick={() => signOut()}>{t('Salir')}</button>
      </div>
    </form>
  )
}

// Tarjeta del perfil: activar o desactivar el segundo paso
export default function DosPasos({ recommend }) {
  const { refresh } = useAuth()
  const [factor, setFactor] = useState(undefined) // undefined = cargando, null = desactivada
  const [setup, setSetup] = useState(null) // { id, qr, secret } mientras se activa
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors()
    setFactor((data?.totp || []).find((f) => f.status === 'verified') || null)
  }, [])
  useEffect(() => { load() }, [load])

  async function start() {
    setBusy(true); setMsg(null)
    // Restos de un intento anterior sin terminar
    const { data } = await supabase.auth.mfa.listFactors()
    for (const f of (data?.all || []).filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'DivingSlot', friendlyName: 'DivingSlot ' + Date.now() })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    setSetup({ id: en.id, qr: en.totp.qr_code, secret: en.totp.secret }); setCode('')
  }

  async function confirm(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: setup.id, code })
    setBusy(false)
    if (error) { setCode(''); return setMsg({ ok: false, text: errMsg(error) }) }
    setSetup(null); setMsg({ ok: true, text: t('Verificación en dos pasos activada. La próxima vez que entres te pediremos el código.') })
    load(); refresh()
  }

  async function cancel() {
    if (setup) await supabase.auth.mfa.unenroll({ factorId: setup.id })
    setSetup(null); setMsg(null)
  }

  async function disable() {
    if (!window.confirm(t('¿Desactivar la verificación en dos pasos? Tu cuenta quedará protegida solo con la contraseña.'))) return
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    await supabase.auth.refreshSession()
    setMsg({ ok: true, text: t('Verificación en dos pasos desactivada.') }); load()
  }

  return (
    <div className="card" id="dos-pasos">
      <div className="row between wrap">
        <b>🔐 {t('Verificación en dos pasos')}</b>
        {factor === undefined ? <span className="small muted">{t('Cargando…')}</span>
          : factor ? <span className="pill ok">{t('Activada')}</span> : <span className={recommend ? 'pill warn' : 'pill'}>{t('Desactivada')}</span>}
      </div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        {t('Además de la contraseña, al entrar te pediremos un código de tu app de autenticación (Google Authenticator, Microsoft Authenticator, 1Password…).')}
        {recommend && !factor && <> <b>{t('Muy recomendable para cuentas de administrador.')}</b></>}
      </p>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {factor === null && !setup && <button type="button" className="btn ghost" disabled={busy} onClick={start}>{t('Activar')}</button>}
      {factor && <button type="button" className="btn ghost" disabled={busy} onClick={disable}>{t('Desactivar')}</button>}
      {setup && (
        <form onSubmit={confirm} className="stack">
          <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>{t('Escanea este código QR con tu app de autenticación.')}</li>
            <li>{t('Escribe el código de 6 cifras que aparece en la app.')}</li>
          </ol>
          <img src={setup.qr} alt={t('Código QR para la app de autenticación')} width="180" height="180" style={{ background: '#fff', borderRadius: 8, padding: 6, display: 'block' }} />
          <div className="small muted">{t('¿No puedes escanearlo? Introduce esta clave a mano:')} <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{setup.secret}</code></div>
          <div className="field"><label htmlFor="mfa-new">{t('Código')}</label><CodeInput id="mfa-new" value={code} onChange={setCode} /></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={busy || code.length !== 6}>{busy ? t('Un momento…') : t('Activar')}</button>
            <button type="button" className="btn ghost" onClick={cancel}>{t('Cancelar')}</button>
          </div>
        </form>
      )}
    </div>
  )
}
