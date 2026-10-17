import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { t } from '../lib/i18n'
import { dateTime } from '../lib/format'
import { VSTATUS } from './CentroVerificacion'

const TABS = ['pending', 'unverified', 'rejected', 'suspended', 'verified']
const FIELDS = [
  ['legal_name', 'Razón social'], ['business_reg_type', 'Tipo de registro'], ['business_reg_number', 'Nº DTI/SEC'],
  ['mayors_permit_number', "Nº de Mayor's permit"], ['address', 'Dirección'], ['owner_name', 'Responsable'], ['owner_role', 'Cargo'],
  ['contact_email', 'Email'], ['contact_phone', 'Teléfono'], ['agency', 'Agencia'], ['agency_number', 'Nº de agencia'],
  ['social_url', 'Web / red social'], ['years_operating', 'Años operando'], ['notes', 'Notas'],
]

// Panel de la plataforma: validar centros antes de que publiquen
export default function Admin() {
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState('pending')
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('centers')
      .select('id, name, destination, province, phone, website, listing_status, verification_status, review_note, claims_center_id, verified_at, created_at')
      .eq('verification_status', tab).neq('listing_status', 'directorio').order('created_at', { ascending: false }).limit(200)
    if (error) setMsg({ ok: false, text: errMsg(error) })
    setList(data || [])
  }
  useEffect(() => { if (isAdmin) { setList(null); load() } }, [tab, isAdmin])

  if (!isAdmin) return <div className="card muted">{t('Solo para administradores de DiveSlot.')}</div>

  return (
    <>
      <h1>{t('Validación de centros')}</h1>
      <div className="chips">
        {TABS.map((s) => <button key={s} className={tab === s ? 'on' : ''} onClick={() => { setTab(s); setOpen(null) }}>{t(VSTATUS[s][1])}</button>)}
      </div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
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

function Review({ c, onDone }) {
  const [v, setV] = useState(undefined)
  const [docs, setDocs] = useState([])
  const [claimed, setClaimed] = useState(null)
  const [note, setNote] = useState(c.review_note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
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
          <div key={d.id} className="doc-row"><span>{d.kind} · <span className="muted">{d.file_name}</span></span><button type="button" className="btn small ghost" onClick={() => openDoc(d)}>{t('Ver')}</button></div>
        ))}
      </div>
      <div className="field"><label>{t('Nota para el centro (obligatoria si rechazas o suspendes)')}</label><textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {error && <div className="msg err">{error}</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        {c.verification_status !== 'verified' && <button className="btn small" disabled={busy} onClick={() => decide('verified')}>✅ {t('Aprobar')}</button>}
        {c.verification_status !== 'rejected' && c.verification_status !== 'verified' && <button className="btn small ghost" disabled={busy} onClick={() => decide('rejected')}>{t('Rechazar')}</button>}
        {c.verification_status === 'verified' && <button className="btn small ghost" disabled={busy} onClick={() => decide('suspended')}>{t('Suspender')}</button>}
        {c.verification_status === 'suspended' && <button className="btn small ghost" disabled={busy} onClick={() => decide('pending')}>{t('Volver a revisión')}</button>}
      </div>
    </div>
  )
}
