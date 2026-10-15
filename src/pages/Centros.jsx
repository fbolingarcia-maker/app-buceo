import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { t } from '../lib/i18n'
import { norm, distKm, kmLabel, currentPosition } from '../lib/geo'

export default function Centros() {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [here, setHere] = useState(null)
  const [locating, setLocating] = useState(false)

  async function nearMe() {
    if (here) return setHere(null)
    setError(''); setLocating(true)
    try { setHere(await currentPosition()) } catch (e) { setError(e.message) }
    setLocating(false)
  }

  useEffect(() => {
    supabase.from('centers').select('id, name, area, locality, website, phone, listing_status, lat, lng')
      .neq('listing_status', 'cerrado').not('name', 'like', 'Demo%').order('name')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setList(data || []) })
  }, [])

  const words = norm(q).split(/\s+/).filter(Boolean)
  const shown = (list || [])
    .filter((c) => words.every((w) => norm([c.name, c.locality, c.area].join(' ')).includes(w)))
    .map((c) => ({ ...c, km: here && c.lat != null ? distKm(here, { lat: c.lat, lng: c.lng }) : null }))
  const byZone = shown.reduce((m, c) => { const k = c.locality || c.area; (m[k] = m[k] || []).push(c); return m }, {})
  const zoneKm = (z) => Math.min(...byZone[z].map((c) => c.km ?? 1e9))
  const zoneOrder = Object.keys(byZone).sort((a, b) => (here ? zoneKm(a) - zoneKm(b) : 0) || a.localeCompare(b))

  return (
    <>
      <h1>{t('Centros en Panglao')}</h1>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input type="search" className="grow" placeholder={t('Buscar centro o zona…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={here ? 'btn small' : 'btn small ghost'} style={{ whiteSpace: 'nowrap' }} disabled={locating} onClick={nearMe}>
          {locating ? t('Buscando…') : here ? t('📍 Cerca de mí ✕') : t('📍 Cerca de mí')}
        </button>
      </div>
      {error && <div className="msg err">{error}</div>}
      {list === null && <p className="muted">{t('Cargando…')}</p>}
      {zoneOrder.map((z) => (
        <div key={z}>
          <h2>{z}{here && zoneKm(z) < 1e9 && <span className="muted small" style={{ fontWeight: 400 }}> · {kmLabel(zoneKm(z))}</span>}</h2>
          {byZone[z].map((c) => (
            <div key={c.id} className="card">
              <div className="row between">
                <b>{c.name}</b>
                {c.listing_status === 'socio' ? <span className="pill ok">{t('Reserva en la app')}</span> : <span className="pill">{t('Próximamente')}</span>}
              </div>
              <div className="row wrap small" style={{ marginTop: 6, gap: 14 }}>
                {c.website && <a href={c.website} target="_blank" rel="noreferrer">{t('Web')}</a>}
                {c.lat && c.lng && <a href={`https://maps.google.com/?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer">{t('Mapa')}</a>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
