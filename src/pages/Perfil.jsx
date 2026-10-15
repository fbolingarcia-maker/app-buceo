import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { LEVELS, levelName } from '../lib/format'
import { t, LangSwitch } from '../lib/i18n'

const AGENCIES = ['PADI', 'SSI', 'NAUI', 'CMAS', 'SDI', 'RAID', 'BSAC', 'Otra']

export default function Perfil() {
  const { user, diver, center, isCenter, refresh, signOut } = useAuth()
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
      country: diver.country || '', bio: diver.bio || '', show_on_trips: diver.show_on_trips ?? true,
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
      country: form.country.trim() || null,
      bio: form.bio.trim() || null,
      show_on_trips: form.show_on_trips,
    }).eq('id', diver.id)
    error ? note('p', false, errMsg(error)) : (note('p', true, t('Perfil guardado')), refresh())
  }

  async function addCert(e) {
    e.preventDefault()
    const { error } = await supabase.from('certifications').insert({ diver_id: diver.id, agency: cert.agency, level: cert.level, card_number: cert.card_number.trim() || null })
    if (error) return note('c', false, errMsg(error))
    setCert({ ...cert, card_number: '' }); note('c', true, t('Certificación añadida')); loadCerts()
  }
  async function delCert(id) {
    if (!window.confirm(t('¿Eliminar esta certificación?'))) return
    const { error } = await supabase.from('certifications').delete().eq('id', id)
    error ? note('c', false, errMsg(error)) : loadCerts()
  }

  async function changePw(e) {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password: pw })
    error ? note('pw', false, errMsg(error)) : (note('pw', true, t('Contraseña cambiada')), setPw(''))
  }

  async function registerCenter(e) {
    e.preventDefault()
    const { error } = await supabase.rpc('register_center', { p_name: centerForm.name, p_phone: centerForm.phone })
    if (error) return note('ce', false, errMsg(error))
    await refresh(); go('/centro')
  }

  if (!diver || !form) return <p className="muted">{t('Cargando perfil…')}</p>

  return (
    <>
      <h1>{t('Tu perfil')}</h1>
      <p className="pill" style={{ marginTop: -4 }}>{isCenter ? t('Cuenta de centro de buceo') : t('Cuenta de buceador')}</p>
      <p className="muted small">{user.email}</p>

      <h2>{t('Idioma')}</h2>
      <div className="card"><LangSwitch full /></div>

      <form className="card" onSubmit={saveProfile}>
        <div className="field"><label>{t('Nombre')}</label><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
        <div className="grid2">
          <div className="field"><label>{t('Idiomas')}</label><input placeholder={t('Español, English')} value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} /></div>
          <div className="field"><label>{t('Inmersiones registradas')}</label><input type="number" min="0" value={form.logged_dives} onChange={(e) => setForm({ ...form, logged_dives: e.target.value })} /></div>
        </div>
        {!isCenter && <>
          <div className="field"><label>{t('País')}</label><input maxLength={60} placeholder={t('p. ej. España')} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
          <div className="field"><label>{t('Sobre ti')} <span className="muted small" style={{ fontWeight: 400 }}>({form.bio.length}/160)</span></label>
            <textarea rows="2" maxLength={160} placeholder={t('p. ej. Me encantan los tiburones ballena y la fotografía submarina')} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </div>
          <label className="check field"><input type="checkbox" checked={form.seeks_buddy} onChange={(e) => setForm({ ...form, seeks_buddy: e.target.checked })} /> {t('Busco compañero (buddy) de buceo')}</label>
          <label className="check field"><input type="checkbox" checked={form.show_on_trips} onChange={(e) => setForm({ ...form, show_on_trips: e.target.checked })} />
            <span>{t('Mostrar mi perfil a los demás buceadores de mis salidas')}<br /><span className="small muted">{t('Verán tu nombre y la inicial del apellido, tu nivel, nº de inmersiones, idiomas, país y esta descripción. Nunca tu email ni tu teléfono.')}</span></span>
          </label>
        </>}
        {show('p')}
        <button className="btn">{t('Guardar')}</button>
      </form>

      {!isCenter && <>
      <h2>{t('Certificaciones')}</h2>
      <div className="card">
        {certs.length === 0 && <p className="muted">{t('Añade al menos una para poder reservar.')}</p>}
        {certs.map((c) => (
          <div key={c.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <b>{c.agency} · {levelName(c.level)}</b>
              <div className="small muted">{c.card_number || t('Sin nº de tarjeta')} · {c.verified_at ? t('✅ Verificada por {centro}', { centro: c.centers?.name || t('un centro') }) : t('Sin verificar')}</div>
            </div>
            {!c.verified_at && <button className="btn small ghost" onClick={() => delCert(c.id)}>{t('Quitar')}</button>}
          </div>
        ))}
        <form onSubmit={addCert} style={{ marginTop: 12 }}>
          <div className="grid2">
            <div className="field"><label>{t('Agencia')}</label><select value={cert.agency} onChange={(e) => setCert({ ...cert, agency: e.target.value })}>{AGENCIES.map((a) => <option key={a} value={a}>{a === 'Otra' ? t('Otra') : a}</option>)}</select></div>
            <div className="field"><label>{t('Nivel')}</label><select value={cert.level} onChange={(e) => setCert({ ...cert, level: e.target.value })}>{LEVELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          </div>
          <div className="field"><label>{t('Nº de tarjeta (opcional)')}</label><input value={cert.card_number} onChange={(e) => setCert({ ...cert, card_number: e.target.value })} /></div>
          {show('c')}
          <button className="btn ghost">{t('+ Añadir certificación')}</button>
        </form>
      </div>
      </>}

      <h2>{t('Centro de buceo')}</h2>
      {center ? (
        <div className="card row between"><span>{t('Gestionas')} <b>{center.name}</b></span><Link to="/centro" className="btn small">{t('Ir al panel')}</Link></div>
      ) : (
        <form className="card" onSubmit={registerCenter}>
          <p className="small muted" style={{ marginTop: 0 }}>{t('¿Tienes un centro? Regístralo y tu cuenta pasará a ser de centro (panel, agenda, salidas y cobros).')}</p>
          <div className="grid2">
            <div className="field"><label>{t('Nombre del centro')}</label><input required value={centerForm.name} onChange={(e) => setCenterForm({ ...centerForm, name: e.target.value })} /></div>
            <div className="field"><label>{t('Teléfono / WhatsApp')}</label><input value={centerForm.phone} onChange={(e) => setCenterForm({ ...centerForm, phone: e.target.value })} /></div>
          </div>
          {show('ce')}
          <button className="btn ghost">{t('Registrar mi centro')}</button>
        </form>
      )}

      <h2>{t('Cuenta')}</h2>
      <form className="card" onSubmit={changePw}>
        <div className="field"><label>{t('Nueva contraseña')}</label><input type="password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        {show('pw')}
        <div className="row between">
          <button className="btn ghost" disabled={pw.length < 6}>{t('Cambiar contraseña')}</button>
          <button type="button" className="btn danger" onClick={() => { signOut(); go('/') }}>{t('Cerrar sesión')}</button>
        </div>
      </form>
    </>
  )
}
