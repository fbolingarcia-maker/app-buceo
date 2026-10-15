import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { t } from '../lib/i18n'

export default function CentroAjustes() {
  const { center, refresh } = useAuth()
  return (
    <>
      <h1>{t('Mi centro')}</h1>
      <h2>{t('Barcos y plazas')}</h2>
      <Barcos center={center} />
      <h2>{t('Datos del centro')}</h2>
      <Datos center={center} refresh={refresh} />
    </>
  )
}

function Barcos({ center }) {
  const [boats, setBoats] = useState([])
  const [nb, setNb] = useState({ name: '', capacity: 10 })
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => supabase.from('boats').select('*').eq('center_id', center.id).order('name').then(({ data }) => setBoats(data || [])), [center.id])
  useEffect(() => { load() }, [load])

  async function run(p, ok) { const { error } = await p; setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: ok }); load() }

  return (
    <div className="card">
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      {boats.length === 0 && <p className="muted">{t('Añade tu primer barco para poder crear salidas.')}</p>}
      {boats.map((b) => (
        <div key={b.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <div><b>{b.name}</b> <span className="muted small">· {t('{n} plazas', { n: b.capacity })}</span> {!b.active && <span className="pill bad">{t('Inactivo')}</span>}</div>
          <div className="row">
            <input type="number" min="1" max="60" defaultValue={b.capacity} style={{ width: 70 }}
              onBlur={(e) => +e.target.value !== b.capacity && run(supabase.from('boats').update({ capacity: +e.target.value }).eq('id', b.id), t('Capacidad actualizada'))} />
            <button className="btn small ghost" onClick={() => run(supabase.from('boats').update({ active: !b.active }).eq('id', b.id), t('Barco actualizado'))}>{b.active ? t('Desactivar') : t('Activar')}</button>
          </div>
        </div>
      ))}
      <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => {
        e.preventDefault()
        run(supabase.from('boats').insert({ center_id: center.id, name: nb.name.trim(), capacity: +nb.capacity }), t('Barco añadido'))
        setNb({ name: '', capacity: 10 })
      }}>
        <input className="grow" placeholder={t('Nombre del barco')} required value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
        <input type="number" min="1" max="60" style={{ width: 80 }} value={nb.capacity} onChange={(e) => setNb({ ...nb, capacity: e.target.value })} />
        <button className="btn small">{t('Añadir')}</button>
      </form>
    </div>
  )
}

function Datos({ center, refresh }) {
  const [f, setF] = useState({
    name: center.name || '', phone: center.phone || '', gcash_number: center.gcash_number || '',
    default_divers_per_guide: center.default_divers_per_guide || 4, locality: center.locality || '', website: center.website || '',
    lat: center.lat ?? null, lng: center.lng ?? null,
  })
  const [locating, setLocating] = useState(false)
  function useMyLocation() {
    if (!navigator.geolocation) return setMsg({ ok: false, text: t('Tu navegador no permite obtener la ubicación') })
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setF((x) => ({ ...x, lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) })); setMsg({ ok: true, text: t('Ubicación obtenida. Pulsa «Guardar».') }) },
      () => { setLocating(false); setMsg({ ok: false, text: t('No se pudo obtener tu ubicación. Revisa los permisos del navegador.') }) },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }
  const [msg, setMsg] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function save(e) {
    e.preventDefault()
    const moved = f.lat !== (center.lat ?? null) || f.lng !== (center.lng ?? null)
    const { error } = await supabase.from('centers').update({ ...f, default_divers_per_guide: +f.default_divers_per_guide, ...(moved ? { location_precision: 'exacta' } : {}) }).eq('id', center.id)
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: t('Datos guardados') })
    if (!error) refresh()
  }
  return (
    <form className="card" onSubmit={save}>
      <div className="field"><label>{t('Nombre')}</label><input required value={f.name} onChange={set('name')} /></div>
      <div className="grid2">
        <div className="field"><label>{t('Teléfono / WhatsApp')}</label><input value={f.phone} onChange={set('phone')} /></div>
        <div className="field"><label>{t('Nº GCash')}</label><input value={f.gcash_number} onChange={set('gcash_number')} /></div>
        <div className="field"><label>{t('Zona (Alona, Danao…)')}</label><input value={f.locality} onChange={set('locality')} /></div>
        <div className="field"><label>{t('Buceadores por guía')}</label><input type="number" min="1" max="10" value={f.default_divers_per_guide} onChange={set('default_divers_per_guide')} /></div>
      </div>
      <div className="field"><label>{t('Web')}</label><input type="url" placeholder="https://" value={f.website} onChange={set('website')} /></div>
      <div className="field">
        <label>{t('Ubicación en el mapa')}</label>
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn small ghost" disabled={locating} onClick={useMyLocation}>{locating ? t('Buscando…') : t('📍 Usar mi ubicación actual')}</button>
          {f.lat != null && f.lng != null
            ? <a className="small" href={`https://maps.google.com/?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer">{t('Ver en el mapa')}</a>
            : <span className="small muted">{t('Sin ubicación: los buceadores no te verán en «Cerca de mí».')}</span>}
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>{t('Hazlo desde el centro para que los buceadores te encuentren cerca.')}</p>
      </div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      <button className="btn">{t('Guardar')}</button>
    </form>
  )
}
