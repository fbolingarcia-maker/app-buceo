import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { manilaDate } from '../lib/format'
import { hashParam } from '../lib/centro'
import { t } from '../lib/i18n'
import Icon from '../lib/Icon'
import { ArrowLeft, Share } from 'lucide-react'
import { drawShareCard } from '../lib/shareCard'

const EMPTY = {
  site_id: '', site_name: '', center_id: null, booking_id: null, dive_date: manilaDate(), entry_time: '',
  max_depth_m: '', avg_depth_m: '', duration_min: '', water_temp_c: '', visibility_m: '',
  gas: 'air', o2_pct: '', tank_start_bar: '', tank_end_bar: '', weights_kg: '', suit: '',
  buddy: '', conditions: '', marine_life: '', rating: 0, notes: '', share_with_center: false,
}
const NUM = ['max_depth_m', 'avg_depth_m', 'duration_min', 'water_temp_c', 'visibility_m', 'o2_pct', 'tank_start_bar', 'tank_end_bar', 'weights_kg']

// Reduce fotos grandes antes de subirlas (máx. 2000 px, JPEG)
async function shrink(file) {
  if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size < 1.5e6) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file
  } catch { return file }
}

export default function Inmersion({ id }) {
  const isNew = id === 'nueva'
  const { user, diver } = useAuth()
  const [f, setF] = useState(null)
  const [sites, setSites] = useState([])
  const [tripSites, setTripSites] = useState([]) // puntos de la salida reservada
  const [centerName, setCenterName] = useState('')
  const [photos, setPhotos] = useState([]) // { id, path, url }
  const [newFiles, setNewFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    supabase.from('dive_sites').select('id, name, area, province').order('area').order('name').then(({ data }) => setSites(data || []))
  }, [])

  useEffect(() => {
    if (!diver) return
    if (!isNew) {
      supabase.from('dive_logs').select('*, centers(name), dive_log_photos(id, path)').eq('id', id).maybeSingle().then(async ({ data, error }) => {
        if (error || !data) return setMsg({ ok: false, text: error ? errMsg(error) : t('Inmersión no encontrada') })
        const v = { ...EMPTY }
        for (const k of Object.keys(EMPTY)) v[k] = data[k] ?? EMPTY[k]
        v.entry_time = data.entry_time ? data.entry_time.slice(0, 5) : ''
        setF(v); setCenterName(data.centers?.name || '')
        loadPhotos(data.dive_log_photos || [])
      })
      return
    }
    const bookingId = hashParam('booking')
    if (!bookingId) return setF({ ...EMPTY })
    supabase.from('bookings').select('id, trips(departs_at, center_id, centers(name), trip_sites(position, site_id, dive_sites(name)))').eq('id', bookingId).maybeSingle()
      .then(({ data }) => {
        const trip = data?.trips
        if (!trip) return setF({ ...EMPTY })
        const ts = (trip.trip_sites || []).sort((a, b) => a.position - b.position)
        setTripSites(ts); setCenterName(trip.centers?.name || '')
        const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }).format(new Date(trip.departs_at))
        setF({ ...EMPTY, booking_id: data.id, center_id: trip.center_id, dive_date: manilaDate(new Date(trip.departs_at)), entry_time: hm,
          site_id: ts[0]?.site_id || '', site_name: ts[0]?.dive_sites?.name || '' })
      })
  }, [id, diver])

  async function loadPhotos(list) {
    if (!list.length) return setPhotos([])
    const { data } = await supabase.storage.from('dive-photos').createSignedUrls(list.map((p) => p.path), 3600)
    setPhotos(list.map((p, i) => ({ ...p, url: data?.[i]?.signedUrl })))
  }

  if (!diver || !f) return <p className="muted">{msg?.text || t('Cargando…')}</p>

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const pickSite = (siteId) => {
    const s = sites.find((x) => x.id === siteId)
    setF({ ...f, site_id: siteId, site_name: s ? s.name : f.site_name })
  }

  async function uploadFiles(logId, files) {
    for (const file of files) {
      const small = await shrink(file)
      const path = `${user.id}/${logId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${small.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage.from('dive-photos').upload(path, small, { contentType: small.type })
      if (error) throw new Error(t('No se pudo subir {name}: {error}', { name: file.name, error: error.message }))
      const { error: e2 } = await supabase.from('dive_log_photos').insert({ log_id: logId, path })
      if (e2) throw e2
    }
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const row = { ...f, diver_id: diver.id, site_id: f.site_id || null, entry_time: f.entry_time || null, rating: f.rating || null, updated_at: new Date().toISOString() }
    for (const k of NUM) row[k] = row[k] === '' || row[k] === null ? null : +row[k]
    if (row.gas === 'air') row.o2_pct = null
    if (!row.center_id) row.share_with_center = false
    const { data, error } = isNew
      ? await supabase.from('dive_logs').insert(row).select('id').single()
      : await supabase.from('dive_logs').update(row).eq('id', id).select('id').single()
    if (error) { setBusy(false); return setMsg({ ok: false, text: errMsg(error) }) }
    try { if (newFiles.length) await uploadFiles(data.id, newFiles) } catch (err) { setBusy(false); return setMsg({ ok: false, text: errMsg(err) }) }
    setNewFiles([])
    setBusy(false)
    if (isNew) return go('/bitacora/' + data.id)
    setMsg({ ok: true, text: t('Inmersión guardada') })
    const { data: ph } = await supabase.from('dive_log_photos').select('id, path').eq('log_id', id).order('created_at')
    loadPhotos(ph || [])
  }

  async function removePhoto(p) {
    if (!window.confirm(t('¿Borrar esta foto?'))) return
    await supabase.storage.from('dive-photos').remove([p.path])
    await supabase.from('dive_log_photos').delete().eq('id', p.id)
    setPhotos(photos.filter((x) => x.id !== p.id))
  }

  async function removeLog() {
    if (!window.confirm(t('¿Borrar esta inmersión y sus fotos?'))) return
    if (photos.length) await supabase.storage.from('dive-photos').remove(photos.map((p) => p.path))
    const { error } = await supabase.from('dive_logs').delete().eq('id', id)
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    go('/bitacora')
  }

  const used = f.tank_start_bar && f.tank_end_bar ? f.tank_start_bar - f.tank_end_bar : null

  // Imagen para stories con los datos reales de la inmersión (se genera en el móvil y no se sube a ningún sitio)
  async function share() {
    setSharing(true); setMsg(null)
    try {
      const max = +f.max_depth_m || 0
      let isRecord = false
      if (max) {
        const { data } = await supabase.from('dive_logs').select('max_depth_m').eq('diver_id', diver.id).neq('id', id)
          .not('max_depth_m', 'is', null).order('max_depth_m', { ascending: false }).limit(1)
        isRecord = max > (+data?.[0]?.max_depth_m || 0)
      }
      const blob = await drawShareCard(f, { photoUrl: photos[0]?.url, centerName, isRecord })
      const name = 'diveslot-' + ((f.site_name || 'inmersion').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').toLowerCase()) + '.png'
      const file = new File([blob], name, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] })
      else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob); a.download = name; a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }
    } catch (e) {
      if (e?.name !== 'AbortError') setMsg({ ok: false, text: t('No se ha podido crear la imagen. Inténtalo de nuevo.') })
    }
    setSharing(false)
  }

  return (
    <>
      <Link to="/bitacora" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Bitácora')}</Link>
      <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <h1 style={{ marginTop: 8 }}>{isNew ? t('Nueva inmersión') : f.site_name || t('Inmersión')}</h1>
        {!isNew && <button type="button" className="btn ghost small" style={{ marginTop: 8 }} disabled={sharing} onClick={share}><Icon icon={Share} /> {t('Compartir')}</button>}
      </div>
      {centerName && <p className="muted small" style={{ marginTop: -6 }}>{t('Con {name}', { name: centerName })}</p>}
      <form onSubmit={save}>
        <div className="card">
          <b>{t('Lugar y fecha')}</b>
          {tripSites.length > 0 && (
            <div className="seg" style={{ marginTop: 8 }}>
              {tripSites.map((ts) => (
                <button type="button" key={ts.position} className={f.site_id === ts.site_id ? 'on' : ''}
                  onClick={() => setF({ ...f, site_id: ts.site_id, site_name: ts.dive_sites?.name })}>{t('Inm. {n}: {name}', { n: ts.position, name: ts.dive_sites?.name })}</button>
              ))}
            </div>
          )}
          <div className="grid2" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor="inmersion-1">{t('Punto de buceo')}</label><select id="inmersion-1" value={f.site_id || ''} onChange={(e) => pickSite(e.target.value)}>
                <option value="">{t('Otro (escríbelo)')}</option>
                {Object.entries(sites.reduce((m, s) => { const k = (s.province ? s.province + ' · ' : '') + s.area; (m[k] = m[k] || []).push(s); return m }, {}))
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, list]) => (
                    <optgroup key={k} label={k}>
                      {list.map((s) => <option key={s.id} value={s.id}>{s.name.replace(s.area + ' – ', '')}</option>)}
                    </optgroup>
                  ))}
              </select>
            </div>
            <div className="field"><label htmlFor="inmersion-2">{t('Nombre')}</label><input id="inmersion-2" value={f.site_name || ''} onChange={set('site_name')} placeholder={t('p. ej. Napaling')} required /></div>
            <div className="field"><label htmlFor="inmersion-3">{t('Fecha')}</label><input id="inmersion-3" type="date" required value={f.dive_date} onChange={set('dive_date')} /></div>
            <div className="field"><label htmlFor="inmersion-4">{t('Hora de entrada')}</label><input id="inmersion-4" type="time" value={f.entry_time || ''} onChange={set('entry_time')} /></div>
          </div>
        </div>

        <div className="card">
          <b>{t('Datos de la inmersión')}</b>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor="inmersion-5">{t('Prof. máxima (m)')}</label><input id="inmersion-5" type="number" inputMode="decimal" step="0.1" min="0" value={f.max_depth_m ?? ''} onChange={set('max_depth_m')} /></div>
            <div className="field"><label htmlFor="inmersion-6">{t('Prof. media (m)')}</label><input id="inmersion-6" type="number" inputMode="decimal" step="0.1" min="0" value={f.avg_depth_m ?? ''} onChange={set('avg_depth_m')} /></div>
            <div className="field"><label htmlFor="inmersion-7">{t('Duración (min)')}</label><input id="inmersion-7" type="number" inputMode="numeric" min="0" value={f.duration_min ?? ''} onChange={set('duration_min')} /></div>
            <div className="field"><label htmlFor="inmersion-8">{t('Temperatura agua (°C)')}</label><input id="inmersion-8" type="number" inputMode="decimal" step="0.1" value={f.water_temp_c ?? ''} onChange={set('water_temp_c')} /></div>
            <div className="field"><label htmlFor="inmersion-9">{t('Visibilidad (m)')}</label><input id="inmersion-9" type="number" inputMode="numeric" min="0" value={f.visibility_m ?? ''} onChange={set('visibility_m')} /></div>
            <div className="field"><label htmlFor="inmersion-10">{t('Condiciones')}</label><input id="inmersion-10" value={f.conditions || ''} onChange={set('conditions')} placeholder={t('corriente suave, mar en calma…')} /></div>
          </div>
        </div>

        <div className="card">
          <b>{t('Equipo y gas')}</b>
          <div className="grid2" style={{ marginTop: 8 }}>
            <div className="field"><label htmlFor="inmersion-11">{t('Gas')}</label><select id="inmersion-11" value={f.gas} onChange={set('gas')}><option value="air">{t('Aire')}</option><option value="nitrox">Nitrox</option><option value="trimix">Trimix</option></select>
            </div>
            {f.gas !== 'air' && <div className="field"><label htmlFor="inmersion-12">% O₂</label><input id="inmersion-12" type="number" inputMode="numeric" min="21" max="100" value={f.o2_pct ?? ''} onChange={set('o2_pct')} /></div>}
            <div className="field"><label htmlFor="inmersion-13">{t('Botella inicio (bar)')}</label><input id="inmersion-13" type="number" inputMode="numeric" min="0" max="350" value={f.tank_start_bar ?? ''} onChange={set('tank_start_bar')} /></div>
            <div className="field"><label htmlFor="inmersion-14">{t('Botella final (bar)')}</label><input id="inmersion-14" type="number" inputMode="numeric" min="0" max="350" value={f.tank_end_bar ?? ''} onChange={set('tank_end_bar')} /></div>
            <div className="field"><label htmlFor="inmersion-15">{t('Lastre (kg)')}</label><input id="inmersion-15" type="number" inputMode="decimal" step="0.5" min="0" value={f.weights_kg ?? ''} onChange={set('weights_kg')} /></div>
            <div className="field"><label htmlFor="inmersion-16">{t('Traje')}</label><input id="inmersion-16" value={f.suit || ''} onChange={set('suit')} placeholder={t('3 mm, shorty…')} /></div>
          </div>
          {used > 0 && <p className="small muted" style={{ margin: 0 }}>{t('Consumo: {n} bar', { n: used })}</p>}
        </div>

        <div className="card">
          <b>{t('Tu experiencia')}</b>
          <div className="field" style={{ marginTop: 8 }}><label>{t('Valoración')}</label>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button type="button" key={n} onClick={() => setF({ ...f, rating: f.rating === n ? 0 : n })} aria-label={n === 1 ? t('1 estrella') : t('{n} estrellas', { n })}>{n <= f.rating ? '★' : '☆'}</button>
              ))}
            </div>
          </div>
          <div className="field"><label htmlFor="inmersion-17">{t('Compañero (buddy) / guía')}</label><input id="inmersion-17" value={f.buddy || ''} onChange={set('buddy')} /></div>
          <div className="field"><label htmlFor="inmersion-18">{t('Vida marina vista')}</label><input id="inmersion-18" value={f.marine_life || ''} onChange={set('marine_life')} placeholder={t('tortugas, sardinas, nudibranquios…')} /></div>
          <div className="field"><label htmlFor="inmersion-19">{t('Comentarios')}</label><textarea id="inmersion-19" rows="4" value={f.notes || ''} onChange={set('notes')} /></div>
          {f.center_id && (
            <label className="check"><input type="checkbox" checked={f.share_with_center} onChange={set('share_with_center')} /> {t('Compartir esta inmersión y mi valoración con {name}', { name: centerName || t('el centro') })}</label>
          )}
        </div>

        <div className="card">
          <b>{t('Fotos')}</b>
          {photos.length > 0 && (
            <div className="photos" style={{ marginTop: 8 }}>
              {photos.map((p) => (
                <div key={p.id}>
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="" /></a>}
                  <button type="button" onClick={() => removePhoto(p)} aria-label={t('Borrar foto')}>×</button>
                </div>
              ))}
            </div>
          )}
          <input type="file" accept="image/*" multiple style={{ marginTop: 8 }} onChange={(e) => setNewFiles([...e.target.files])} />
          {newFiles.length > 0 && <p className="small muted">{newFiles.length === 1 ? t('1 foto se subirá al guardar.') : t('{n} fotos se subirán al guardar.', { n: newFiles.length })}</p>}
          <p className="small muted" style={{ marginBottom: 0 }}>{t('Las fotos son privadas: solo las ves tú.')}</p>
        </div>

        {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
        <button className="btn block" disabled={busy}>{busy ? t('Guardando…') : t('Guardar inmersión')}</button>
        {!isNew && <button type="button" className="btn block ghost" style={{ marginTop: 8 }} onClick={removeLog}>{t('Borrar inmersión')}</button>}
      </form>
    </>
  )
}
