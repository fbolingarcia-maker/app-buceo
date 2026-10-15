import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Link } from '../lib/router'
import { LEVELS, levelName, levelRank, manilaDate, addDays, dayRange, dayLabel, time, php } from '../lib/format'
import { t } from '../lib/i18n'
import { norm, distKm, kmLabel, currentPosition, ss, ssSet } from '../lib/geo'

export default function Explorar() {
  const today = manilaDate()
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i))
  const [day, setDay] = useState(() => ss('day') || addDays(today, 1))
  const [level, setLevel] = useState('all')
  const [trips, setTrips] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState(() => ss('q') || '')
  const [zone, setZone] = useState(() => ss('zone') || '')
  const [here, setHere] = useState(() => { try { return JSON.parse(ss('here')) } catch { return null } })
  const [locating, setLocating] = useState(false)
  const [geoErr, setGeoErr] = useState('')

  useEffect(() => { ssSet('q', q); ssSet('zone', zone); ssSet('here', here ? JSON.stringify(here) : '') }, [q, zone, here])

  async function nearMe() {
    if (here) return setHere(null)
    setGeoErr(''); setLocating(true)
    try { setHere(await currentPosition()) } catch (e) { setGeoErr(e.message) }
    setLocating(false)
  }

  useEffect(() => {
    ssSet('day', day)
    setTrips(null); setError('')
    const [from, to] = dayRange(day)
    supabase.from('published_trips').select('*')
      .gte('departs_at', from < new Date().toISOString() ? new Date().toISOString() : from).lt('departs_at', to)
      .order('departs_at')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setTrips(data || []) })
  }, [day])

  const zoneOf = (tr) => tr.center_locality || tr.center_area || ''
  const zones = [...new Set((trips || []).map(zoneOf).filter(Boolean))].sort()
  const words = norm(q).split(/\s+/).filter(Boolean)
  let shown = (trips || [])
    .filter((tr) => level === 'all' || levelRank(tr.min_level) <= levelRank(level))
    .filter((tr) => !zone || zoneOf(tr) === zone)
    .filter((tr) => {
      if (!words.length) return true
      const text = norm([tr.center_name, tr.center_locality, tr.center_area, tr.boat_name, ...(tr.sites || [])].join(' '))
      return words.every((w) => text.includes(w))
    })
    .map((tr) => ({ ...tr, km: here && tr.center_lat != null ? distKm(here, { lat: tr.center_lat, lng: tr.center_lng }) : null }))
  if (here) shown = shown.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || a.departs_at.localeCompare(b.departs_at))
  const nearest = shown.find((tr) => tr.km != null)?.km

  return (
    <>
      <h1>{t('Salidas de buceo')}</h1>
      <div className="days">
        {days.map((d, i) => (
          <button key={d} className={d === day ? 'day on' : 'day'} onClick={() => setDay(d)}>
            <small>{i === 0 ? t('Hoy') : i === 1 ? t('Mañana') : dayLabel(d, { weekday: 'short' })}</small>
            <b>{dayLabel(d, { day: 'numeric' })}</b>
            <small>{dayLabel(d, { month: 'short' })}</small>
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input type="search" className="grow" placeholder={t('Buscar zona, centro o punto de buceo…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Buscar zona, centro o punto de buceo…')} />
        <button type="button" className={here ? 'btn small' : 'btn small ghost'} style={{ whiteSpace: 'nowrap' }} disabled={locating} onClick={nearMe}>
          {locating ? t('Buscando…') : here ? t('📍 Cerca de mí ✕') : t('📍 Cerca de mí')}
        </button>
      </div>
      {geoErr && <div className="msg err">{geoErr}</div>}
      {here && nearest != null && nearest > 50 && <div className="msg ok">{t('No hay salidas cerca de ti. Te mostramos primero las más próximas.')}</div>}
      {(zones.length > 1 || zone) && (
        <div className="seg">
          <button className={!zone ? 'on' : ''} onClick={() => setZone('')}>{t('Todas las zonas')}</button>
          {zones.map((z) => <button key={z} className={zone === z ? 'on' : ''} onClick={() => setZone(z)}>📍 {z}</button>)}
        </div>
      )}
      <div className="seg">
        <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')}>{t('Todas')}</button>
        {LEVELS.slice(0, 3).map(([k, n]) => (
          <button key={k} className={level === k ? 'on' : ''} onClick={() => setLevel(k)}>{t('Mi nivel: {nivel}', { nivel: n })}</button>
        ))}
      </div>
      {error && <div className="msg err">{error}</div>}
      {trips === null && <p className="muted">{t('Cargando…')}</p>}
      {trips && shown.length === 0 && (
        <div className="card center muted">
          {q || zone ? t('No hay salidas que coincidan con tu búsqueda este día.') : t('No hay salidas para este día. Prueba otro día.')}
          {(q || zone) && <div style={{ marginTop: 8 }}><button className="btn small ghost" onClick={() => { setQ(''); setZone('') }}>{t('Quitar filtros')}</button></div>}
        </div>
      )}
      {shown.map((tr) => (
        <Link key={tr.id} to={'/salida/' + tr.id} className="card">
          <div className="row between">
            <div className="big">{time(tr.departs_at)}</div>
            <div className="big">{php(tr.price_php)}</div>
          </div>
          <div className="row between" style={{ marginTop: 2 }}>
            <span style={{ fontWeight: 600 }}>{tr.center_name}</span>
            <span className="muted small">{zoneOf(tr)}{tr.km != null ? ' · ' + kmLabel(tr.km) : ''}</span>
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
    </>
  )
}
