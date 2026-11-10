// 11 nov 2026: equipo del centro, check-in con QR, widget de reservas, pago en un toque y comunidad
// (seguir, muro, avistamientos, rangos y retos, ranking y actividades sin certificación).
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t } from './i18n'
import { Link } from './router'
import { dayLabel, manilaDate, addDays, time } from './format'
import Icon from './Icon'
import { Check, Copy, Camera, X, Users, UserPlus, QrCode, Trophy, Target, Fish, Trash, Code, Award } from 'lucide-react'

// ── Actividades ──
export const ACTIVITIES = [['scuba', 'Buceo'], ['snorkel', 'Esnórquel'], ['freedive', 'Apnea'], ['try_dive', 'Bautismo']]
export const activityName = (a) => t((ACTIVITIES.find(([k]) => k === a) || ACTIVITIES[0])[1])
export const noCert = (trip) => ['snorkel', 'freedive', 'try_dive'].includes(trip?.activity)
export const noMedical = (trip) => trip?.activity === 'snorkel'
export function ActivityPill({ trip }) {
  if (!trip?.activity || trip.activity === 'scuba') return null
  return <span className="pill act">{activityName(trip.activity)}{noCert(trip) ? ' · ' + t('sin certificación') : ''}</span>
}

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="btn small ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) })}>
      <Icon icon={done ? Check : Copy} size={14} /> {done ? t('Copiado') : label}
    </button>
  )
}

// ── Equipo del centro (Ajustes) ──
export function TeamSection({ center, readOnly }) {
  const [data, setData] = useState(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('guide')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => supabase.rpc('team_list', { p_center: center.id }).then(({ data, error }) => setData(error ? { members: [], invites: [], error: errMsg(error) } : data)), [center.id])
  useEffect(() => { load() }, [load])
  async function invite(e) {
    e.preventDefault(); setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('team_invite', { p_center: center.id, p_email: email.trim(), p_role: role })
    setBusy(false)
    if (error) return setMsg({ err: errMsg(error) })
    setMsg({ ok: t('Invitación enviada a {email}. Caduca en 7 días.', { email: email.trim() }) }); setEmail(''); load()
  }
  const remove = async (m) => {
    if (!window.confirm(t('¿Quitar a {name} del equipo?', { name: m.full_name || m.email }))) return
    const { error } = await supabase.rpc('team_remove', { p_center: center.id, p_user: m.user_id })
    if (error) setMsg({ err: errMsg(error) }); else load()
  }
  const roleName = (r) => ({ owner: t('Titular'), manager: t('Responsable'), guide: t('Guía') })[r] || r
  if (!data) return <div className="card muted">{t('Cargando…')}</div>
  return (
    <div className="card stack">
      <p className="small muted" style={{ margin: 0 }}>{t('Los responsables gestionan todo el centro. Los guías ven las salidas que les asignas con su manifiesto y hacen el check-in con QR; no ven cobros ni ajustes.')}</p>
      <ul className="team-list">
        {data.members.map((m) => (
          <li key={m.user_id} className="row between wrap" style={{ gap: 6 }}>
            <span><b>{m.full_name || m.email}</b>{m.me ? ' · ' + t('Tú') : ''}<br /><span className="small muted">{m.email}</span></span>
            <span className="row" style={{ gap: 6 }}>
              <span className={m.role === 'guide' ? 'pill' : 'pill ok'}>{roleName(m.role)}</span>
              {!readOnly && m.role !== 'owner' && !m.me && <button type="button" className="btn xs ghost" onClick={() => remove(m)} aria-label={t('Quitar')}><Icon icon={Trash} size={14} /></button>}
            </span>
          </li>
        ))}
        {data.invites.map((i) => (
          <li key={i.id} className="row between wrap muted" style={{ gap: 6 }}>
            <span>{i.email}<br /><span className="small">{t('Invitación pendiente')} · {roleName(i.role)}</span></span>
            {!readOnly && <button type="button" className="btn xs ghost" onClick={() => supabase.rpc('team_revoke_invite', { p_invite: i.id }).then(load)}>{t('Anular')}</button>}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form className="stack" onSubmit={invite}>
          <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="field grow" style={{ margin: 0 }}><label htmlFor="inv-email">{t('Email de la persona')}</label>
              <input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="inv-role">{t('Papel')}</label>
              <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}><option value="guide">{t('Guía')}</option><option value="manager">{t('Responsable')}</option></select></div>
          </div>
          <button className="btn" disabled={busy || !email}><Icon icon={UserPlus} size={16} /> {busy ? t('Un momento…') : t('Invitar')}</button>
        </form>
      )}
      {msg?.ok && <div className="msg ok" role="status">{msg.ok}</div>}
      {(msg?.err || data.error) && <div className="msg err" role="alert">{msg?.err || data.error}</div>}
    </div>
  )
}

// Aceptar una invitación: #/equipo/aceptar?token=…
export function AcceptInvite({ token, session, onDone }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.rpc('team_invite_info', { p_token: token }).then(({ data, error }) => (error ? setErr(errMsg(error)) : setInfo(data))) }, [token])
  if (err && !info) return <div className="card"><p className="msg err" role="alert">{err}</p></div>
  if (!info) return <p className="muted">{t('Cargando…')}</p>
  const role = info.role === 'guide' ? t('guía') : t('responsable')
  return (
    <div className="card stack">
      <h1 style={{ margin: 0 }}>{t('Invitación de {centro}', { centro: info.center_name })}</h1>
      <p style={{ margin: 0 }}>{t('Te invitan a su equipo en DivingSlot como {papel}.', { papel: role })} {info.role === 'guide' ? t('Verás las salidas que te asignen, el manifiesto, y harás el check-in con QR.') : t('Podrás gestionar salidas, reservas y cobros del centro.')}</p>
      <p className="small muted" style={{ margin: 0 }}>{t('La invitación es para {email}. Entra con ese email.', { email: info.email })}</p>
      {info.expired || info.accepted ? <div className="msg err" role="alert">{info.accepted ? t('Esta invitación ya se usó.') : t('Esta invitación ha caducado. Pide al centro que te mande otra.')}</div>
        : session ? <button type="button" className="btn block" disabled={busy} onClick={async () => {
          setBusy(true); setErr('')
          const { error } = await supabase.rpc('team_accept', { p_token: token })
          setBusy(false)
          if (error) return setErr(errMsg(error))
          onDone(info.role)
        }}>{busy ? t('Un momento…') : t('Unirme al equipo')}</button> : null}
      {err && <div className="msg err" role="alert">{err}</div>}
    </div>
  )
}

// ── Widget de reservas (Ajustes) ──
export function WidgetSection({ center }) {
  const base = window.location.origin + '/w/' + center.id
  const [lang, setLang] = useState('en')
  const url = base + '?lang=' + lang
  const code = `<iframe src="${url}" title="${center.name.replace(/"/g, '')}" style="width:100%;max-width:640px;height:560px;border:0" loading="lazy"></iframe>`
  return (
    <div className="card stack">
      <p style={{ margin: 0 }}>{t('Pon tus próximas salidas en tu propia web, con plazas y precio al momento. Al pulsar «Reservar», el buceador termina la reserva en DivingSlot y queda como reserva de tu enlace propio.')}</p>
      <div className="seg" role="group" aria-label={t('Idioma del widget')}>
        <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        <button type="button" className={lang === 'es' ? 'on' : ''} onClick={() => setLang('es')}>Español</button>
      </div>
      <div className="code-box" aria-label={t('Código para tu web')}>{code}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        <CopyBtn text={code} label={t('Copiar código')} />
        <a className="btn small ghost" href={url} target="_blank" rel="noreferrer"><Icon icon={Code} size={14} /> {t('Ver el widget')}</a>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('WordPress, Wix o Squarespace: añade un bloque «HTML personalizado» o «Insertar código» y pega el código.')}</p>
    </div>
  )
}

// ── Guías asignados a una salida (Agenda) ──
export function GuideAssign({ trip, team, assigned, onSaved, readOnly }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(assigned.map((g) => g.user_id))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setSel(assigned.map((g) => g.user_id)) }, [assigned])
  const names = assigned.map((g) => g.name).join(', ')
  // Sin equipo ni guías asignados no se repite en cada salida: la Agenda muestra una sola invitación arriba
  if (!names && team.length === 0) return null
  return (
    <div className="guide-assign small">
      <span><Icon icon={Users} size={14} /> {t('Guías')}: {names || <span className="muted">{t('sin asignar')}</span>}</span>
      {!readOnly && team.length > 0 && <button type="button" className="linkish small" onClick={() => setOpen(!open)}>{open ? t('Cerrar') : t('Asignar')}</button>}
      {open && (
        <div className="stack" style={{ marginTop: 6 }}>
          {[...team].sort((a, b) => (a.role === 'guide' ? 0 : 1) - (b.role === 'guide' ? 0 : 1)).map((m) => (
            <label key={m.user_id} className="check"><input type="checkbox" checked={sel.includes(m.user_id)} onChange={() => setSel((s) => (s.includes(m.user_id) ? s.filter((x) => x !== m.user_id) : [...s, m.user_id]))} /> {m.full_name || m.email}{m.role !== 'guide' ? <span className="muted"> · {t('Responsable')}</span> : null}</label>
          ))}
          <button type="button" className="btn small" disabled={busy} onClick={async () => {
            setBusy(true)
            const { error } = await supabase.rpc('assign_guides', { p_trip: trip.id, p_users: sel })
            setBusy(false)
            if (!error) { setOpen(false); onSaved() } else window.alert(errMsg(error))
          }}>{t('Guardar guías')}</button>
          <p className="muted" style={{ margin: 0 }}>{t('La salida pide {n} guías.', { n: trip.guides })}</p>
        </div>
      )}
    </div>
  )
}

// ── Check-in con QR ──
// Pase del buceador (Reservas): QR + código de 8 caracteres por si el guía no puede escanear
export function CheckinPass({ booking }) {
  const [open, setOpen] = useState(false)
  const [pass, setPass] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!open || pass) return
    supabase.rpc('checkin_pass', { p_booking: booking.id }).then(({ data, error }) => (error ? setErr(errMsg(error)) : setPass(data)))
  }, [open, pass, booking.id])
  return (
    <>
      <button type="button" className="btn small ghost" onClick={() => setOpen(true)}><Icon icon={QrCode} size={16} /> {t('Mi QR de embarque')}</button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t('Mi QR de embarque')} onClick={() => setOpen(false)}>
          <div className="modal-card center" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-x" onClick={() => setOpen(false)} aria-label={t('Cerrar')}><Icon icon={X} /></button>
            <h2 style={{ marginTop: 0 }}>{t('Enséñalo al guía en el muelle')}</h2>
            {err && <div className="msg err" role="alert">{err}</div>}
            {pass ? <>
              <img src={pass.qr} alt={t('Código QR de tu reserva')} className="qr-img" />
              <p className="small muted" style={{ margin: '6px 0 0' }}>{t('Si no se puede escanear, dile este código:')}</p>
              <p className="pass-code" data-code="1">{pass.code.slice(0, 4)}-{pass.code.slice(4)}</p>
              {pass.checked_in_at && <div className="msg ok" role="status">{t('Ya estás a bordo')}</div>}
            </> : !err && <p className="muted">{t('Cargando…')}</p>}
          </div>
        </div>
      )}
    </>
  )
}

// Escáner del guía o del centro: cámara (BarcodeDetector) o código tecleado
export function QrCheckin({ onDone, ghost }) {
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState('')
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cam, setCam] = useState(false)
  const video = useRef(null)
  const stream = useRef(null)
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

  const stop = () => { stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; setCam(false) }
  useEffect(() => () => stop(), [])
  const send = useCallback(async (code) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('checkin_scan', { p_code: code })
    setBusy(false)
    setRes(error ? { err: errMsg(error) } : data)
    if (!error) { setManual(''); onDone?.(data) }
  }, [onDone])

  async function startCam() {
    setRes(null)
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      setCam(true)
      setTimeout(async () => {
        const v = video.current
        if (!v) return
        v.srcObject = stream.current
        await v.play().catch(() => {})
        const det = new window.BarcodeDetector({ formats: ['qr_code'] })
        const tick = async () => {
          if (!stream.current) return
          const codes = await det.detect(v).catch(() => [])
          const hit = codes.find((c) => /^DSCHK:/.test(c.rawValue))
          if (hit) { stop(); return send(hit.rawValue) }
          setTimeout(tick, 250)
        }
        tick()
      }, 50)
    } catch (e) { setRes({ err: t('No se puede abrir la cámara. Teclea el código del buceador.') }) }
  }

  return (
    <>
      <button type="button" className={ghost ? 'btn small ghost' : 'btn small'} onClick={() => { setOpen(true); setRes(null) }}><Icon icon={QrCode} size={16} /> {t('Check-in con QR')}</button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t('Check-in con QR')} onClick={() => { stop(); setOpen(false) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-x" onClick={() => { stop(); setOpen(false) }} aria-label={t('Cerrar')}><Icon icon={X} /></button>
            <h2 style={{ marginTop: 0 }}>{t('Check-in con QR')}</h2>
            {cam ? <video ref={video} className="qr-video" playsInline muted /> : canScan && <button type="button" className="btn block" onClick={startCam}><Icon icon={Camera} size={16} /> {t('Escanear QR')}</button>}
            <form className="row" style={{ gap: 8, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (manual.trim()) send(manual.trim()) }}>
              <input aria-label={t('Código del buceador')} placeholder={t('Código (p. ej. 7F3A-91C2)')} value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" autoComplete="off" />
              <button className="btn" disabled={busy || !manual.trim()}>{t('Hecho')}</button>
            </form>
            {busy && <p className="muted">{t('Un momento…')}</p>}
            {res?.err && <div className="msg err" role="alert">{res.err}</div>}
            {res && !res.err && (
              <div className="msg ok" role="status">
                <b>{res.name}</b>{res.seats > 1 ? ' ×' + res.seats : ''} · {res.already ? t('ya estaba a bordo') : t('a bordo')}
                {res.due_php > 0 && <><br />{t('Le quedan {amount} por pagar.', { amount: '₱' + res.due_php.toLocaleString('en-US') })}</>}
                {res.status === 'pending_payment' && <><br />{t('Aún no ha pagado la señal.')}</>}
              </div>
            )}
            {res && !res.err && canScan && <button type="button" className="btn small ghost" onClick={startCam}>{t('Escanear otro')}</button>}
          </div>
        </div>
      )}
    </>
  )
}

// ── Seguir ──
export function FollowButton({ type, id, small }) {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.rpc('follow_state', { p_type: type, p_id: id }).then(({ data }) => setSt(data || { followers: 0, following: false })) }, [type, id])
  if (!st) return null
  return (
    <button type="button" className={(st.following ? 'btn ghost' : 'btn') + (small ? ' small' : ' small')} disabled={busy} aria-pressed={st.following} onClick={async () => {
      setBusy(true)
      const { data, error } = await supabase.rpc(st.following ? 'unfollow' : 'follow', { p_type: type, p_id: id })
      setBusy(false)
      if (error) return window.alert(errMsg(error))
      setSt({ following: data.following, followers: st.followers + (data.following ? 1 : -1) })
    }}>
      {st.following ? <><Icon icon={Check} size={14} /> {t('Siguiendo')}</> : t('Seguir')}{st.followers > 0 ? ` · ${st.followers}` : ''}
    </button>
  )
}

// ── Avistamientos ──
export const SPECIES = ['Tiburón zorro', 'Tiburón ballena', 'Tortuga', 'Sardinas', 'Manta', 'Delfines', 'Pez rana', 'Caballito de mar', 'Nudibranquios', 'Jureles', 'Tiburón de puntas blancas', 'Pulpo mimo']
export function Sightings({ siteId = null, area = null, sites = null, title = true, days = 14, allowAdd = true, session }) {
  const [list, setList] = useState(null)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ site: siteId || '', species: '', note: '', seen_on: manilaDate() })
  const [err, setErr] = useState('')
  const load = useCallback(() => supabase.rpc('sightings', { p_site: siteId, p_area: area, p_days: days }).then(({ data }) => setList(data || [])), [siteId, area, days])
  useEffect(() => { load() }, [load])
  if (!list) return null
  return (
    <section className="sightings">
      {title && <h2 className="row" style={{ gap: 6 }}><Icon icon={Fish} size={20} /> {t('Avistamientos recientes')}</h2>}
      {list.length === 0 && <p className="small muted">{t('Nadie ha contado nada en los últimos {n} días.', { n: days })}</p>}
      <ul className="sight-list">
        {list.slice(0, 12).map((s) => (
          <li key={s.id}>
            <b>{t(s.species)}</b> · {siteId ? '' : s.site + ' · '}<span className="muted small">{dayLabel(s.seen_on, { day: 'numeric', month: 'short' })} · {s.by}</span>
            {s.note && <div className="small">{s.note}</div>}
            {s.mine && <button type="button" className="linkish small" style={{ marginLeft: 8 }} onClick={() => supabase.rpc('delete_sighting', { p_id: s.id }).then(load)}>{t('Borrar')}</button>}
          </li>
        ))}
      </ul>
      {allowAdd && session && !adding && <button type="button" className="btn small ghost" onClick={() => setAdding(true)}>{t('Contar lo que has visto')}</button>}
      {allowAdd && !session && <p className="small muted">{t('Entra para contar lo que has visto.')}</p>}
      {adding && (
        <form className="card stack" onSubmit={async (e) => {
          e.preventDefault(); setErr('')
          const { error } = await supabase.rpc('add_sighting', { p_site: f.site, p_species: f.species, p_note: f.note, p_seen_on: f.seen_on })
          if (error) return setErr(errMsg(error))
          setAdding(false); setF({ ...f, species: '', note: '' }); load()
        }}>
          {!siteId && sites && (
            <div className="field"><label htmlFor="sg-site">{t('Punto de buceo')}</label>
              <select id="sg-site" required value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          )}
          <div className="field"><label htmlFor="sg-sp">{t('¿Qué has visto?')}</label>
            <input id="sg-sp" list="sg-species" required minLength={2} maxLength={40} value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })} />
            <datalist id="sg-species">{SPECIES.map((s) => <option key={s} value={t(s)} />)}</datalist></div>
          <div className="chips">{SPECIES.slice(0, 6).map((s) => <button key={s} type="button" className={f.species === t(s) ? 'chip on' : 'chip'} onClick={() => setF({ ...f, species: t(s) })}>{t(s)}</button>)}</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="field grow"><label htmlFor="sg-note">{t('Detalle (opcional)')}</label><input id="sg-note" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('p. ej. dos, a 30 m, a primera hora')} /></div>
            <div className="field"><label htmlFor="sg-day">{t('Día')}</label><input id="sg-day" type="date" min={addDays(manilaDate(), -7)} max={manilaDate()} value={f.seen_on} onChange={(e) => setF({ ...f, seen_on: e.target.value })} /></div>
          </div>
          {err && <div className="msg err" role="alert">{err}</div>}
          <div className="row" style={{ gap: 8 }}><button className="btn">{t('Publicar')}</button><button type="button" className="btn ghost" onClick={() => setAdding(false)}>{t('Cancelar')}</button></div>
        </form>
      )}
    </section>
  )
}

// ── Rangos y retos (Bitácora) ──
const RANK = { new: 'Recién llegado', explorer: 'Explorador', regular: 'Habitual', veteran: 'Veterano', master: 'Maestro', legend: 'Leyenda' }
export const rankName = (k) => t(RANK[k] || k)
const CHAL = {
  logs10: 'Registra 10 inmersiones', sites5: 'Bucea en 5 puntos distintos', dest3: 'Bucea en 3 destinos', deep30: 'Baja de 30 m',
  signed5: '5 inmersiones firmadas por un centro', sight3: 'Cuenta 3 avistamientos', year25: '25 inmersiones este año', logs100: 'Registra 100 inmersiones',
}
export function ProgressCard() {
  const [p, setP] = useState(null)
  useEffect(() => { supabase.rpc('my_progress', {}).then(({ data }) => setP(data || null)) }, [])
  if (!p) return null
  const r = p.rank
  const pct = r.next ? Math.round(((p.total - r.at) / (r.next - r.at)) * 100) : 100
  return (
    <div className="card rank-card">
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="row" style={{ gap: 8 }}><Icon icon={Trophy} size={22} /><span><span className="small muted">{t('Tu rango')}</span><br /><b className="big">{rankName(r.key)}</b></span></span>
        <span className="small muted">{t('{n} inmersiones', { n: p.total })}</span>
      </div>
      {r.next && <><div className="bar" style={{ marginTop: 8 }}><div style={{ width: pct + '%' }} /></div>
        <p className="small muted" style={{ margin: '4px 0 0' }}>{t('{n} más para {rango}', { n: r.next - p.total, rango: rankName(r.nextKey) })}</p></>}
      <details className="fold" style={{ marginTop: 8 }}>
        <summary className="row" style={{ gap: 6 }}><Icon icon={Target} size={16} /> <b>{t('Retos')}</b> <span className="muted small">· {p.challenges.filter((c) => c.done).length}/{p.challenges.length}</span></summary>
        <ul className="challenges">
          {p.challenges.map((c) => (
            <li key={c.key} className={c.done ? 'done' : ''}>
              <Icon icon={c.done ? Award : Target} size={16} /> <span className="grow">{t(CHAL[c.key])}</span> <span className="small muted">{c.progress}/{c.goal}</span>
            </li>
          ))}
        </ul>
      </details>
      {!p.public_profile && <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Activa el perfil público en tu perfil para salir en el ranking y que te puedan seguir.')} <Link to="/perfil?ver=datos">{t('Ir al perfil')}</Link></p>}
    </div>
  )
}

// Ranking de un destino (Destino)
export function Leaderboard({ area }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { supabase.rpc('leaderboard', { p_area: area }).then(({ data }) => setRows(data || [])) }, [area])
  if (!rows || !rows.length) return null
  return (
    <section>
      <h2 className="row" style={{ gap: 6 }}><Icon icon={Trophy} size={20} /> {t('Quién más bucea en {destino}', { destino: area })}</h2>
      <ol className="leader card">
        {rows.map((r) => <li key={r.id} className={r.me ? 'me' : ''}><Link to={'/buzo/' + r.id}>{r.name}</Link>{r.country ? <span className="muted small"> · {r.country}</span> : null}<span className="grow" /><b>{r.dives}</b></li>)}
      </ol>
      <p className="small muted">{t('Inmersiones registradas en la bitácora en los últimos 12 meses, de buceadores con perfil público.')}</p>
    </section>
  )
}

// Fecha corta de una entrada del muro
export const when = (iso) => dayLabel(manilaDate(new Date(iso)), { day: 'numeric', month: 'short' }) + ' · ' + time(iso)
