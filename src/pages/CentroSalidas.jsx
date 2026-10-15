import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { TRIP_STATUS, levelName, manilaDate, addDays, dayLabel, time, php, manilaToIso } from '../lib/format'
import { seatsSummary, TRIP_SELECT } from '../lib/centro'

const WEEKDAYS = [['1', 'L'], ['2', 'M'], ['3', 'X'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['0', 'D']]
const dayOf = (iso) => manilaDate(new Date(iso))
const hhmm = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export default function CentroSalidas() {
  const { center } = useAuth()
  const today = manilaDate()
  const [filter, setFilter] = useState('next')
  const [trips, setTrips] = useState(null)
  const [msg, setMsg] = useState(null)
  const [dup, setDup] = useState(null) // id de la salida que se está duplicando

  const load = useCallback(async () => {
    let q = supabase.from('trips').select(TRIP_SELECT).eq('center_id', center.id)
    if (filter === 'past') q = q.lt('departs_at', new Date().toISOString()).gte('departs_at', new Date(Date.now() - 30 * 864e5).toISOString()).order('departs_at', { ascending: false })
    else q = q.gte('departs_at', new Date().toISOString()).order('departs_at')
    if (filter === 'drafts') q = q.eq('status', 'draft')
    const { data, error } = await q.limit(200)
    if (error) setMsg({ ok: false, text: errMsg(error) })
    setTrips(data || [])
  }, [center.id, filter])
  useEffect(() => { setTrips(null); load() }, [load])

  async function run(promise, okText) {
    const { error } = await promise
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: okText })
    load()
  }

  async function duplicate(t, dates) {
    const hm = hhmm(t.departs_at)
    const rows = dates.map((d) => ({
      center_id: t.center_id, boat_id: t.boat_id, departs_at: manilaToIso(d, hm), num_dives: t.num_dives, min_level: t.min_level,
      price_php: t.price_php, gear_rental_php: t.gear_rental_php, guides: t.guides, divers_per_guide: t.divers_per_guide,
      seat_override: t.seat_override, blocked_seats: t.blocked_seats, status: 'published',
    }))
    const { data, error } = await supabase.from('trips').insert(rows).select('id')
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    const sites = (t.trip_sites || [])
    if (sites.length) {
      const { data: full } = await supabase.from('trip_sites').select('site_id, position').eq('trip_id', t.id)
      const ts = data.flatMap((n) => (full || []).map((x) => ({ trip_id: n.id, site_id: x.site_id, position: x.position })))
      if (ts.length) await supabase.from('trip_sites').insert(ts)
    }
    setDup(null)
    setMsg({ ok: true, text: `${data.length} salida(s) creadas` })
    load()
  }

  // Agrupar por día
  const groups = {}
  for (const t of trips || []) (groups[dayOf(t.departs_at)] = groups[dayOf(t.departs_at)] || []).push(t)

  return (
    <>
      <div className="row between">
        <h1>Salidas</h1>
        <Link to="/centro/nueva" className="btn small">+ Nueva salida</Link>
      </div>
      <div className="seg">
        {[['next', 'Próximas'], ['drafts', 'Borradores'], ['past', 'Pasadas (30 días)']].map(([k, n]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{n}</button>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      {trips === null && <p className="muted">Cargando…</p>}
      {trips?.length === 0 && <div className="card muted center">No hay salidas aquí. <Link to="/centro/nueva">Crear una</Link></div>}
      {Object.entries(groups).map(([d, ts]) => (
        <div key={d}>
          <h2>{d === today ? 'Hoy' : dayLabel(d, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
          {ts.map((t) => {
            const s = seatsSummary(t)
            const nBookings = (t.bookings || []).length
            const statusCls = t.status === 'published' ? 'pill ok' : t.status === 'draft' ? 'pill warn' : t.status === 'completed' ? 'pill' : 'pill bad'
            return (
              <div key={t.id} className="card">
                <div className="row between">
                  <div>
                    <b>{time(t.departs_at)} · {t.boats?.name}</b>
                    <div className="small muted">{t.num_dives} inm. · mín. {levelName(t.min_level)} · {php(t.price_php)} · {s.booked}/{s.operative} plazas</div>
                  </div>
                  <span className={statusCls}>{TRIP_STATUS[t.status]}</span>
                </div>
                <div className="row wrap" style={{ marginTop: 10 }}>
                  <Link to={'/centro/salida/' + t.id} className="btn small ghost">Editar</Link>
                  <button className="btn small ghost" onClick={() => setDup(dup === t.id ? null : t.id)}>Duplicar</button>
                  <Link to={`/centro/agenda?dia=${d}`} className="btn small ghost">Manifiesto</Link>
                  {t.status === 'draft' && <button className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'published' }).eq('id', t.id), 'Publicada')}>Publicar</button>}
                  {t.status === 'published' && nBookings === 0 && new Date(t.departs_at) > new Date() && (
                    <button className="btn small ghost" onClick={() => run(supabase.from('trips').update({ status: 'draft' }).eq('id', t.id), 'Pasada a borrador')}>Despublicar</button>
                  )}
                  {t.status === 'published' && new Date(t.departs_at) < new Date() && (
                    <button className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'completed' }).eq('id', t.id), 'Marcada como completada')}>Completada</button>
                  )}
                  {nBookings === 0 && (
                    <button className="btn small danger" onClick={() => window.confirm('¿Eliminar esta salida?') && run(supabase.from('trips').delete().eq('id', t.id), 'Salida eliminada')}>Eliminar</button>
                  )}
                </div>
                {dup === t.id && <DuplicateForm from={d} onSubmit={(dates) => duplicate(t, dates)} />}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

// Repetir una salida: N días hacia delante, solo los días de la semana marcados
function DuplicateForm({ from, onSubmit }) {
  const [days, setDays] = useState(7)
  const [wd, setWd] = useState(['0', '1', '2', '3', '4', '5', '6'])
  const start = from > manilaDate() ? from : manilaDate()
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i + 1))
    .filter((d) => wd.includes(String(new Date(d + 'T12:00:00+08:00').getUTCDay())))
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <div className="row wrap small">
        Repetir durante los próximos
        <input type="number" min="1" max="60" value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, +e.target.value || 1)))} style={{ width: 70 }} />
        días, los:
      </div>
      <div className="seg" style={{ marginTop: 6 }}>
        {WEEKDAYS.map(([k, n]) => (
          <button key={k} className={wd.includes(k) ? 'on' : ''} onClick={() => setWd(wd.includes(k) ? wd.filter((x) => x !== k) : [...wd, k])}>{n}</button>
        ))}
      </div>
      <button className="btn small" disabled={!dates.length} onClick={() => onSubmit(dates)}>Crear {dates.length} salida(s)</button>
    </div>
  )
}
