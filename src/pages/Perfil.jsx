import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, siteUrl } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { LEVELS, levelName, manilaDate } from '../lib/format'
import { MedicalCheck } from '../lib/medical'
import { t, LangSwitch } from '../lib/i18n'
import EliminarCuenta from './EliminarCuenta'
import DosPasos from './DosPasos'
import CambiarClave from './CambiarClave'
import { VIEWS } from '../lib/AdminBar'
import { CENTER_LANGS, langName } from '../lib/langs'
import Icon from '../lib/Icon'
import { ShieldCheck, Star, X } from 'lucide-react'
import DestinoSelect from '../lib/DestinoSelect'
import { hashParam } from '../lib/centro'
import { PushToggle, InstallButton, CurrencySelect } from '../lib/plus'
import { Camera } from 'lucide-react'
import { BuddyBreakdown, BUDDY_RATINGS, MIN_RATINGS, WINDOW_DAYS } from '../lib/buddy'

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const AGENCIES = ['PADI', 'SSI', 'NAUI', 'CMAS', 'SDI', 'RAID', 'BSAC', 'Otra']

export default function Perfil() {
  const { user, diver, ownCenter: center, isCenter, isAdmin, adminView, setViewAs, refresh, signOut } = useAuth()
  const [form, setForm] = useState(null)
  const [certs, setCerts] = useState([])
  const [cert, setCert] = useState({ agency: 'PADI', level: 'open_water', card_number: '' })
  const [centerForm, setCenterForm] = useState({ name: '', phone: '' })
  const [openCenter, setOpenCenter] = useState(false)
  const [msg, setMsg] = useState({})
  // Secciones del perfil (#/perfil?ver=datos|buceo|cuenta) para no tener una sola página larguísima
  const [ver, setVer] = useState(() => hashParam('ver') || 'datos')
  const pick = (v) => { setVer(v); setMsg({}); history.replaceState(null, '', window.location.pathname + '#/perfil?ver=' + v) }
  useEffect(() => {
    const on = () => { const v = hashParam('ver'); if (v) setVer(v) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  // Venía de una salida (para añadir la certificación, tallas…): enlace para volver
  const [back] = useState(() => { try { return sessionStorage.getItem('afterCert') } catch (e) { return null } })

  useEffect(() => {
    if (diver) setForm({
      full_name: diver.full_name || '', languages: diver.languages || [],
      logged_dives: diver.logged_dives ?? '', seeks_buddy: diver.seeks_buddy,
      country: diver.country || '', bio: diver.bio || '', show_on_trips: diver.show_on_trips ?? true, public_profile: !!diver.public_profile,
      wetsuit_size: diver.wetsuit_size || '', bcd_size: diver.bcd_size || '', fin_size: diver.fin_size || '',
      last_dive_date: diver.last_dive_date || '', nitrox: !!diver.nitrox,
      allergies: diver.allergies || '', alert_destinations: diver.alert_destinations || [],
      insurance_provider: diver.insurance_provider || '', insurance_expiry: diver.insurance_expiry || '',
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
      languages: form.languages,
      logged_dives: form.logged_dives === '' ? null : +form.logged_dives,
      seeks_buddy: form.seeks_buddy,
      country: form.country.trim() || null,
      bio: form.bio.trim() || null,
      show_on_trips: form.show_on_trips,
      public_profile: form.public_profile,
      ...(isCenter ? {} : {
        wetsuit_size: form.wetsuit_size || null, bcd_size: form.bcd_size || null, fin_size: form.fin_size.trim() || null,
        last_dive_date: form.last_dive_date || null, nitrox: form.nitrox,
        allergies: form.allergies.trim() || null, alert_destinations: form.alert_destinations,
        insurance_provider: form.insurance_provider.trim() || null, insurance_expiry: form.insurance_provider.trim() && form.insurance_expiry ? form.insurance_expiry : null,
      }),
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
      <CambiarClave />
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
            <Icon icon={icon} size={26} />
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

  const tab = isCenter && ver === 'buceo' ? 'datos' : ['datos', 'buceo', 'cuenta'].includes(ver) ? ver : 'datos'
  return (
    <>
      <h1>{t('Tu perfil')}</h1>
      <p className="pill" style={{ marginTop: -4 }}>{isAdmin ? (isCenter ? t('Administrador · vista de centro') : t('Administrador · vista de buceador')) : isCenter ? t('Cuenta de centro de buceo') : t('Cuenta de buceador')}</p>
      <div className="profile-head">
        {diver.avatar_url && /^https:\/\/lh3\.googleusercontent\.com\//.test(diver.avatar_url) && (
          <img className="profile-photo" src={diver.avatar_url} alt="" width="56" height="56" referrerPolicy="no-referrer" loading="lazy" />
        )}
        <p className="muted small" style={{ margin: 0 }}>{user.email}{diver.auth_provider === 'google' && <><br />{t('Cuenta conectada con Google')}</>}</p>
      </div>

      <div className="seg" role="tablist" aria-label={t('Secciones del perfil')}>
        {(isCenter ? [['datos', 'Datos'], ['cuenta', 'Cuenta']] : [['datos', 'Datos'], ['buceo', 'Buceo y salud'], ['cuenta', 'Cuenta']]).map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{t(n)}</button>
        ))}
      </div>
      {back && <div className="msg ok row between wrap" role="status" style={{ gap: 8 }}><span>{t('Cuando termines, vuelve a la salida para reservar.')}</span><Link to={back} className="btn small" onClick={() => { try { sessionStorage.removeItem('afterCert') } catch (e) { /* sin almacenamiento */ } }}>{t('Volver a la salida')}</Link></div>}

      {tab === 'datos' && (
        <form className="card" onSubmit={saveProfile}>
          <div className="field"><label htmlFor="perfil-1">{t('Nombre')}</label><input id="perfil-1" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
          <div className="field"><label htmlFor="perfil-3">{t('Inmersiones registradas')}</label><input id="perfil-3" type="number" inputMode="numeric" min="0" value={form.logged_dives} onChange={(e) => setForm({ ...form, logged_dives: e.target.value })} style={{ maxWidth: 160 }} /></div>
          <div className="field" role="group" aria-labelledby="perfil-2">
            <label id="perfil-2">{t('Idiomas que hablas')}</label>
            <div className="chips wrapc">
              {[...CENTER_LANGS.map((l) => l.code), ...form.languages.filter((x) => !CENTER_LANGS.some((l) => l.code === x))].map((code) => {
                const on = form.languages.includes(code)
                return <button key={code} type="button" className={on ? 'on' : ''} aria-pressed={on}
                  onClick={() => setForm({ ...form, languages: on ? form.languages.filter((x) => x !== code) : [...form.languages, code] })}>{langName(code)}</button>
              })}
            </div>
          </div>
          {!isCenter && <>
            <div className="field"><label htmlFor="perfil-4">{t('País')}</label><input id="perfil-4" maxLength={60} autoComplete="country-name" placeholder={t('p. ej. España')} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
            <div className="field"><label htmlFor="perfil-5">{t('Sobre ti')} <span className="muted small" style={{ fontWeight: 400 }}>({form.bio.length}/160)</span></label><textarea id="perfil-5" rows="2" maxLength={160} placeholder={t('p. ej. Me encantan los tiburones ballena y la fotografía submarina')} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            </div>
            <fieldset className="subform">
              <legend><b>{t('Avisos de última hora')}</b><span className="small muted">{t('Te escribimos cuando un centro de estos destinos tenga plazas libres para mañana o pasado (a veces con descuento).')}</span></legend>
              <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
                {form.alert_destinations.map((d) => (
                  <span key={d} className="pill">{d} <button type="button" className="linkish" aria-label={t('Quitar {d}', { d })} onClick={() => setForm({ ...form, alert_destinations: form.alert_destinations.filter((x) => x !== d) })}><Icon icon={X} size={12} /></button></span>
                ))}
                {form.alert_destinations.length === 0 && <span className="small muted">{t('Ningún destino')}</span>}
              </div>
              {form.alert_destinations.length < 5 && <DestinoSelect value="" onChange={(name) => name && !form.alert_destinations.includes(name) && setForm({ ...form, alert_destinations: [...form.alert_destinations, name] })} />}
            </fieldset>
            <label className="check field"><input type="checkbox" checked={form.seeks_buddy} onChange={(e) => setForm({ ...form, seeks_buddy: e.target.checked })} /> {t('Busco compañero (buddy) de buceo')}</label>
            <label className="check field"><input type="checkbox" checked={form.show_on_trips} onChange={(e) => setForm({ ...form, show_on_trips: e.target.checked })} />
              <span>{t('Mostrar mi perfil a los demás buceadores de mis salidas')}<br /><span className="small muted">{t('Verán tu nombre y la inicial del apellido, tu nivel, nº de inmersiones, idiomas, país y esta descripción. Nunca tu email ni tu teléfono.')}</span></span>
            </label>
            <label className="check field"><input type="checkbox" checked={form.public_profile} onChange={(e) => setForm({ ...form, public_profile: e.target.checked })} />
              <span>{t('Perfil público: que me puedan seguir y salir en el ranking')}<br /><span className="small muted">{t('Se ve tu rango, tus inmersiones y las que publiques en el muro. ')}{diver?.public_profile && <Link to={'/buzo/' + diver.id}>{t('Ver mi perfil público')}</Link>}</span></span>
            </label>
          </>}
          {tab === 'datos' && show('p')}
          <div className="sticky-save"><button className="btn block">{t('Guardar')}</button></div>
        </form>
      )}

      {tab === 'buceo' && <>
      <h2>{t('Certificaciones')}</h2>
      <div className="card">
        {certs.length === 0 && <p className="muted">{t('Añade al menos una para poder reservar.')}</p>}
        {certs.map((c) => (
          <div key={c.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <b>{c.agency} · {levelName(c.level)}</b>
              <div className="small muted">{c.card_number || t('Sin nº de tarjeta')} · {c.verified_at ? t('Verificada por {centro}', { centro: c.centers?.name || t('un centro') }) : t('Sin verificar')}</div>
            </div>
            <span className="row" style={{ gap: 4 }}>
              <CertPhoto cert={c} uid={user.id} onDone={loadCerts} />
              {!c.verified_at && <button className="btn small ghost" onClick={() => delCert(c.id)}>{t('Quitar')}</button>}
            </span>
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

      <h2>{t('Salud para bucear')}</h2>
      <div className="card"><MedicalCheck diver={diver} onSaved={refresh} /></div>

      <h2>{t('Tallas, seguro y alergias')}</h2>
          <form className="card" onSubmit={saveProfile}>
            <fieldset className="subform" style={{ marginTop: 0 }}>
              <legend><b>{t('Para el centro')}</b><span className="small muted">{t('Se lo enviamos al centro de cada salida que reserves, para que te prepare el equipo.')}</span></legend>
              <div className="grid3">
                <div className="field"><label htmlFor="perfil-ws">{t('Talla de traje')}</label><select id="perfil-ws" value={form.wetsuit_size} onChange={(e) => setForm({ ...form, wetsuit_size: e.target.value })}><option value="">—</option>{SIZES.map((x) => <option key={x}>{x}</option>)}</select></div>
                <div className="field"><label htmlFor="perfil-bcd">{t('Chaleco (BCD)')}</label><select id="perfil-bcd" value={form.bcd_size} onChange={(e) => setForm({ ...form, bcd_size: e.target.value })}><option value="">—</option>{SIZES.map((x) => <option key={x}>{x}</option>)}</select></div>
                <div className="field"><label htmlFor="perfil-fin">{t('Aletas')}</label><input id="perfil-fin" maxLength={12} placeholder={t('p. ej. 42')} value={form.fin_size} onChange={(e) => setForm({ ...form, fin_size: e.target.value })} /></div>
              </div>
              <div className="grid2">
                <div className="field"><label htmlFor="perfil-ld">{t('Última inmersión')}</label><input id="perfil-ld" type="date" max={manilaDate()} value={form.last_dive_date} onChange={(e) => setForm({ ...form, last_dive_date: e.target.value })} /></div>
                <label className="check field" style={{ alignSelf: 'end' }}><input type="checkbox" checked={form.nitrox} onChange={(e) => setForm({ ...form, nitrox: e.target.checked })} /> {t('Tengo certificación nitrox')}</label>
              </div>
              <div className="field">
                <label htmlFor="perfil-al">{t('Alergias (opcional)')}</label>
                <input id="perfil-al" maxLength={300} placeholder={t('p. ej. penicilina, marisco, picaduras de abeja')} value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
                <span className="small muted">{t('Solo la ve el centro de las salidas que reserves, en el manifiesto del barco. Puedes borrarla cuando quieras.')}</span>
              </div>
              <div className="grid2">
                <div className="field"><label htmlFor="perfil-ins">{t('Seguro de buceo')}</label><input id="perfil-ins" maxLength={60} placeholder={t('p. ej. DAN')} value={form.insurance_provider} onChange={(e) => setForm({ ...form, insurance_provider: e.target.value })} /></div>
                <div className="field"><label htmlFor="perfil-insx">{t('Válido hasta')}</label><input id="perfil-insx" type="date" value={form.insurance_expiry} onChange={(e) => setForm({ ...form, insurance_expiry: e.target.value })} /></div>
              </div>
            </fieldset>
            {show('p')}
            <div className="sticky-save"><button className="btn block">{t('Guardar')}</button></div>
          </form>

      {BUDDY_RATINGS && <BuddyRatings diver={diver} refresh={refresh} />}
      </>}

      {tab === 'cuenta' && <>
        <h2>{t('Centro de buceo')}</h2>
        {center ? (
          <div className="card row between"><span>{t('Gestionas')} <b>{center.name}</b></span><Link to="/centro" className="btn small">{t('Ir al panel')}</Link></div>
        ) : (
          !openCenter ? (
            <div className="card row between wrap" style={{ gap: 10 }}>
              <span className="small muted grow" style={{ minWidth: 180 }}>{t('¿Tienes un centro? Regístralo y tu cuenta pasará a ser de centro (panel, agenda, salidas y cobros).')}</span>
              <button type="button" className="btn small ghost" onClick={() => setOpenCenter(true)}>{t('Registrar mi centro')}</button>
            </div>
          ) :
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
          <PushToggle />
          <div className="li">
            <span className="grow"><b>{t('Precios aproximados en')}</b><small>{t('El cobro siempre es en pesos filipinos; esto solo es orientativo.')}</small></span>
            <CurrencySelect />
          </div>
          <div className="li"><span className="grow"><b>{t('App en el móvil')}</b><small>{t('Instálala para abrirla como una app y recibir avisos.')}</small></span><InstallButton /></div>
          <a className="li" href={siteUrl() + 'legal/privacy'}><span className="grow"><b>{t('Privacidad')}</b></span></a>
          <a className="li" href={siteUrl() + 'legal/terms'}><span className="grow"><b>{t('Términos de uso')}</b></span></a>
          <a className="li" href={siteUrl() + 'legal/cancellation'}><span className="grow"><b>{t('Política de cancelación')}</b></span></a>
          <a className="li" href="mailto:divingslot@gmail.com"><span className="grow"><b>{t('Contacto')}</b><small>divingslot@gmail.com</small></span></a>
        </div>
        <button type="button" className="btn block ghost" style={{ marginTop: 16 }} onClick={async () => { await signOut(); go('/') }}>{t('Cerrar sesión')}</button>
        <EliminarCuenta diver={diver} isCenter={isCenter} signOut={signOut} />
      </>}
    </>
  )
}

// Valoraciones como buddy: el buceador decide si sus compañeros de inmersión pueden valorarle
function BuddyRatings({ diver, refresh }) {
  const [on, setOn] = useState(!!diver?.buddy_ratings_enabled)
  const [sum, setSum] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setOn(!!diver?.buddy_ratings_enabled) }, [diver?.buddy_ratings_enabled])
  useEffect(() => {
    if (on) supabase.rpc('my_buddy_summary').then(({ data }) => setSum(data || { count: 0 }))
  }, [on])
  async function toggle() {
    setBusy(true); setError('')
    const { error } = await supabase.from('divers').update({ buddy_ratings_enabled: !on }).eq('id', diver.id)
    setBusy(false)
    if (error) return setError(errMsg(error))
    setOn(!on); refresh()
  }
  return (
    <>
      <h2>{t('Valoraciones como buddy')}</h2>
      <div className="card">
        <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div>
            <b>{t('Dejar que mis buddies me valoren')}</b>
            <div className="small muted">{t('Tus compañeros de salida puntúan de 1 a 5 tu flotabilidad, gestión del aire, atención al buddy, seguridad en el agua y respeto al arrecife.')}</div>
          </div>
          <button type="button" role="switch" aria-checked={on} className={'switch' + (on ? ' on' : '')} disabled={busy} onClick={toggle} aria-label={t('Dejar que mis buddies me valoren')}><span /></button>
        </div>
        {error && <div className="msg err" role="alert">{error}</div>}
        {on ? (
          <div style={{ marginTop: 14 }}><BuddyBreakdown s={sum} own /></div>
        ) : (
          <ul className="small muted ticks">
            <li>{t('Solo te valora quien buceó contigo: los dos con check-in en la misma salida, hasta {n} días después.', { n: WINDOW_DAYS })}</li>
            <li>{t('Es anónimo: nadie ve quién te valoró ni las notas sueltas.')}</li>
            <li>{t('Tu media se muestra en «¿Quién va?» cuando tengas al menos {m} valoraciones.', { m: MIN_RATINGS })}</li>
            <li>{t('Puedes desactivarlo cuando quieras: tu media deja de verse al momento.')}</li>
          </ul>
        )}
        {on && <p className="small muted" style={{ margin: '12px 0 0' }}><Icon icon={Star} size={14} /> {t('Se ve en «¿Quién va?» de tus salidas. Desactívalo cuando quieras y deja de verse al momento.')}</p>}
      </div>
    </>
  )
}

// Foto de la tarjeta de certificación (PADI/SSI eCard o la de plástico): la ve el centro de las salidas que reserves
function CertPhoto({ cert, uid, onDone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true); setErr('')
    const ext = (f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const path = uid + '/cards/' + cert.id + '.' + ext
    const up = await supabase.storage.from('dive-photos').upload(path, f, { upsert: true, contentType: f.type })
    if (up.error) { setBusy(false); return setErr(errMsg(up.error)) }
    const { error } = await supabase.from('certifications').update({ photo_path: path }).eq('id', cert.id)
    setBusy(false)
    if (error) return setErr(errMsg(error))
    onDone()
  }
  return (
    <label className={'btn small ghost' + (busy ? ' disabled' : '')} title={t('La ve el centro de las salidas que reserves')} style={{ cursor: 'pointer' }}>
      <Icon icon={Camera} size={16} /> {cert.photo_path ? t('Cambiar foto') : t('Foto de la tarjeta')}
      <input type="file" accept="image/*" capture="environment" onChange={pick} style={{ display: 'none' }} disabled={busy} />
      {err && <span className="small" style={{ color: 'var(--bad)' }}>{err}</span>}
    </label>
  )
}
