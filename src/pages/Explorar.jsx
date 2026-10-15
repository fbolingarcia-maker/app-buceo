import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Link } from '../lib/router'
import { LEVELS, levelName, levelRank, manilaDate, addDays, dayRange, dayLabel, time, php } from '../lib/format'

export default function Explorar() {
  const today = manilaDate()
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i))
  const [day, setDay] = useState(() => sessionStorage.getItem('day') || addDays(today, 1))
  const [level, setLevel] = useState('all')
  const [trips, setTrips] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    sessionStorage.setItem('day', day)
    setTrips(null); setError('')
    const [from, to] = dayRange(day)
    supabase.from('published_trips').select('*')
      .gte('departs_at', from < new Date().toISOString() ? new Date().toISOString() : from).lt('departs_at', to)
      .order('departs_at')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setTrips(data || []) })
  }, [day])

  const shown = (trips || []).filter((t) => level === 'all' || levelRank(t.min_level) <= levelRank(level))

  return (
    <>
      <h1>Salidas de buceo</h1>
      <div className="days">
        {days.map((d, i) => (
          <button key={d} className={d === day ? 'day on' : 'day'} onClick={() => setDay(d)}>
            <small>{i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : dayLabel(d, { weekday: 'short' })}</small>
            <b>{dayLabel(d, { day: 'numeric' })}</b>
            <small>{dayLabel(d, { month: 'short' })}</small>
          </button>
        ))}
      </div>
      <div className="seg">
        <button className={level === 'all' ? 'on' : ''} onClick={() => setLevel('all')}>Todas</button>
        {LEVELS.slice(0, 3).map(([k, n]) => (
          <button key={k} className={level === k ? 'on' : ''} onClick={() => setLevel(k)}>Mi nivel: {n}</button>
        ))}
      </div>
      {error && <div className="msg err">{error}</div>}
      {trips === null && <p className="muted">Cargando…</p>}
      {trips && shown.length === 0 && (
        <div className="card center muted">No hay salidas para este día. Prueba otro día.</div>
      )}
      {shown.map((t) => (
        <Link key={t.id} to={'/salida/' + t.id} className="card">
          <div className="row between">
            <div className="big">{time(t.departs_at)}</div>
            <div className="big">{php(t.price_php)}</div>
          </div>
          <div style={{ fontWeight: 600, marginTop: 2 }}>{t.center_name}</div>
          <div className="muted small">{t.num_dives} inmersiones · {(t.sites || []).join(' · ') || 'Puntos por confirmar'}</div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <span className="pill">Mín. {levelName(t.min_level)}</span>
            <span className={t.available_seats > 2 ? 'pill ok' : t.available_seats > 0 ? 'pill warn' : 'pill bad'}>
              {t.available_seats > 0 ? `${t.available_seats} plazas` : 'Completa'}
            </span>
            <span className="muted small">⛵ {t.boat_name}</span>
          </div>
        </Link>
      ))}
    </>
  )
}
