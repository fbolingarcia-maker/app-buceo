import { useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { go } from '../lib/router'

export default function NuevaClave() {
  const { setRecovering } = useAuth()
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) return setError(errMsg(error))
    setRecovering(false); go('/perfil')
  }
  return (
    <form className="card" onSubmit={save} style={{ maxWidth: 420, margin: '0 auto' }}>
      <h1>Nueva contraseña</h1>
      <div className="field"><input type="password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
      {error && <div className="msg err">{error}</div>}
      <button className="btn block">Guardar</button>
    </form>
  )
}
