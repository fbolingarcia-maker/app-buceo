import { useEffect, useMemo, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Link } from '../lib/router'
import { LEVELS, levelName, levelRank, levelColor, initials, manilaDate, addDays, dayLabel, time, php } from '../lib/format'
import { t } from '../lib/i18n'
import { norm, distKm, kmLabel, currentPosition, ss, ssSet } from '../lib/geo'
import { loadDestinations, suggestPlaces, inPlace, placeLabel, loadRatings, loadSiteAreas } from '../lib/places'
import { useAuth } from '../lib/auth'
import { langName } from '../lib/langs'
import Icon from '../lib/Icon'
import { CalendarDays, ChevronRight, MapPin, LocateFixed, X, Waves } from 'lucide-react'

const DAYS = 8
const json = (k) => { try { return JSON.parse(ss(k)) } catch { return null } }

export default function Explorar() {
  const today = manilaDate()
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i))
  const savedDay = ss('day')
  const [day, setDay] = useState(() => (savedDay && savedDay >= today && savedDay < addDays(today, DAYS) ? savedDay : addDays(today, 1)))
  const [level, setLevel] = useState(() => ss('level') || 'all')
  const [agency, setAgency] = useState(() => ss('agency') || '')
  const [lang, setLang] = useState(() => ss('lang') || '')
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
    ssSet('q', q); ssSet('day', day); ssSet('sort', sort); ssSet('level', level); ssSet('agency', agency); ssSet('lang', lang)
    ssSet('place', place ? JSON.stringify(place) : ''); ssSet('here', here ? JSON.stringify(here) : '')
  }, [q, day, sort, place, here, level, agency, lang])

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

  // Si el buceador tiene certificación, filtra por su nivel la primera vez
  const { diver } = useAuth()
  useEffect(() => {
    if (!diver || ss('levelSet')) return
    supabase.from('certifications').select('level').eq('diver_id', diver.id).then(({ data }) => {
      const best = (data || []).reduce((m, c) => (levelRank(c.level) > levelRank(m) ? c.level : m), '')
      if (best) setLevel(LEVELS.slice(0, 4).some(([k]) => k === best) ? best : 'divemaster')
    })
  }, [diver])

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
    .filter((tr) => !agency || (tr.center_agencies || []).some((a) => a.toUpperCase() === agency.toUpperCase()))
    .filter((tr) => !lang || (tr.center_languages || []).includes(lang) || (tr.center_course_languages || []).includes(lang))
    .filter((tr) => inPlace({ destination: destOf(tr), province: tr.center_province }, place, dests))
    .filter((tr) => {
      if (!words.length) return true
      const d = dests.find((x) => x.name === destOf(tr))
      const text = norm([tr.center_name, tr.center_locality, destOf(tr), tr.center_province, d?.island_group, tr.boat_name, ...(tr.sites || [])].join(' '))
      return words.every((w) => text.includes(w))
    })
    .map((tr) => ({ ...tr, km: here && tr.center_lat != null ? distKm(here, { lat: tr.center_lat, lng: tr.center_lng }) : null })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [trips, level, agency, lang, place, q, here, dests])

  const perDay = {}
  for (const tr of filtered) { const d = manilaDate(new Date(tr.departs_at)); perDay[d] = (perDay[d] || 0) + 1 }
  let shown = filtered.filter((tr) => manilaDate(new Date(tr.departs_at)) === day)
  if (sort === 'price') shown = [...shown].sort((a, b) => a.price_php - b.price_php)
  else if (sort === 'near' && here) shown = [...shown].sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || a.departs_at.localeCompare(b.departs_at))
  // Salidas del día agrupadas por centro (como los clubs de Playtomic: primero el centro, luego su disponibilidad)
  const groups = Object.values(shown.reduce((m, tr) => {
    const g = m[tr.center_id] || (m[tr.center_id] = { id: tr.center_id, name: tr.center_name, dest: destOf(tr), prov: tr.center_province, km: tr.km, langs: tr.center_languages || [], agencies: tr.center_agencies || [], trips: [] })
    g.trips.push(tr)
    return m
  }, {})).map((g) => {
    g.trips.sort((a, b) => a.departs_at.localeCompare(b.departs_at))
    g.seats = g.trips.reduce((n, x) => n + Math.max(0, x.available_seats), 0)
    g.booked = g.trips.reduce((n, x) => n + (x.booked_seats || 0), 0)
    g.min = Math.min(...g.trips.map((x) => x.price_php))
    return g
  })
  if (sort === 'price') groups.sort((a, b) => a.min - b.min)
  else if (sort === 'near' && here) groups.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9))
  else groups.sort((a, b) => a.trips[0].departs_at.localeCompare(b.trips[0].departs_at))

  // Primera visita: abre el primer día que tenga salidas (hoy si aún quedan)
  const [autoDay, setAutoDay] = useState(!savedDay)
  useEffect(() => {
    if (!autoDay || !trips) return
    setAutoDay(false)
    if (!perDay[day]) { const first = days.find((d) => perDay[d]); if (first) setDay(first) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, autoDay])
  // Semana entera sin salidas (y sin búsqueda): en vez de «prueba otro día», dar un siguiente paso
  const weekEmpty = trips && Object.keys(perDay).length === 0 && !place && !q
  const nextDay = days.find((d) => d > day && perDay[d]) || days.find((d) => perDay[d])
  const nearest = here ? Math.min(...filtered.map((tr) => tr.km ?? 1e9)) : null

  // Destinos con salidas, para los atajos
  const popular = Object.entries((trips || []).reduce((m, tr) => { const d = destOf(tr); if (d) m[d] = (m[d] || 0) + 1; return m }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d]) => d)

  // Opciones de filtro según las salidas que hay
  const agencyOpts = [...new Set((trips || []).flatMap((tr) => (tr.center_agencies || []).map((a) => a.toUpperCase())))].sort()
  const langOpts = [...new Set((trips || []).flatMap((tr) => [...(tr.center_languages || []), ...(tr.center_course_languages || [])]))]

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
            {locating ? t('Buscando…') : <><Icon icon={LocateFixed} />{t('Cerca de mí')}{here && <Icon icon={X} />}</>}
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="suggest">
            {suggestions.map((s) => (
              <button key={s.kind + s.name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickPlace({ kind: s.kind, name: s.name })}>
                <span><Icon icon={MapPin} /> {s.name}</span>
                <span className="muted small">{s.site && <Icon icon={Waves} size={14} />} {s.kind === 'dest' ? s.sub : s.kind === 'prov' ? t('Provincia') : t('Región')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {place && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          <button className="pill" style={{ border: 0, cursor: 'pointer', fontSize: 14, padding: '6px 12px' }} onClick={() => setPlace(null)}>
            <Icon icon={MapPin} size={16} /> {placeLabel(place, dests)} <Icon icon={X} size={16} aria-label={t('Quitar')} />
          </button>
          {place.kind === 'dest' && <Link to={'/d/' + encodeURIComponent(place.name)} className="small">{t('Guía del destino')}</Link>}
        </div>
      )}
      {!place && !here && !q && popular.length > 1 && (
        <div className="chips">
          {popular.map((d) => <button key={d} onClick={() => pickPlace({ kind: 'dest', name: d })}>{d}</button>)}
        </div>
      )}
      {geoErr && <div className="msg err" role="alert">{geoErr}</div>}
      {here && nearest > 50 && nearest < 1e9 && <div className="msg ok" role="status">{t('No hay salidas cerca de ti. Te mostramos primero las más próximas.')}</div>}

      <div className="days">
        {days.map((d, i) => (
          <button key={d} type="button" aria-pressed={d === day} className={d === day ? 'day on' : 'day'} onClick={() => setDay(d)}
            aria-label={t('{dia}: {n} salidas', { dia: dayLabel(d, { weekday: 'long', day: 'numeric' }), n: perDay[d] || 0 })}>
            <small>{i === 0 ? t('Hoy') : dayLabel(d, { weekday: 'short' })}</small>
            <b>{dayLabel(d, { day: 'numeric' })}</b>
            <i className={perDay[d] ? 'dot' : 'dot none'} aria-hidden="true" />
          </button>
        ))}
      </div>

      {/* Filtros en una sola fila que se desliza: en el móvil no ocupan media pantalla */}
      <div className="filters">
        <select className={level !== 'all' ? 'on' : ''} value={level} onChange={(e) => { setLevel(e.target.value); ssSet('levelSet', '1') }} aria-label={t('Tu nivel')}>
          <option value="all">{t('Cualquier nivel')}</option>
          {LEVELS.slice(0, 4).map(([k, n]) => <option key={k} value={k}>{t('Soy {nivel}', { nivel: n })}</option>)}
        </select>
        {agencyOpts.length > 0 && (
          <select className={agency ? 'on' : ''} value={agency} onChange={(e) => setAgency(e.target.value)} aria-label={t('Agencia')}>
            <option value="">{t('Cualquier agencia')}</option>
            {agencyOpts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        {langOpts.length > 1 && (
          <select className={lang ? 'on' : ''} value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Idioma del centro')}>
            <option value="">{t('Cualquier idioma')}</option>
            {langOpts.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('Ordenar')}>
          <option value="time">{t('Ordenar: hora')}</option>
          <option value="price">{t('Ordenar: precio')}</option>
          {here && <option value="near">{t('Ordenar: distancia')}</option>}
        </select>
      </div>

      {error && <div className="msg err" role="alert">{error}</div>}
      {trips === null && [0, 1, 2].map((i) => <div key={i} className="card skeleton" aria-hidden="true"><div /><div /><div /></div>)}
      {weekEmpty && (
        <div className="empty">
          <span className="empty-glyph" aria-hidden="true"><CalendarDays size={26} strokeWidth={1.75} /></span>
          <h2>{t('No hay salidas publicadas esta semana')}</h2>
          <p className="muted">{t('Los centros de buceo están empezando a publicar sus salidas. Mientras tanto, consulta los puntos de buceo y los centros de cada zona.')}</p>
          <div className="list">
            <Link to="/puntos" className="li"><span className="tile"><Waves size={20} /></span><span className="grow"><b>{t('Puntos de buceo')}</b><small>{t('Toda Filipinas por zonas: profundidad, nivel y qué se ve')}</small></span><ChevronRight size={18} /></Link>
            <Link to="/centros" className="li"><span className="tile"><MapPin size={20} /></span><span className="grow"><b>{t('Centros de buceo')}</b><small>{t('Contacto, agencias e idiomas')}</small></span><ChevronRight size={18} /></Link>
          </div>
        </div>
      )}
      {trips && !weekEmpty && shown.length === 0 && (
        <div className="card center muted">
          {place || q ? t('No hay salidas que coincidan con tu búsqueda este día.') : t('No hay salidas para este día. Prueba otro día.')}
          <div className="row wrap" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
            {nextDay && nextDay !== day && (
              <button className="btn small" onClick={() => setDay(nextDay)}>
                {t('Ver el {dia} ({n})', { dia: dayLabel(nextDay, { weekday: 'long', day: 'numeric' }), n: perDay[nextDay] })}
              </button>
            )}
            {(place || q || level !== 'all' || agency || lang) && <button className="btn small ghost" onClick={() => { setQ(''); setPlace(null); setLevel('all'); setAgency(''); setLang('') }}>{t('Quitar filtros')}</button>}
          </div>
        </div>
      )}
      {groups.length > 0 && (
        <p className="small muted" style={{ margin: '4px 0 8px' }}>
          {groups.length === 1 ? t('1 centro con salidas') : t('{n} centros con salidas', { n: groups.length })} · {shown.length === 1 ? t('1 salida') : t('{n} salidas', { n: shown.length })}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.id} className="card centre-card" aria-label={g.name}>
          <Link to={'/c/' + g.id} className="centre-head">
            <span className="centre-avatar" aria-hidden="true">{initials(g.name)}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <b className="centre-name">{g.name}</b>
              <span className="small muted centre-meta">
                {g.dest}{g.km != null ? ' · ' + kmLabel(g.km) : ''}
                {ratings[g.id] && <> · <span className="rating">{ratings[g.id].rating}</span></>}
                {g.agencies.length > 0 && <> · <span className="agency-text">{[...new Set(g.agencies.map((a) => a.toUpperCase()))].join(' · ')}</span></>}
              </span>
            </span>
            <span className="from small muted">{t('desde')}<b className="data">{php(g.min)}</b></span>
          </Link>
          <div className="slots">
            {g.trips.map((tr) => {
              const free = Math.max(0, tr.available_seats)
              const cap = Math.min(8, Math.max(free + (tr.booked_seats || 0), 1))
              const label = free === 0 ? t('Completa') : free === 1 ? t('Última plaza') : t('{n} libres', { n: free })
              return (
                <Link key={tr.id} to={'/salida/' + tr.id} className={'slot' + (free === 0 ? ' full' : free === 1 ? ' low' : '')}
                  aria-label={t('{hora}, {plazas}, nivel mínimo {nivel}', { hora: time(tr.departs_at), plazas: label, nivel: levelName(tr.min_level) })}>
                  <span className="slot-level" style={{ background: levelColor(tr.min_level) }} title={levelName(tr.min_level)} />
                  <b className="data">{time(tr.departs_at)}</b>
                  <span className="seats" aria-hidden="true">{Array.from({ length: cap }, (_, i) => <i key={i} className={i < free ? 'on' : ''} />)}</span>
                  <small>{label}</small>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
      {trips && <p className="small muted center" style={{ marginTop: 16 }}>{t('¿Tu centro no aparece?')} <Link to="/centros">{t('Ver el directorio de centros')}</Link></p>}
    </>
  )
}
