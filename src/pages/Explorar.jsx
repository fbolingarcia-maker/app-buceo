import { useEffect, useMemo, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Link } from '../lib/router'
import { LEVELS, levelName, levelRank, manilaDate, addDays, dayLabel, time, php } from '../lib/format'
import { t } from '../lib/i18n'
import { norm, distKm, kmLabel, currentPosition, ss, ssSet } from '../lib/geo'
import { loadDestinations, suggestPlaces, inPlace, placeLabel, loadRatings, loadSiteAreas } from '../lib/places'

const DAYS = 8
const json = (k) => { try { return JSON.parse(ss(k)) } catch { return null } }

export default function Explorar() {
  const today = manilaDate()
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i))
  const [day, setDay] = useState(() => { const d = ss('day'); return d && d >= today && d < addDays(today, DAYS) ? d : addDays(today, 1) })
  const [level, setLevel] = useState('all')
  const [trips, setTrips] = useState(null)
  const [dests, setDests] = useState([])
  const [siteAreas, setSiteAreas] = useState([])
  const [ratings, setRatings] = useState({})
  const [error, setError] = useState('')
  const [q, setQ] = useState(() => ss('q') || '')
  const [place, setPlace] = useState(() => json('place'))
  const [here, setHere] = useState(() => json('here'))
  const [sort, setSort] = useState(() => ss('sort') || 'time')
  const [focus, setFocus] = useState(false)
  const [locating, setLocating] = useState(false)
  const [geoErr, setGeoErr] = useState('')

  useEffect(() => {
    ssSet('q', q); ssSet('day', day); ssSet('sort', sort)
    ssSet('place', place ? JSON.stringify(place) : ''); ssSet('here', here ? JSON.stringify(here) : '')
  }, [q, day, sort, place, here])

  // Todas las salidas de los próximos 8 días en una sola consulta
  useEffect(() => {
    loadDestinations().then(setDests)
    loadSiteAreas().then(setSiteAreas)
    loadRatings().then(setRatings)
    const from = new Date().toISOString()
    const to = new Date(addDays(today, DAYS) + 'T00:00:00+08:00').toISOString()
    supabase.from('published_trips').select('*').gte('departs_at', from).lt('departs_at', to).order('departs_at')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setTrips(data || []) })
  }, [today])

  async function nearMe() {
    if (here) { setHere(null); if (sort === 'near') setSort('time'); return }
    setGeoErr(''); setLocating(true)
    try { setHere(await currentPosition()); setSort('near'); setPlace(null) } catch (e) { setGeoErr(e.message) }
    setLocating(false)
  }

  const destOf = (tr) => tr.center_destination || tr.center_area || ''
  const words = norm(q).split(/\s+/).filter(Boolean)
  const suggestions = focus && q.trim() ? suggestPlaces(q, dests, siteAreas) : []

  // Filtros comunes (todo menos el día)
  const filtered = useMemo(() => (trips || [])
    .filter((tr) => level === 'all' || levelRank(tr.min_level) <= levelRank(level))
    .filter((tr) => inPlace({ destination: destOf(tr), province: tr.center_province }, place, dests))
    .filter((tr) => {
      if (!words.length) return true
      const d = dests.find((x) => x.name === destOf(tr))
      const text = norm([tr.center_name, tr.center_locality, destOf(tr), tr.center_province, d?.island_group, tr.boat_name, ...(tr.sites || [])].join(' '))
      return words.every((w) => text.includes(w))
    })
    .map((tr) => ({ ...tr, km: here && tr.center_lat != null ? distKm(here, { lat: tr.center_lat, lng: tr.center_lng }) : null })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [trips, level, place, q, here, dests])

  const perDay = {}
  for (const tr of filtered) { const d = manilaDate(new Date(tr.departs_at)); perDay[d] = (perDay[d] || 0) + 1 }
  let shown = filtered.filter((tr) => manilaDate(new Date(tr.departs_at)) === day)
  if (sort === 'price') shown = [...shown].sort((a, b) => a.price_php - b.price_php)
  else if (sort === 'near' && here) shown = [...shown].sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || a.departs_at.localeCompare(b.departs_at))
  const nextDay = days.find((d) => d > day && perDay[d]) || days.find((d) => perDay[d])
  const nearest = here ? Math.min(...filtered.map((tr) => tr.km ?? 1e9)) : null

  // Destinos con salidas, para los atajos
  const popular = Object.entries((trips || []).reduce((m, tr) => { const d = destOf(tr); if (d) m[d] = (m[d] || 0) + 1; return m }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d]) => d)

  const pickPlace = (p) => { setPlace(p); setQ(''); setFocus(false); if (sort === 'near') setSort('time') }

  return (
    <>
      <h1>{t('Salidas de buceo en Filipinas')}</h1>

      <div className="search-box">
        <div className="row" style={{ gap: 8 }}>
          <input type="search" className="grow" placeholder={t('¿Dónde quieres bucear? Zona, isla, centro…')} value={q}
            onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
            aria-label={t('¿Dónde quieres bucear? Zona, isla, centro…')} />
          <button type="button" className={here ? 'btn small' : 'btn small ghost'} style={{ whiteSpace: 'nowrap' }} disabled={locating} onClick={nearMe}>
            {locating ? t('Buscando…') : here ? t('📍 Cerca de mí ✕') : t('📍 Cerca de mí')}
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="suggest">
            {suggestions.map((s) => (
              <button key={s.kind + s.name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickPlace({ kind: s.kind, name: s.name })}>
                <span>📍 {s.name}</span>
                <span className="muted small">{s.kind === 'dest' ? s.sub : s.kind === 'prov' ? t('Provincia') : t('Región')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {place && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          <button className="pill" style={{ border: 0, cursor: 'pointer', fontSize: 14, padding: '6px 12px' }} onClick={() => setPlace(null)}>
            📍 {placeLabel(place, dests)} ✕
          </button>
          {place.kind === 'dest' && <Link to={'/d/' + encodeURIComponent(place.name)} className="small">{t('Guía del destino')}</Link>}
        </div>
      )}
      {!place && !here && !q && popular.length > 1 && (
        <div className="chips">
          {popular.map((d) => <button key={d} onClick={() => pickPlace({ kind: 'dest', name: d })}>{d}</button>)}
        </div>
      )}
      {geoErr && <div className="msg err">{geoErr}</div>}
      {here && nearest > 50 && nearest < 1e9 && <div className="msg ok">{t('No hay salidas cerca de ti. Te mostramos primero las más próximas.')}</div>}

      <div className="days">
        {days.map((d, i) => (
          <button key={d} className={d === day ? 'day on' : 'day'} onClick={() => setDay(d)}>
            <small>{i === 0 ? t('Hoy') : i === 1 ? t('Mañana') : dayLabel(d, { weekday: 'short' })}</small>
            <b>{dayLabel(d, { day: 'numeric' })}</b>
            <small className={perDay[d] ? 'count' : 'count none'}>{trips ? (perDay[d] || 0) : '·'}</small>
          </button>
        ))}
      </div>

      <div className="row between wrap" style={{ gap: 6, marginBottom: 6 }}>
        <div className="seg" style={{ marginBottom: 0 }}>
          <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')}>{t('Todos los niveles')}</button>
          {LEVELS.slice(0, 3).map(([k, n]) => (
            <button key={k} className={level === k ? 'on' : ''} onClick={() => setLevel(k)}>{t('Mi nivel: {nivel}', { nivel: n })}</button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }} aria-label={t('Ordenar')}>
          <option value="time">{t('Ordenar: hora')}</option>
          <option value="price">{t('Ordenar: precio')}</option>
          {here && <option value="near">{t('Ordenar: distancia')}</option>}
        </select>
      </div>

      {error && <div className="msg err">{error}</div>}
      {trips === null && <p className="muted">{t('Cargando…')}</p>}
      {trips && shown.length === 0 && (
        <div className="card center muted">
          {place || q ? t('No hay salidas que coincidan con tu búsqueda este día.') : t('No hay salidas para este día. Prueba otro día.')}
          <div className="row wrap" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
            {nextDay && nextDay !== day && (
              <button className="btn small" onClick={() => setDay(nextDay)}>
                {t('Ver el {dia} ({n})', { dia: dayLabel(nextDay, { weekday: 'long', day: 'numeric' }), n: perDay[nextDay] })}
              </button>
            )}
            {(place || q) && <button className="btn small ghost" onClick={() => { setQ(''); setPlace(null) }}>{t('Quitar filtros')}</button>}
          </div>
        </div>
      )}
      {shown.map((tr) => (
        <Link key={tr.id} to={'/salida/' + tr.id} className="card">
          <div className="row between">
            <div className="big">{time(tr.departs_at)}</div>
            <div className="big">{php(tr.price_php)}</div>
          </div>
          <div className="row between" style={{ marginTop: 2, gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{tr.center_name}{ratings[tr.center_id] && <span className="small" style={{ fontWeight: 400 }}> · ⭐ {ratings[tr.center_id].rating}</span>}</span>
            <span className="muted small" style={{ textAlign: 'right' }}>📍 {destOf(tr)}{tr.center_province ? ', ' + tr.center_province : ''}{tr.km != null ? ' · ' + kmLabel(tr.km) : ''}</span>
          </div>
          <div className="muted small">{t('{n} inmersiones', { n: tr.num_dives })} · {(tr.sites || []).join(' · ') || t('Puntos por confirmar')}</div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <span className="pill">{t('Mín. {nivel}', { nivel: levelName(tr.min_level) })}</span>
            <span className={tr.available_seats > 2 ? 'pill ok' : tr.available_seats > 0 ? 'pill warn' : 'pill bad'}>
              {tr.available_seats > 0 ? t('{n} plazas', { n: tr.available_seats }) : t('Completa')}
            </span>
            {tr.booked_seats > 0 && <span className="pill">{tr.booked_seats === 1 ? t('👥 1 apuntado') : t('👥 {n} apuntados', { n: tr.booked_seats })}</span>}
            <span className="muted small">⛵ {tr.boat_name}</span>
          </div>
        </Link>
      ))}
      {trips && <p className="small muted center" style={{ marginTop: 16 }}>{t('¿Tu centro no aparece?')} <Link to="/centros">{t('Ver el directorio de centros')}</Link></p>}
    </>
  )
}
