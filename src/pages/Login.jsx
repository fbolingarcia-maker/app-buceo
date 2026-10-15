import { useState } from 'react'
import { supabase, appUrl, errMsg } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('login') // login | signup | reset
  const [name, setName] = useState('')
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
      res = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: appUrl() } })
      if (!res.error && !res.data.session) setInfo('Te hemos enviado un email para confirmar tu cuenta. Ábrelo y pulsa el enlace.')
    } else {
      res = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
      if (!res.error) setInfo('Si el email existe, recibirás un enlace para crear una contraseña nueva.')
    }
    setBusy(false)
    if (res.error) setError(errMsg(res.error))
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1>{mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Recuperar acceso'}</h1>
      <form className="card" onSubmit={submit}>
        {mode === 'signup' && (
          <div className="field"><label>Nombre</label><input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></div>
        )}
        <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
        {mode !== 'reset' && (
          <div className="field"><label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>
        )}
        {error && <div className="msg err">{error}</div>}
        {info && <div className="msg ok">{info}</div>}
        <button className="btn block" disabled={busy}>
          {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
      </form>
      <div className="center small stack">
        {mode !== 'login' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('login') }}>Ya tengo cuenta</a></div>}
        {mode !== 'signup' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('signup') }}>Crear cuenta nueva</a></div>}
        {mode !== 'reset' && <div><a href="#/login" onClick={(e) => { e.preventDefault(); setMode('reset') }}>He olvidado mi contraseña</a></div>}
      </div>
    </div>
  )
}
