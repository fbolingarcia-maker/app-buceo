import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { manilaDate, addDays, dayLabel, time, php } from '../lib/format'
import { seatsSummary, money, holds, TRIP_SELECT } from '../lib/centro'

const dayOf = (iso) => manilaDate(new Date(iso))

export default function CentroPanel() {
  const { center } = useAuth()
  const today = manilaDate()
  const [trips, setTrips] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const from = new Date(addDays(today, -7) + 'T00:00:00+08:00').toISOString()
    const to = new Date(addDays(today, 8) + 'T00:00:00+08:00').toISOString()
    supabase.from('trips').select(TRIP_SELECT).eq('center_id', center.id)
      .gte('departs_at', from).lt('departs_at', to).order('departs_at')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setTrips(data || []) })
  }, [center.id, today])

  if (trips === null) return <p className="muted">Cargando panel…</p>

  const live = (t) => t.status === 'published' || t.status === 'completed'
  const todays = trips.filter((t) => dayOf(t.departs_at) === today && t.status !== 'cancelled_weather')
  const todayBookings = todays.flatMap((t) => (t.bookings || []).filter(holds))
  const todaySeats = todays.reduce((a, t) => { const s = seatsSummary(t); return { booked: a.booked + s.booked, op: a.op + s.operative } }, { booked: 0, op: 0 })
  const todayChecked = todayBookings.filter((b) => b.checked_in_at).reduce((n, b) => n + b.seats, 0)
  const todayMoney = money(todayBookings)

  const next = trips.filter((t) => dayOf(t.departs_at) >= today)
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
    const ts = next.filter((t) => dayOf(t.departs_at) === d && live(t))
    const seats = ts.reduce((a, t) => { const s = seatsSummary(t); return { booked: a.booked + s.booked, op: a.op + s.operative } }, { booked: 0, op: 0 })
    return { d, n: ts.length, ...seats, ...money(ts.flatMap((t) => t.bookings || [])) }
  })
  const weekTotals = week.reduce((a, w) => ({ booked: a.booked + w.booked, total: a.total + w.total, paid: a.paid + w.paid }), { booked: 0, total: 0, paid: 0 })

  // Avisos
  const nextBookings = next.filter(live).flatMap((t) => (t.bookings || []).filter(holds).map((b) => ({ ...b, trip: t })))
  const unpaid = nextBookings.filter((b) => b.status === 'pending_payment')
  const balances = nextBookings.filter((b) => b.status === 'confirmed' && b.paid_php < b.amount_php)
  const unverified = nextBookings.filter((b) => b.divers?.certifications?.length && !b.divers.certifications.some((c) => c.verified_at))
  const drafts = next.filter((t) => t.status === 'draft')
  const toClose = trips.filter((t) => t.status === 'published' && new Date(t.departs_at) < new Date(Date.now() - 6 * 3600000))
  const noSites = next.filter((t) => live(t) && !(t.trip_sites || []).length)
  const alerts = [
    unpaid.length && [`${unpaid.length} reserva(s) pendientes de pagar la señal`, '/centro/agenda'],
    balances.length && [`${balances.length} reserva(s) con resto pendiente (${php(balances.reduce((s, b) => s + b.amount_php - b.paid_php, 0))})`, '/centro/agenda'],
    unverified.length && [`${unverified.length} buceador(es) con certificación sin verificar`, '/centro/agenda'],
    drafts.length && [`${drafts.length} salida(s) en borrador sin publicar`, '/centro/salidas'],
    toClose.length && [`${toClose.length} salida(s) pasadas sin marcar como completadas`, '/centro/salidas'],
    noSites.length && [`${noSites.length} salida(s) sin puntos de buceo`, '/centro/salidas'],
  ].filter(Boolean)

  return (
    <>
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 0 }}>{center.name}</h1>
          <p className="muted small" style={{ marginTop: 2 }}>Hoy, {dayLabel(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <Link to="/centro/nueva" className="btn small">+ Salida</Link>
      </div>
      {error && <div className="msg err">{error}</div>}

      <div className="kpis">
        <div className="kpi"><span>Salidas hoy</span><b>{todays.length}</b></div>
        <div className="kpi"><span>Buceadores</span><b>{todaySeats.booked}<small>/{todaySeats.op}</small></b></div>
        <div className="kpi"><span>A bordo</span><b>{todayChecked}<small>/{todaySeats.booked}</small></b></div>
        <div className="kpi"><span>Cobrado hoy</span><b>{php(todayMoney.paid)}</b><small>pendiente {php(todayMoney.pending)}</small></div>
      </div>

      <h2>Salidas de hoy</h2>
      {todays.length === 0 && <div className="card muted">No hay salidas hoy.</div>}
      {todays.map((t) => {
        const s = seatsSummary(t)
        return (
          <Link key={t.id} to={`/centro/agenda?dia=${today}`} className="card">
            <div className="row between"><b>{time(t.departs_at)} · {t.boats?.name}</b><span className="small">{s.booked}/{s.operative} plazas</span></div>
            <div className="bar" style={{ marginTop: 8 }}><div style={{ width: `${s.operative ? Math.min(100, (s.booked / s.operative) * 100) : 0}%` }} /></div>
            <div className="small muted" style={{ marginTop: 6 }}>{(t.trip_sites || []).sort((a, b) => a.position - b.position).map((x) => x.dive_sites?.name).join(', ') || 'Sin puntos'}</div>
          </Link>
        )
      })}

      {alerts.length > 0 && (
        <>
          <h2>Pendiente de tu atención</h2>
          <div className="card">
            {alerts.map(([text, to]) => (
              <Link key={text} to={to} className="row between alert-row"><span>⚠️ {text}</span><span>›</span></Link>
            ))}
          </div>
        </>
      )}

      <h2>Próximos 7 días</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th style={{ paddingLeft: 12 }}>Día</th><th>Salidas</th><th>Ocupación</th><th style={{ textAlign: 'right', paddingRight: 12 }}>Reservado</th></tr></thead>
          <tbody>
            {week.map((w) => (
              <tr key={w.d} onClick={() => go(`/centro/agenda?dia=${w.d}`)} style={{ cursor: 'pointer' }}>
                <td style={{ paddingLeft: 12 }}>{w.d === today ? 'Hoy' : dayLabel(w.d)}</td>
                <td>{w.n}</td>
                <td>{w.op ? `${w.booked}/${w.op} · ${Math.round((w.booked / w.op) * 100)} %` : '—'}</td>
                <td style={{ textAlign: 'right', paddingRight: 12 }}>{w.total ? php(w.total) : '—'}</td>
              </tr>
            ))}
            <tr><td style={{ paddingLeft: 12 }}><b>Total</b></td><td /><td><b>{weekTotals.booked}</b> buceadores</td><td style={{ textAlign: 'right', paddingRight: 12 }}><b>{php(weekTotals.total)}</b><div className="small muted">cobrado {php(weekTotals.paid)}</div></td></tr>
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <Link to="/centro/salidas" className="btn ghost">Gestionar salidas</Link>
        <Link to="/centro/ajustes" className="btn ghost">Barcos y datos</Link>
      </div>
    </>
  )
}
