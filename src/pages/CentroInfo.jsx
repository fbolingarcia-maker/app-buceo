import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Link } from '../lib/router'
import { t } from '../lib/i18n'
import { levelName, php, time, dayLabel, manilaDate } from '../lib/format'
import { loadRatings } from '../lib/places'
import { Flags, langName } from '../lib/langs'
import { Agencies } from '../lib/agencies'
import Icon from '../lib/Icon'
import { ArrowLeft, ChevronRight, MapPin, ShieldCheck } from 'lucide-react'

// Ficha pública de un centro: datos, valoración y próximas salidas
export default function CentroInfo({ id }) {
  const [c, setC] = useState(null)
  const [trips, setTrips] = useState([])
  const [rating, setRating] = useState(null)
  const [error, setError] = useState('')
  const [allDays, setAllDays] = useState(false)

  useEffect(() => {
    supabase.from('centers').select('id, name, area, locality, destination, province, website, phone, listing_status, lat, lng, location_precision, source_url, languages, course_languages, agencies, agency_detail, verification_status').eq('id', id).maybeSingle()
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setC(data || false) })
    supabase.from('published_trips').select('*').eq('center_id', id).gte('departs_at', new Date().toISOString()).order('departs_at').limit(60)
      .then(({ data }) => setTrips(data || []))
    loadRatings().then((r) => setRating(r[id] || null))
  }, [id])

  if (c === null) return <p className="muted">{error || t('Cargando…')}</p>
  if (c === false) return <div className="card">{t('Centro no encontrado.')} <Link to="/centros">{t('Ver el directorio de centros')}</Link></div>

  const dest = c.destination || c.area
  const byDay = Object.entries(trips.reduce((m, tr) => { const d = manilaDate(new Date(tr.departs_at)); (m[d] = m[d] || []).push(tr); return m }, {}))
  const mapUrl = c.location_precision === 'exacta' && c.lat
    ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.name + ' ' + (dest || ''))

  return (
    <>
      <Link to="/centros" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Centros')}</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4 }}>{c.name}</h1>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        {dest && <Link to={'/d/' + encodeURIComponent(dest)} className="small"><Icon icon={MapPin} size={14} /> {[c.locality !== dest ? c.locality : null, dest, c.province].filter(Boolean).join(', ')}</Link>}
        {rating && <span className="pill ok">★ {rating.rating} · {rating.reviews === 1 ? t('1 valoración') : t('{n} valoraciones', { n: rating.reviews })}</span>}
        {c.listing_status === 'socio' ? <span className="pill ok">{t('Reserva en la app')}</span> : <span className="pill">{t('Próximamente')}</span>}
        {c.verification_status === 'verified' && c.listing_status === 'socio' && <span className="pill ok" title={t('DivingSlot ha comprobado los permisos y la identidad de este centro')}><Icon icon={ShieldCheck} size={14} /> {t('Centro verificado')}</span>}
      </div>
      {c.agencies?.length > 0 && (
        <div className="row wrap small" style={{ gap: 8, marginBottom: 12 }}>
          <span className="muted">{t('Certifica con')}</span><Agencies list={c.agencies} />{c.agency_detail && <span className="muted">· {c.agency_detail}</span>}
        </div>
      )}

      {(c.languages?.length > 0 || c.course_languages?.length > 0) && (
        <div className="card stack small">
          {c.languages?.length > 0 && <div className="row between" style={{ gap: 8 }}><span className="muted">{t('Atienden en')}</span><span><Flags codes={c.languages} size={20} /> {c.languages.map(langName).join(', ')}</span></div>}
          {c.course_languages?.length > 0 && <div className="row between" style={{ gap: 8 }}><span className="muted">{t('Cursos en')}</span><span><Flags codes={c.course_languages} size={20} /> {c.course_languages.map(langName).join(', ')}</span></div>}
        </div>
      )}

      <div className="card row wrap" style={{ gap: 8 }}>
        {c.phone && <a className="btn small ghost" href={'https://wa.me/' + c.phone.replace(/\D/g, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
        {c.website && <a className="btn small ghost" href={c.website} target="_blank" rel="noreferrer">{t('Web')}</a>}
        {!c.website && c.source_url && <a className="btn small ghost" href={c.source_url} target="_blank" rel="noreferrer">{t('Más información')}</a>}
        <a className="btn small ghost" href={mapUrl} target="_blank" rel="noreferrer">{t('Mapa')}</a>
      </div>

      <h2>{t('Próximas salidas')}</h2>
      {trips.length === 0 && (
        <div className="card muted">
          {c.listing_status === 'socio' ? t('Este centro no tiene salidas publicadas ahora mismo.') : t('Este centro todavía no publica sus salidas en DivingSlot. Puedes contactarle directamente.')}
        </div>
      )}
      {/* Agrupadas por día y en filas compactas: un centro puede tener decenas de salidas */}
      {byDay.slice(0, allDays ? undefined : 3).map(([day, list]) => (
        <div key={day}>
          <h3 className="day-h">{dayLabel(day, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
          <div className="list" style={{ marginTop: 6 }}>
            {list.map((tr) => (
              <Link key={tr.id} to={'/salida/' + tr.id} className="li trip-li">
                <b className="data trip-time">{time(tr.departs_at)}</b>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="ellipsis">{(tr.sites || []).join(' · ') || t('Puntos por confirmar')}</b>
                  <small className="ellipsis">{t('{n} inmersiones', { n: tr.num_dives })} · {t('Mín. {nivel}', { nivel: levelName(tr.min_level) })}</small>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <b>{php(tr.price_php)}</b>
                  <small className={tr.available_seats > 0 ? (tr.available_seats === 1 ? 'last' : '') : 'full'}>{tr.available_seats > 0 ? (tr.available_seats === 1 ? t('Última plaza') : t('{n} plazas', { n: tr.available_seats })) : t('Completa')}</small>
                </span>
                <ChevronRight size={18} />
              </Link>
            ))}
          </div>
        </div>
      ))}
      {!allDays && byDay.length > 3 && <button type="button" className="btn ghost block" onClick={() => setAllDays(true)}>{t('Ver más días ({n})', { n: byDay.length - 3 })}</button>}
    </>
  )
}
