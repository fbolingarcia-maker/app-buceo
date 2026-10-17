import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { t } from '../lib/i18n'
import { AGENCIES } from '../lib/agencies'

export const VSTATUS = {
  unverified: ['pill warn', 'Sin verificar'],
  pending: ['pill warn', 'En revisión'],
  verified: ['pill ok', 'Verificado'],
  rejected: ['pill bad', 'Rechazado'],
  suspended: ['pill bad', 'Suspendido'],
}

const DOC_KINDS = [
  ['owner_id', 'Documento de identidad del responsable', true],
  ['business_permit', "Permiso de negocio (Mayor's permit)", false],
  ['dti_sec', 'Registro DTI / SEC', false],
  ['agency_cert', 'Certificado de la agencia (PADI, SSI…)', false],
  ['shop_photo', 'Foto de la fachada o del centro', false],
  ['other', 'Otro documento', false],
]

const EMPTY = {
  legal_name: '', business_reg_type: 'DTI', business_reg_number: '', mayors_permit_number: '', owner_name: '', owner_role: '',
  contact_email: '', contact_phone: '', address: '', agency: '', agency_number: '', social_url: '', years_operating: '', notes: '',
}

// Verificación del centro: datos legales y documentos para que la plataforma lo valide
export default function CentroVerificacion() {
  const { center, user, refresh } = useAuth()
  const [f, setF] = useState(null)
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(false)
  const [up, setUp] = useState('')
  const [msg, setMsg] = useState(null)
  const st = center.verification_status || 'unverified'
  const locked = st === 'verified' || st === 'suspended'

  async function loadDocs() {
    const { data } = await supabase.from('center_documents').select('*').eq('center_id', center.id).order('created_at')
    setDocs(data || [])
  }
  useEffect(() => {
    supabase.from('center_verifications').select('*').eq('center_id', center.id).maybeSingle().then(({ data }) => {
      const base = { ...EMPTY, contact_email: user?.email || '', contact_phone: center.phone || '', legal_name: center.name || '' }
      const clean = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v != null))
      setF({ ...base, ...clean, years_operating: data?.years_operating ?? '' })
    })
    loadDocs()
  }, [center.id])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function saveData() {
    const row = { ...f, center_id: center.id, years_operating: f.years_operating === '' ? null : +f.years_operating, updated_at: new Date().toISOString() }
    for (const k of ['submitted_at', 'reviewed_at', 'reviewed_by']) delete row[k]
    const { error } = await supabase.from('center_verifications').upsert(row)
    return error
  }

  async function upload(kind, file) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return setMsg({ ok: false, text: t('El archivo supera 10 MB') })
    setUp(kind); setMsg(null)
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${center.id}/${kind}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('center-docs').upload(path, file, { contentType: file.type || undefined })
    if (!error) {
      const { error: e2 } = await supabase.from('center_documents').insert({ center_id: center.id, kind, path, file_name: file.name })
      if (e2) setMsg({ ok: false, text: errMsg(e2) })
    } else setMsg({ ok: false, text: errMsg(error) })
    setUp('')
    loadDocs()
  }

  async function removeDoc(d) {
    await supabase.storage.from('center-docs').remove([d.path])
    await supabase.from('center_documents').delete().eq('id', d.id)
    loadDocs()
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const err = await saveData()
    if (err) { setBusy(false); return setMsg({ ok: false, text: errMsg(err) }) }
    const { error } = await supabase.rpc('submit_center_verification')
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    setMsg({ ok: true, text: t('Solicitud enviada. Te avisaremos cuando la revisemos (normalmente 1–2 días laborables).') })
    refresh()
  }

  async function saveDraft() {
    setBusy(true); setMsg(null)
    const err = await saveData()
    setBusy(false)
    setMsg(err ? { ok: false, text: errMsg(err) } : { ok: true, text: t('Borrador guardado') })
  }

  const has = (k) => docs.some((d) => d.kind === k)
  const dataOk = f && f.legal_name && f.owner_name && f.contact_phone && f.contact_email && f.address && (f.business_reg_number || f.mayors_permit_number)
  const docsOk = has('owner_id') && (has('business_permit') || has('dti_sec'))
  const step = (done, now, text) => <li className={done ? 'done' : now ? 'now' : ''}><span className="dot">{done ? '✓' : '•'}</span>{text}</li>

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Link to="/centro" className="small">← {t('Panel')}</Link>
      <div className="row between" style={{ marginTop: 8 }}>
        <h1 style={{ margin: 0 }}>{t('Verificación del centro')}</h1>
        <span className={VSTATUS[st][0]}>{t(VSTATUS[st][1])}</span>
      </div>

      <div className="card stack">
        <p className="small" style={{ margin: 0 }}>
          {t('Para proteger a los buceadores, revisamos cada centro antes de que pueda publicar salidas y aparecer en la app. Solo el equipo de DiveSlot ve estos datos y documentos.')}
        </p>
        <ul className="steps">
          {step(true, false, t('Cuenta y centro creados'))}
          {step(dataOk, !dataOk, t('Datos del negocio y del responsable'))}
          {step(docsOk, dataOk && !docsOk, t('Documentos: identidad + permiso de negocio o DTI/SEC'))}
          {step(st === 'pending' || st === 'verified', dataOk && docsOk && st !== 'pending' && st !== 'verified', t('Enviar a revisión'))}
          {step(st === 'verified', st === 'pending', t('Validación por DiveSlot → ya puedes publicar salidas'))}
        </ul>
      </div>

      {st === 'pending' && <div className="msg ok">{t('Tu solicitud está en revisión. Mientras tanto puedes preparar tus barcos y salidas como borrador.')}</div>}
      {st === 'verified' && <div className="msg ok">{t('Tu centro está verificado: tus salidas publicadas son visibles y reservables.')}</div>}
      {(st === 'rejected' || st === 'suspended') && (
        <div className="msg err">
          <b>{st === 'rejected' ? t('Solicitud rechazada') : t('Centro suspendido')}</b>
          {center.review_note && <div>{t('Motivo:')} {center.review_note}</div>}
          {st === 'rejected' && <div>{t('Corrige los datos o documentos y vuelve a enviarla.')}</div>}
        </div>
      )}
      {center.claims_center_id && st !== 'verified' && (
        <div className="small muted" style={{ marginBottom: 10 }}>{t('Estás reclamando una ficha del directorio. Al verificarte, pasarás a gestionarla y la ficha antigua se retirará.')}</div>
      )}

      {f === null ? <p className="muted">{t('Cargando…')}</p> : (
        <form onSubmit={submit}>
          <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('Negocio')}</h2>
              <div className="field"><label>{t('Razón social / nombre registrado')} *</label><input required value={f.legal_name} onChange={set('legal_name')} /></div>
              <div className="grid2">
                <div className="field"><label>{t('Tipo de registro')}</label>
                  <select value={f.business_reg_type} onChange={set('business_reg_type')}>
                    <option value="DTI">{t('DTI (empresa individual)')}</option>
                    <option value="SEC">{t('SEC (sociedad)')}</option>
                    <option value="CDA">{t('CDA (cooperativa)')}</option>
                    <option value="foreign">{t('Registro extranjero')}</option>
                  </select>
                </div>
                <div className="field"><label>{t('Nº de registro DTI/SEC')}</label><input value={f.business_reg_number} onChange={set('business_reg_number')} /></div>
                <div className="field"><label>{t("Nº de Mayor's permit")}</label><input value={f.mayors_permit_number} onChange={set('mayors_permit_number')} /></div>
                <div className="field"><label>{t('Años operando')}</label><input type="number" min="0" max="80" value={f.years_operating} onChange={set('years_operating')} /></div>
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>{t("Rellena al menos uno de los dos números (DTI/SEC o Mayor's permit).")}</p>
              <div className="field"><label>{t('Dirección del centro')} *</label><input required value={f.address} onChange={set('address')} placeholder={t('Calle, barangay, municipio')} /></div>
              <div className="grid2">
                <div className="field"><label>{t('Agencia principal')}</label>
                  <select value={f.agency} onChange={set('agency')}>
                    <option value="">—</option>
                    {AGENCIES.map((a) => <option key={a}>{a}</option>)}
                  </select>
                </div>
                <div className="field"><label>{t('Nº de centro en la agencia')}</label><input value={f.agency_number} onChange={set('agency_number')} placeholder={t('p. ej. PADI S-12345')} /></div>
              </div>
              <div className="field"><label>{t('Web o red social del centro')}</label><input type="url" placeholder="https://" value={f.social_url} onChange={set('social_url')} /></div>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('Responsable')}</h2>
              <div className="grid2">
                <div className="field"><label>{t('Nombre completo')} *</label><input required value={f.owner_name} onChange={set('owner_name')} /></div>
                <div className="field"><label>{t('Cargo')}</label><input value={f.owner_role} onChange={set('owner_role')} placeholder={t('Propietario, gerente…')} /></div>
                <div className="field"><label>{t('Email de contacto')} *</label><input type="email" required value={f.contact_email} onChange={set('contact_email')} /></div>
                <div className="field"><label>{t('Teléfono / WhatsApp')} *</label><input required value={f.contact_phone} onChange={set('contact_phone')} /></div>
              </div>
              <div className="field"><label>{t('Notas para el equipo de revisión (opcional)')}</label><textarea rows="2" value={f.notes} onChange={set('notes')} /></div>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>{t('Documentos')}</h2>
              <p className="small muted" style={{ marginTop: 0 }}>{t('PDF o foto, máx. 10 MB. Obligatorios: identidad del responsable y permiso de negocio o registro DTI/SEC.')}</p>
              {DOC_KINDS.map(([kind, label, req]) => {
                const mine = docs.filter((d) => d.kind === kind)
                const needed = req || ((kind === 'business_permit' || kind === 'dti_sec') && !has('business_permit') && !has('dti_sec'))
                return (
                  <div key={kind} className="doc-row">
                    <div>
                      <div>{mine.length ? '✅ ' : needed ? '⚠️ ' : ''}{t(label)}{req ? ' *' : ''}</div>
                      {mine.map((d) => (
                        <div key={d.id} className="small muted">{d.file_name} {!locked && <button type="button" className="linkish" onClick={() => removeDoc(d)}>{t('Quitar')}</button>}</div>
                      ))}
                    </div>
                    {!locked && (
                      <label className="btn small ghost" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {up === kind ? t('Subiendo…') : mine.length ? t('Añadir otro') : t('Subir')}
                        <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { upload(kind, e.target.files[0]); e.target.value = '' }} />
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          </fieldset>

          {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
          {!locked && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ghost" disabled={busy} onClick={saveDraft}>{t('Guardar borrador')}</button>
              <button className="btn grow" disabled={busy || !docsOk}>{busy ? t('Enviando…') : st === 'pending' ? t('Actualizar solicitud') : t('Enviar a revisión')}</button>
            </div>
          )}
          {!locked && !docsOk && <p className="small muted">{t('Sube los documentos obligatorios para poder enviar.')}</p>}
        </form>
      )}
    </div>
  )
}
