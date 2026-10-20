import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { t } from '../lib/i18n'
import { dateTime, levelName } from '../lib/format'
import { VSTATUS } from './CentroVerificacion'
import AdminResumen from './AdminResumen'

const DOC_LABEL = {
  owner_id: 'Documento de identidad del responsable', business_permit: "Permiso de negocio (Mayor's permit)", dti_sec: 'Registro DTI / SEC',
  agency_cert: 'Certificado de la agencia (PADI, SSI…)', shop_photo: 'Foto de la fachada o del centro', other: 'Otro documento',
}
const TABS = ['pending', 'unverified', 'rejected', 'suspended', 'verified']
const FIELDS = [
  ['legal_name', 'Razón social'], ['business_reg_type', 'Tipo de registro'], ['business_reg_number', 'Nº DTI/SEC'],
  ['mayors_permit_number', "Nº de Mayor's permit"], ['address', 'Dirección'], ['owner_name', 'Responsable'], ['owner_role', 'Cargo'],
  ['contact_email', 'Email'], ['contact_phone', 'Teléfono'], ['agency', 'Agencia'], ['agency_number', 'Nº de agencia'],
  ['social_url', 'Web / red social'], ['years_operating', 'Años operando'], ['notes', 'Notas'],
]

// Panel de la plataforma (solo administradores): centros, usuarios, administradores y registro de cambios
const SECTIONS = [['summary', '📊', 'Resumen'], ['centers', '🛡️', 'Centros'], ['users', '👥', 'Usuarios'], ['admins', '👤', 'Administradores'], ['log', '📝', 'Registro']]

export default function Admin() {
  const { isAdmin } = useAuth()
  const [section, setSection] = useState('summary')
  if (!isAdmin) return null
  return (
    <>
      <h1 style={{ marginBottom: 8 }}>{t('Administración')}</h1>
      <nav className="row wrap" style={{ gap: 6, marginBottom: 12 }} aria-label={t('Administración')}>
        {SECTIONS.map(([k, icon, label]) => (
          <button key={k} type="button" className={section === k ? 'btn small' : 'btn small ghost'} aria-current={section === k ? 'page' : undefined} onClick={() => setSection(k)}>
            <span aria-hidden>{icon}</span> {t(label)}
          </button>
        ))}
      </nav>
      {section === 'summary' && <AdminResumen go={setSection} />}
      {section === 'centers' && <Centers />}
      {section === 'users' && <Users />}
      {section === 'admins' && <Admins />}
      {section === 'log' && <AuditLog />}
    </>
  )
}

function Centers() {
  const [tab, setTab] = useState('pending')
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('centers')
      .select('id, name, destination, province, phone, website, listing_status, verification_status, claims_center_id, verified_at, created_at')
      .eq('verification_status', tab).neq('listing_status', 'directorio').order('created_at', { ascending: false }).limit(200)
    if (error) setMsg({ ok: false, text: errMsg(error) })
    setList(data || [])
  }
  useEffect(() => { setList(null); load() }, [tab])

  return (
    <>
      <h2 style={{ marginTop: 0 }}>{t('Validación de centros')}</h2>
      <div className="chips">
        {TABS.map((s) => <button key={s} className={tab === s ? 'on' : ''} onClick={() => { setTab(s); setOpen(null) }}>{t(VSTATUS[s][1])}</button>)}
      </div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {list === null && <p className="muted">{t('Cargando…')}</p>}
      {list?.length === 0 && <div className="card muted center">{t('No hay centros en este estado.')}</div>}
      {list?.map((c) => (
        <div key={c.id} className="card">
          <button type="button" className="row between linkish" style={{ width: '100%', textAlign: 'left', color: 'inherit' }} onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span><b>{c.name}</b> <span className="small muted">· {[c.destination, c.province].filter(Boolean).join(', ')}</span>
              {c.claims_center_id && <span className="pill warn" style={{ marginLeft: 6 }}>{t('Reclama ficha')}</span>}</span>
            <span className="small muted">{open === c.id ? '▲' : '▼'}</span>
          </button>
          {open === c.id && <Review c={c} onDone={(text) => { setMsg({ ok: true, text }); setOpen(null); load() }} />}
        </div>
      ))}
    </>
  )
}

// Datos de perfil de todos los usuarios (nunca contraseñas ni datos de pago: Auth guarda solo el hash y los pagos los gestiona PayMongo)
function Users() {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.rpc('admin_users').then(({ data, error }) => { if (error) setErr(errMsg(error)); setList(data || []) })
  }, [])

  const term = q.trim().toLowerCase()
  const shown = (list || []).filter((u) => (kind === 'all' || u.account_type === kind)
    && (!term || [u.full_name, u.email, u.country].some((v) => (v || '').toLowerCase().includes(term))))
  const levelOf = (u) => u.certifications?.length ? u.certifications.map((c) => c.agency + ' ' + levelName(c.level) + (c.verified ? ' ✅' : '')).join(' · ') : '—'

  return (
    <>
      <h2 style={{ marginTop: 0 }}>{t('Usuarios')} {list && <span className="muted small">({shown.length}/{list.length})</span>}</h2>
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <input className="grow" type="search" placeholder={t('Buscar por nombre, email o país')} aria-label={t('Buscar por nombre, email o país')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('Tipo de cuenta')}>
          <option value="all">{t('Todas las cuentas')}</option>
          <option value="diver">{t('Buceadores')}</option>
          <option value="center">{t('Centros')}</option>
        </select>
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      {list === null && <p className="muted">{t('Cargando…')}</p>}
      {list && shown.length === 0 && <div className="card muted center">{t('Ningún usuario coincide.')}</div>}
      {shown.map((u) => (
        <div key={u.diver_id} className="card">
          <button type="button" className="row between linkish" style={{ width: '100%', textAlign: 'left', color: 'inherit' }} aria-expanded={open === u.diver_id} onClick={() => setOpen(open === u.diver_id ? null : u.diver_id)}>
            <span style={{ minWidth: 0 }}>
              <b>{u.full_name}</b> {u.is_admin && <span className="pill">{t('Admin')}</span>} <span className="pill">{u.account_type === 'center' ? t('Centro') : t('Buceador')}</span>
              <div className="small muted" style={{ wordBreak: 'break-all' }}>{u.email}</div>
            </span>
            <span className="small muted">{open === u.diver_id ? '▲' : '▼'}</span>
          </button>
          {open === u.diver_id && (
            <table className="small" style={{ width: '100%', marginTop: 8 }}>
              <tbody>
                {[
                  [t('Alta'), u.signed_up_at ? dateTime(u.signed_up_at) : '—'],
                  [t('Último acceso'), u.last_sign_in_at ? dateTime(u.last_sign_in_at) : '—'],
                  [t('Email confirmado'), u.email_confirmed ? t('Sí') : t('No')],
                  [t('Acceso con'), u.auth_provider || 'email'],
                  [t('País'), u.country || '—'],
                  [t('Idiomas'), (u.languages || []).join(', ') || '—'],
                  [t('Inmersiones registradas'), u.logged_dives ?? '—'],
                  [t('Certificaciones'), levelOf(u)],
                  [t('Reservas'), t('{n} en total · {m} próximas', { n: u.bookings_total, m: u.bookings_upcoming })],
                  [t('Centros'), u.centers?.length ? u.centers.map((c) => c.name + ' (' + t(VSTATUS[c.status]?.[1] || c.status) + ')').join(' · ') : '—'],
                  [t('Visible en «¿Quién va?»'), u.show_on_trips ? t('Sí') : t('No')],
                  [t('Sobre ti'), u.bio || '—'],
                ].map(([k, v]) => <tr key={k}><td className="muted" style={{ paddingRight: 8, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{k}</td><td style={{ wordBreak: 'break-word' }}>{String(v)}</td></tr>)}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  )
}

// Registro de cambios hechos por administradores (validaciones y altas/bajas de administradores)
function AuditLog() {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('admin_audit').select('*').order('at', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setErr(errMsg(error)); setList(data || []) })
  }, [])
  const text = (a) => a.action === 'center_status'
    ? t('{name}: {from} → {to}', { name: a.detail?.name || '', from: t(VSTATUS[a.detail?.from]?.[1] || a.detail?.from || ''), to: t(VSTATUS[a.detail?.to]?.[1] || a.detail?.to || '') })
    : a.action === 'admin_grant' ? t('Acceso de administrador para {email}', { email: a.detail?.email || '' })
      : t('Acceso de administrador retirado a {email}', { email: a.detail?.email || '' })
  return (
    <>
      <h2 style={{ marginTop: 0 }}>{t('Registro')}</h2>
      {err && <div className="msg err" role="alert">{err}</div>}
      {list === null && <p className="muted">{t('Cargando…')}</p>}
      {list?.length === 0 && <div className="card muted center">{t('Todavía no hay cambios registrados.')}</div>}
      {list?.length > 0 && (
        <div className="card">
          {list.map((a) => (
            <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div>{text(a)}</div>
              <div className="small muted">{dateTime(a.at)}{a.detail?.note ? ' · ' + a.detail.note : ''}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// Cuentas con acceso de administración. Nadie más puede ver esta lista ni saber que existe.
function Admins() {
  const [list, setList] = useState(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data, error } = await supabase.rpc('admin_list')
    if (error) setMsg({ ok: false, text: errMsg(error) })
    setList(data || [])
  }
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('admin_grant', { p_email: email.trim() })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    setEmail(''); setMsg({ ok: true, text: t('Acceso de administrador concedido') }); load()
  }
  async function remove(a) {
    if (!window.confirm(t('¿Quitar el acceso de administrador a {email}?', { email: a.email }))) return
    const { error } = await supabase.rpc('admin_revoke', { p_user: a.user_id })
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    setMsg({ ok: true, text: t('Acceso retirado') }); load()
  }

  return (
    <div className="card">
      <p className="small muted" style={{ marginTop: 0 }}>{t('Solo los administradores ven esta pantalla. Para añadir uno, primero crea la cuenta en la app (Entrar → Crear cuenta) con su email y contraseña y después escribe aquí ese email.')}</p>
      {list === null && <p className="muted">{t('Cargando…')}</p>}
      {list?.map((a) => (
        <div key={a.user_id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <span>{a.email} {a.is_me && <span className="pill">{t('Tú')}</span>}</span>
          {list.length > 1 && <button type="button" className="btn small ghost" onClick={() => remove(a)}>{t('Quitar')}</button>}
        </div>
      ))}
      <form onSubmit={add} style={{ marginTop: 12 }}>
        <div className="field"><label htmlFor="admin-email">{t('Email de la cuenta')}</label><input id="admin-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
        <button className="btn" disabled={busy}>{t('Dar acceso de administrador')}</button>
      </form>
    </div>
  )
}

function Review({ c, onDone }) {
  const [v, setV] = useState(undefined)
  const [docs, setDocs] = useState([])
  const [claimed, setClaimed] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('center_private', { p_center: c.id }).then(({ data }) => setNote(data?.[0]?.review_note || ''))
    supabase.from('center_verifications').select('*').eq('center_id', c.id).maybeSingle().then(({ data }) => setV(data || null))
    supabase.from('center_documents').select('*').eq('center_id', c.id).order('created_at').then(({ data }) => setDocs(data || []))
    if (c.claims_center_id) supabase.from('centers').select('id, name, phone, website, destination').eq('id', c.claims_center_id).maybeSingle().then(({ data }) => setClaimed(data))
  }, [c.id])

  async function openDoc(d) {
    const { data, error } = await supabase.storage.from('center-docs').createSignedUrl(d.path, 300)
    if (error) return setError(errMsg(error))
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function decide(decision) {
    if ((decision === 'rejected' || decision === 'suspended') && !note.trim()) return setError(t('Escribe el motivo para el centro'))
    if (decision === 'suspended' && !window.confirm(t('¿Suspender {name}? Sus salidas dejarán de ser visibles.', { name: c.name }))) return
    if (decision === 'verified' && !window.confirm(t('¿Aprobar {name}? Podrá publicar salidas y recibir reservas.', { name: c.name }))) return
    setBusy(true); setError('')
    const { error } = await supabase.rpc('review_center', { p_center: c.id, p_decision: decision, p_note: note.trim() || null })
    setBusy(false)
    if (error) return setError(errMsg(error))
    onDone(t('Centro actualizado: {estado}', { estado: t(VSTATUS[decision][1]) }))
  }

  return (
    <div className="stack" style={{ marginTop: 10 }}>
      <div className="small muted">{t('Alta: {fecha}', { fecha: dateTime(c.created_at) })}{v?.submitted_at ? ' · ' + t('Enviada: {fecha}', { fecha: dateTime(v.submitted_at) }) : ''}</div>
      {claimed && (
        <div className="msg err small">
          {t('Reclama la ficha del directorio «{nombre}». Comprueba que el contacto coincide con la ficha:', { nombre: claimed.name })} {claimed.phone || '—'} · {claimed.website || '—'}
        </div>
      )}
      {v === undefined ? <p className="muted">{t('Cargando…')}</p> : v === null ? <p className="muted">{t('Aún no ha rellenado el formulario.')}</p> : (
        <table className="small" style={{ width: '100%' }}>
          <tbody>
            {FIELDS.filter(([k]) => v[k] != null && v[k] !== '').map(([k, label]) => (
              <tr key={k}><td className="muted" style={{ paddingRight: 8, verticalAlign: 'top' }}>{t(label)}</td><td style={{ wordBreak: 'break-word' }}>{k === 'social_url' ? <a href={v[k]} target="_blank" rel="noreferrer">{v[k]}</a> : String(v[k])}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        <b className="small">{t('Documentos')}</b>
        {docs.length === 0 && <div className="small muted">{t('Sin documentos')}</div>}
        {docs.map((d) => (
          <div key={d.id} className="doc-row"><span>{t(DOC_LABEL[d.kind] || d.kind)} · <span className="muted">{d.file_name}</span></span><button type="button" className="btn small ghost" onClick={() => openDoc(d)}>{t('Ver')}</button></div>
        ))}
      </div>
      <div className="field"><label htmlFor="admin-1">{t('Nota para el centro (obligatoria si rechazas o suspendes)')}</label><textarea id="admin-1" rows="2" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        {c.verification_status !== 'verified' && <button className="btn small" disabled={busy} onClick={() => decide('verified')}>✅ {t('Aprobar')}</button>}
        {c.verification_status !== 'rejected' && c.verification_status !== 'verified' && <button className="btn small ghost" disabled={busy} onClick={() => decide('rejected')}>{t('Rechazar')}</button>}
        {c.verification_status === 'verified' && <button className="btn small ghost" disabled={busy} onClick={() => decide('suspended')}>{t('Suspender')}</button>}
        {c.verification_status === 'suspended' && <button className="btn small ghost" disabled={busy} onClick={() => decide('pending')}>{t('Volver a revisión')}</button>}
      </div>
    </div>
  )
}
