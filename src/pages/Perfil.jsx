import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { LEVELS, levelName } from '../lib/format'

const AGENCIES = ['PADI', 'SSI', 'NAUI', 'CMAS', 'SDI', 'RAID', 'BSAC', 'Otra']

export default function Perfil() {
  const { user, diver, center, refresh, signOut } = useAuth()
  const [form, setForm] = useState(null)
  const [certs, setCerts] = useState([])
  const [cert, setCert] = useState({ agency: 'PADI', level: 'open_water', card_number: '' })
  const [pw, setPw] = useState('')
  const [centerForm, setCenterForm] = useState({ name: '', phone: '' })
  const [msg, setMsg] = useState({})

  useEffect(() => {
    if (diver) setForm({
      full_name: diver.full_name || '', languages: (diver.languages || []).join(', '),
      logged_dives: diver.logged_dives ?? '', seeks_buddy: diver.seeks_buddy,
    })
  }, [diver])

  const loadCerts = useCallback(async () => {
    if (!diver) return
    const { data } = await supabase.from('certifications').select('*, centers:verified_by(name)').eq('diver_id', diver.id).order('level', { ascending: false })
    setCerts(data || [])
  }, [diver])
  useEffect(() => { loadCerts() }, [loadCerts])

  const note = (k, ok, text) => setMsg({ [k]: { ok, text } })
  const show = (k) => msg[k] && <div className={msg[k].ok ? 'msg ok' : 'msg err'}>{msg[k].text}</div>

  async function saveProfile(e) {
    e.preventDefault()
    const { error } = await supabase.from('divers').update({
      full_name: form.full_name.trim(),
      languages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
      logged_dives: form.logged_dives === '' ? null : +form.logged_dives,
      seeks_buddy: form.seeks_buddy,
    }).eq('id', diver.id)
    error ? note('p', false, errMsg(error)) : (note('p', true, 'Perfil guardado'), refresh())
  }

  async function addCert(e) {
    e.preventDefault()
    const { error } = await supabase.from('certifications').insert({ diver_id: diver.id, agency: cert.agency, level: cert.level, card_number: cert.card_number.trim() || null })
    if (error) return note('c', false, errMsg(error))
    setCert({ ...cert, card_number: '' }); note('c', true, 'Certificación añadida'); loadCerts()
  }
  async function delCert(id) {
    if (!window.confirm('¿Eliminar esta certificación?')) return
    const { error } = await supabase.from('certifications').delete().eq('id', id)
    error ? note('c', false, errMsg(error)) : loadCerts()
  }

  async function changePw(e) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: pw })
    error ? note('pw', false, errMsg(error)) : (note('pw', true, 'Contraseña cambiada'), setPw(''))
  }

  async function registerCenter(e) {
    e.preventDefault()
    const { error } = await supabase.rpc('register_center', { p_name: centerForm.name, p_phone: centerForm.phone })
    if (error) return note('ce', false, errMsg(error))
    await refresh(); go('/centro')
  }

  if (!diver || !form) return <p className="muted">Cargando perfil…</p>

  return (
    <>
      <h1>Tu perfil</h1>
      <p className="muted small">{user.email}</p>

      <form className="card" onSubmit={saveProfile}>
        <div className="field"><label>Nombre</label><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
        <div className="grid2">
          <div className="field"><label>Idiomas</label><input placeholder="Español, English" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} /></div>
          <div className="field"><label>Inmersiones registradas</label><input type="number" min="0" value={form.logged_dives} onChange={(e) => setForm({ ...form, logged_dives: e.target.value })} /></div>
        </div>
        <label className="check field"><input type="checkbox" checked={form.seeks_buddy} onChange={(e) => setForm({ ...form, seeks_buddy: e.target.checked })} /> Busco compañero (buddy) de buceo</label>
        {show('p')}
        <button className="btn">Guardar</button>
      </form>

      <h2>Certificaciones</h2>
      <div className="card">
        {certs.length === 0 && <p className="muted">Añade al menos una para poder reservar.</p>}
        {certs.map((c) => (
          <div key={c.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <b>{c.agency} · {levelName(c.level)}</b>
              <div className="small muted">{c.card_number || 'Sin nº de tarjeta'} · {c.verified_at ? `✅ Verificada por ${c.centers?.name || 'un centro'}` : 'Sin verificar'}</div>
            </div>
            {!c.verified_at && <button className="btn small ghost" onClick={() => delCert(c.id)}>Quitar</button>}
          </div>
        ))}
        <form onSubmit={addCert} style={{ marginTop: 12 }}>
          <div className="grid2">
            <div className="field"><label>Agencia</label><select value={cert.agency} onChange={(e) => setCert({ ...cert, agency: e.target.value })}>{AGENCIES.map((a) => <option key={a}>{a}</option>)}</select></div>
            <div className="field"><label>Nivel</label><select value={cert.level} onChange={(e) => setCert({ ...cert, level: e.target.value })}>{LEVELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          </div>
          <div className="field"><label>Nº de tarjeta (opcional)</label><input value={cert.card_number} onChange={(e) => setCert({ ...cert, card_number: e.target.value })} /></div>
          {show('c')}
          <button className="btn ghost">+ Añadir certificación</button>
        </form>
      </div>

      <h2>Centro de buceo</h2>
      {center ? (
        <div className="card row between"><span>Gestionas <b>{center.name}</b></span><Link to="/centro" className="btn small">Panel del centro</Link></div>
      ) : (
        <form className="card" onSubmit={registerCenter}>
          <p className="small muted" style={{ marginTop: 0 }}>¿Tienes un centro? Regístralo para publicar salidas.</p>
          <div className="grid2">
            <div className="field"><label>Nombre del centro</label><input required value={centerForm.name} onChange={(e) => setCenterForm({ ...centerForm, name: e.target.value })} /></div>
            <div className="field"><label>Teléfono / WhatsApp</label><input value={centerForm.phone} onChange={(e) => setCenterForm({ ...centerForm, phone: e.target.value })} /></div>
          </div>
          {show('ce')}
          <button className="btn ghost">Registrar mi centro</button>
        </form>
      )}

      <h2>Cuenta</h2>
      <form className="card" onSubmit={changePw}>
        <div className="field"><label>Nueva contraseña</label><input type="password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        {show('pw')}
        <div className="row between">
          <button className="btn ghost" disabled={pw.length < 6}>Cambiar contraseña</button>
          <button type="button" className="btn danger" onClick={() => { signOut(); go('/') }}>Cerrar sesión</button>
        </div>
      </form>
    </>
  )
}
