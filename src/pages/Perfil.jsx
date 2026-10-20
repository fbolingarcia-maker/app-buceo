import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, pwProblem } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { LEVELS, levelName } from '../lib/format'
import { t, LangSwitch } from '../lib/i18n'
import EliminarCuenta from './EliminarCuenta'
import DosPasos from './DosPasos'
import { VIEWS } from '../lib/AdminBar'
import Icon from '../lib/Icon'
import { ShieldCheck } from 'lucide-react'

const AGENCIES = ['PADI', 'SSI', 'NAUI', 'CMAS', 'SDI', 'RAID', 'BSAC', 'Otra']

export default function Perfil() {
  const { user, diver, ownCenter: center, isCenter, isAdmin, adminView, setViewAs, refresh, signOut } = useAuth()
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
    // Si venía de una salida, vuelve para terminar la reserva
    let back = null
    try { back = sessionStorage.getItem('afterCert'); sessionStorage.removeItem('afterCert') } catch (e) { /* sin almacenamiento */ }
    if (back) go(back)
  }
  async function delCert(id) {
    if (!window.confirm(t('¿Eliminar esta certificación?'))) return
    const { error } = await supabase.from('certifications').delete().eq('id', id)
    error ? note('c', false, errMsg(error)) : loadCerts()
  }

  async function changePw(e) {
    e.preventDefault()
    if (pwProblem(pw)) return note('pw', false, pwProblem(pw))
    const { error } = await supabase.auth.updateUser({ password: pw })
    error ? note('pw', false, errMsg(error)) : (note('pw', true, t('Contraseña cambiada')), setPw(''))
  }

  async function registerCenter(e) {
    e.preventDefault()
    const { error } = await supabase.rpc('register_center', { p_name: centerForm.name, p_phone: centerForm.phone })
    if (error) return note('ce', false, errMsg(error))
    await refresh(); go('/centro/verificacion')
  }

  if (!diver || !form) return <p className="muted">{t('Cargando perfil…')}</p>

  const account = (
    <>
      <h2>{t('Seguridad')}</h2>
      <DosPasos recommend={isAdmin} />
      <form className="card" onSubmit={changePw}>
        <div className="field"><label htmlFor="perfil-11">{t('Nueva contraseña')}</label><input id="perfil-11" type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-describedby="perfil-pw-hint" />
          <span id="perfil-pw-hint" className="small muted hint">{t('Mínimo 8 caracteres, con letras y números')}</span></div>
        {show('pw')}
        <div className="row between wrap" style={{ gap: 8 }}>
          <button className="btn ghost" disabled={pw.length < 8}>{t('Cambiar contraseña')}</button>
          <button type="button" className="btn danger" onClick={() => { signOut(); go('/') }}>{t('Cerrar sesión')}</button>
        </div>
      </form>
    </>
  )

  // Administrador en su vista propia: cuenta de plataforma, sin datos de buceo
  if (adminView === 'admin') return (
    <>
      <div className="card admin-card">
        <div className="row" style={{ gap: 14 }}>
          <div className="admin-avatar" aria-hidden><Icon icon={ShieldCheck} size={28} /></div>
          <div>
            <div className="big">{diver.full_name || user.email}</div>
            <div className="small">{user.email}</div>
            <span className="pill admin-pill" style={{ marginTop: 6 }}>{t('Administrador de la plataforma')}</span>
          </div>
        </div>
        <p className="small" style={{ marginBottom: 0 }}>{t('Tu acceso de administrador no aparece en ningún sitio público: los demás usuarios no ven este perfil ni saben que existe.')}</p>
      </div>

      <h2>{t('Ver la app como')}</h2>
      <div className="grid3">
        {VIEWS.map(([k, icon, label]) => (
          <button key={k} type="button" className={adminView === k ? 'card view-opt on' : 'card view-opt'} aria-pressed={adminView === k}
            onClick={() => { setViewAs(k); go(k === 'admin' ? '/admin' : k === 'center' ? '/centro' : '/') }}>
            <span style={{ fontSize: 26 }} aria-hidden>{icon}</span>
            <b>{t(label)}</b>
            <span className="small muted">{t(k === 'admin' ? 'Panel de la plataforma' : k === 'diver' ? 'Salidas, reservas y bitácora con tu cuenta' : 'Panel de cualquier centro, solo lectura')}</span>
          </button>
        ))}
      </div>

      {account}

      <h2>{t('Ajustes')}</h2>
      <div className="list">
        <div className="li">
          <span className="grow"><b>{t('Idioma de la app')}</b><small>{t('Por defecto, el de tu móvil')}</small></span>
          <LangSwitch />
        </div>
      </div>
    </>
  )

  return (
    <>
      <h1>{t('Tu perfil')}</h1>
      <p className="pill" style={{ marginTop: -4 }}>{isAdmin ? (isCenter ? t('Administrador · vista de centro') : t('Administrador · vista de buceador')) : isCenter ? t('Cuenta de centro de buceo') : t('Cuenta de buceador')}</p>
      <p className="muted small">{user.email}</p>

      <form className="card" onSubmit={saveProfile}>
        <div className="field"><label htmlFor="perfil-1">{t('Nombre')}</label><input id="perfil-1" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="perfil-2">{t('Idiomas')}</label><input id="perfil-2" placeholder={t('Español, English')} value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} /></div>
          <div className="field"><label htmlFor="perfil-3">{t('Inmersiones registradas')}</label><input id="perfil-3" type="number" inputMode="numeric" min="0" value={form.logged_dives} onChange={(e) => setForm({ ...form, logged_dives: e.target.value })} /></div>
        </div>
        {!isCenter && <>
          <div className="field"><label htmlFor="perfil-4">{t('País')}</label><input id="perfil-4" maxLength={60} autoComplete="country-name" placeholder={t('p. ej. España')} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
          <div className="field"><label htmlFor="perfil-5">{t('Sobre ti')} <span className="muted small" style={{ fontWeight: 400 }}>({form.bio.length}/160)</span></label><textarea id="perfil-5" rows="2" maxLength={160} placeholder={t('p. ej. Me encantan los tiburones ballena y la fotografía submarina')} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
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
              <div className="small muted">{c.card_number || t('Sin nº de tarjeta')} · {c.verified_at ? t('Verificada por {centro}', { centro: c.centers?.name || t('un centro') }) : t('Sin verificar')}</div>
            </div>
            {!c.verified_at && <button className="btn small ghost" onClick={() => delCert(c.id)}>{t('Quitar')}</button>}
          </div>
        ))}
        <form onSubmit={addCert} style={{ marginTop: 12 }}>
          <div className="grid2">
            <div className="field"><label htmlFor="perfil-6">{t('Agencia')}</label><select id="perfil-6" value={cert.agency} onChange={(e) => setCert({ ...cert, agency: e.target.value })}>{AGENCIES.map((a) => <option key={a} value={a}>{a === 'Otra' ? t('Otra') : a}</option>)}</select></div>
            <div className="field"><label htmlFor="perfil-7">{t('Nivel')}</label><select id="perfil-7" value={cert.level} onChange={(e) => setCert({ ...cert, level: e.target.value })}>{LEVELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          </div>
          <div className="field"><label htmlFor="perfil-8">{t('Nº de tarjeta (opcional)')}</label><input id="perfil-8" value={cert.card_number} onChange={(e) => setCert({ ...cert, card_number: e.target.value })} /></div>
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
            <div className="field"><label htmlFor="perfil-9">{t('Nombre del centro')}</label><input id="perfil-9" required value={centerForm.name} onChange={(e) => setCenterForm({ ...centerForm, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="perfil-10">{t('Teléfono / WhatsApp')}</label><input id="perfil-10" type="tel" inputMode="tel" autoComplete="tel" value={centerForm.phone} onChange={(e) => setCenterForm({ ...centerForm, phone: e.target.value })} /></div>
          </div>
          {show('ce')}
          <button className="btn ghost">{t('Registrar mi centro')}</button>
        </form>
      )}

      {account}

      <h2>{t('Ajustes')}</h2>
      <div className="list">
        <div className="li">
          <span className="grow"><b>{t('Idioma de la app')}</b><small>{t('Por defecto, el de tu móvil')}</small></span>
          <LangSwitch />
        </div>
      </div>

      <EliminarCuenta diver={diver} isCenter={isCenter} signOut={signOut} />
    </>
  )
}
