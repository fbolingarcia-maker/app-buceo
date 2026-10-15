import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Link } from '../lib/router'
import { t } from '../lib/i18n'
import { dateTime, levelName, php } from '../lib/format'
import { loadRatings } from '../lib/places'

// Ficha pública de un centro: datos, valoración y próximas salidas
export default function CentroInfo({ id }) {
  const [c, setC] = useState(null)
  const [trips, setTrips] = useState([])
  const [rating, setRating] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('centers').select('id, name, area, locality, destination, province, website, phone, listing_status, lat, lng, location_precision, source_url').eq('id', id).maybeSingle()
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setC(data || false) })
    supabase.from('published_trips').select('*').eq('center_id', id).gte('departs_at', new Date().toISOString()).order('departs_at').limit(20)
      .then(({ data }) => setTrips(data || []))
    loadRatings().then((r) => setRating(r[id] || null))
  }, [id])

  if (c === null) return <p className="muted">{error || t('Cargando…')}</p>
  if (c === false) return <div className="card">{t('Centro no encontrado.')} <Link to="/centros">{t('Ver el directorio de centros')}</Link></div>

  const dest = c.destination || c.area
  const mapUrl = c.location_precision === 'exacta' && c.lat
    ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.name + ' ' + (dest || ''))

  return (
    <>
      <Link to="/centros" className="small">← {t('Centros')}</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4 }}>{c.name}</h1>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        {dest && <Link to={'/d/' + encodeURIComponent(dest)} className="small">📍 {[c.locality !== dest ? c.locality : null, dest, c.province].filter(Boolean).join(', ')}</Link>}
        {rating && <span className="pill ok">⭐ {rating.rating} · {rating.reviews === 1 ? t('1 valoración') : t('{n} valoraciones', { n: rating.reviews })}</span>}
        {c.listing_status === 'socio' ? <span className="pill ok">{t('Reserva en la app')}</span> : <span className="pill">{t('Próximamente')}</span>}
      </div>

      <div className="card row wrap" style={{ gap: 8 }}>
        {c.phone && <a className="btn small ghost" href={'https://wa.me/' + c.phone.replace(/\D/g, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
        {c.website && <a className="btn small ghost" href={c.website} target="_blank" rel="noreferrer">{t('Web')}</a>}
        {!c.website && c.source_url && <a className="btn small ghost" href={c.source_url} target="_blank" rel="noreferrer">{t('Más información')}</a>}
        <a className="btn small ghost" href={mapUrl} target="_blank" rel="noreferrer">{t('Mapa')}</a>
      </div>

      <h2>{t('Próximas salidas')}</h2>
      {trips.length === 0 && (
        <div className="card muted">
          {c.listing_status === 'socio' ? t('Este centro no tiene salidas publicadas ahora mismo.') : t('Este centro todavía no publica sus salidas en DiveSlot. Puedes contactarle directamente.')}
        </div>
      )}
      {trips.map((tr) => (
        <Link key={tr.id} to={'/salida/' + tr.id} className="card">
          <div className="row between"><b>{dateTime(tr.departs_at)}</b><b>{php(tr.price_php)}</b></div>
          <div className="small muted">{t('{n} inmersiones', { n: tr.num_dives })} · {(tr.sites || []).join(' · ') || t('Puntos por confirmar')}</div>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <span className="pill">{t('Mín. {nivel}', { nivel: levelName(tr.min_level) })}</span>
            <span className={tr.available_seats > 0 ? 'pill ok' : 'pill bad'}>{tr.available_seats > 0 ? t('{n} plazas', { n: tr.available_seats }) : t('Completa')}</span>
          </div>
        </Link>
      ))}
    </>
  )
}
