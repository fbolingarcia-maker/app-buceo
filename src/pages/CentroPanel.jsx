import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { manilaDate, addDays, dayLabel, time, php } from '../lib/format'
import { seatsSummary, money, holds, TRIP_SELECT } from '../lib/centro'
import { t } from '../lib/i18n'

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

  if (trips === null) return <p className="muted">{t('Cargando panel…')}</p>

  const live = (tr) => tr.status === 'published' || tr.status === 'completed'
  const todays = trips.filter((tr) => dayOf(tr.departs_at) === today && tr.status !== 'cancelled_weather')
  const todayBookings = todays.flatMap((tr) => (tr.bookings || []).filter(holds))
  const todaySeats = todays.reduce((a, tr) => { const s = seatsSummary(tr); return { booked: a.booked + s.booked, op: a.op + s.operative } }, { booked: 0, op: 0 })
  const todayChecked = todayBookings.filter((b) => b.checked_in_at).reduce((n, b) => n + b.seats, 0)
  const todayMoney = money(todayBookings)

  const next = trips.filter((tr) => dayOf(tr.departs_at) >= today)
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
    const ts = next.filter((tr) => dayOf(tr.departs_at) === d && live(tr))
    const seats = ts.reduce((a, tr) => { const s = seatsSummary(tr); return { booked: a.booked + s.booked, op: a.op + s.operative } }, { booked: 0, op: 0 })
    return { d, n: ts.length, ...seats, ...money(ts.flatMap((tr) => tr.bookings || [])) }
  })
  const weekTotals = week.reduce((a, w) => ({ booked: a.booked + w.booked, total: a.total + w.total, paid: a.paid + w.paid }), { booked: 0, total: 0, paid: 0 })

  // Avisos
  const nextBookings = next.filter(live).flatMap((tr) => (tr.bookings || []).filter(holds).map((b) => ({ ...b, trip: tr })))
  const unpaid = nextBookings.filter((b) => b.status === 'pending_payment')
  const balances = nextBookings.filter((b) => b.status === 'confirmed' && b.paid_php < b.amount_php)
  const unverified = nextBookings.filter((b) => b.divers?.certifications?.length && !b.divers.certifications.some((c) => c.verified_at))
  const drafts = next.filter((tr) => tr.status === 'draft')
  const toClose = trips.filter((tr) => tr.status === 'published' && new Date(tr.departs_at) < new Date(Date.now() - 6 * 3600000))
  const noSites = next.filter((tr) => live(tr) && !(tr.trip_sites || []).length)
  const balanceDue = php(balances.reduce((s, b) => s + b.amount_php - b.paid_php, 0))
  const alerts = [
    unpaid.length && [unpaid.length === 1 ? t('{n} reserva pendiente de pagar la señal', { n: 1 }) : t('{n} reservas pendientes de pagar la señal', { n: unpaid.length }), '/centro/agenda'],
    balances.length && [(balances.length === 1 ? t('{n} reserva con resto pendiente ({amount})', { n: 1, amount: balanceDue }) : t('{n} reservas con resto pendiente ({amount})', { n: balances.length, amount: balanceDue })), '/centro/agenda'],
    unverified.length && [unverified.length === 1 ? t('{n} buceador con certificación sin verificar', { n: 1 }) : t('{n} buceadores con certificación sin verificar', { n: unverified.length }), '/centro/agenda'],
    drafts.length && [drafts.length === 1 ? t('{n} salida en borrador sin publicar', { n: 1 }) : t('{n} salidas en borrador sin publicar', { n: drafts.length }), '/centro/salidas'],
    toClose.length && [toClose.length === 1 ? t('{n} salida pasada sin marcar como completada', { n: 1 }) : t('{n} salidas pasadas sin marcar como completadas', { n: toClose.length }), '/centro/salidas'],
    noSites.length && [noSites.length === 1 ? t('{n} salida sin puntos de buceo', { n: 1 }) : t('{n} salidas sin puntos de buceo', { n: noSites.length }), '/centro/salidas'],
  ].filter(Boolean)

  return (
    <>
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 0 }}>{center.name}</h1>
          <p className="muted small" style={{ marginTop: 2 }}>{t('Hoy, {date}', { date: dayLabel(today, { weekday: 'long', day: 'numeric', month: 'long' }) })}</p>
        </div>
        <Link to="/centro/nueva" className="btn small">{t('+ Salida')}</Link>
      </div>
      {error && <div className="msg err">{error}</div>}

      <div className="kpis">
        <div className="kpi"><span>{t('Salidas hoy')}</span><b>{todays.length}</b></div>
        <div className="kpi"><span>{t('Buceadores')}</span><b>{todaySeats.booked}<small>/{todaySeats.op}</small></b></div>
        <div className="kpi"><span>{t('A bordo')}</span><b>{todayChecked}<small>/{todaySeats.booked}</small></b></div>
        <div className="kpi"><span>{t('Cobrado hoy')}</span><b>{php(todayMoney.paid)}</b><small>{t('pendiente {amount}', { amount: php(todayMoney.pending) })}</small></div>
      </div>

      <h2>{t('Salidas de hoy')}</h2>
      {todays.length === 0 && <div className="card muted">{t('No hay salidas hoy.')}</div>}
      {todays.map((tr) => {
        const s = seatsSummary(tr)
        return (
          <Link key={tr.id} to={`/centro/agenda?dia=${today}`} className="card">
            <div className="row between"><b>{time(tr.departs_at)} · {tr.boats?.name}</b><span className="small">{t('{booked}/{op} plazas', { booked: s.booked, op: s.operative })}</span></div>
            <div className="bar" style={{ marginTop: 8 }}><div style={{ width: `${s.operative ? Math.min(100, (s.booked / s.operative) * 100) : 0}%` }} /></div>
            <div className="small muted" style={{ marginTop: 6 }}>{(tr.trip_sites || []).sort((a, b) => a.position - b.position).map((x) => x.dive_sites?.name).join(', ') || t('Sin puntos')}</div>
          </Link>
        )
      })}

      {alerts.length > 0 && (
        <>
          <h2>{t('Pendiente de tu atención')}</h2>
          <div className="card">
            {alerts.map(([text, to]) => (
              <Link key={text} to={to} className="row between alert-row"><span>⚠️ {text}</span><span>›</span></Link>
            ))}
          </div>
        </>
      )}

      <h2>{t('Próximos 7 días')}</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th style={{ paddingLeft: 12 }}>{t('Día')}</th><th>{t('Salidas')}</th><th>{t('Ocupación')}</th><th style={{ textAlign: 'right', paddingRight: 12 }}>{t('Reservado')}</th></tr></thead>
          <tbody>
            {week.map((w) => (
              <tr key={w.d} onClick={() => go(`/centro/agenda?dia=${w.d}`)} style={{ cursor: 'pointer' }}>
                <td style={{ paddingLeft: 12 }}>{w.d === today ? t('Hoy') : dayLabel(w.d)}</td>
                <td>{w.n}</td>
                <td>{w.op ? `${w.booked}/${w.op} · ${Math.round((w.booked / w.op) * 100)} %` : '—'}</td>
                <td style={{ textAlign: 'right', paddingRight: 12 }}>{w.total ? php(w.total) : '—'}</td>
              </tr>
            ))}
            <tr><td style={{ paddingLeft: 12 }}><b>{t('Total')}</b></td><td /><td><b>{weekTotals.booked}</b> {t('buceadores')}</td><td style={{ textAlign: 'right', paddingRight: 12 }}><b>{php(weekTotals.total)}</b><div className="small muted">{t('cobrado {amount}', { amount: php(weekTotals.paid) })}</div></td></tr>
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <Link to="/centro/salidas" className="btn ghost">{t('Gestionar salidas')}</Link>
        <Link to="/centro/ajustes" className="btn ghost">{t('Barcos y datos')}</Link>
      </div>
      <div className="card row between wrap" style={{ marginTop: 12, gap: 8 }}>
        <span className="small">{t('Tu ficha pública: compártela con tus clientes para que reserven en la app.')}</span>
        <div className="row" style={{ gap: 6 }}>
          <Link to={'/c/' + center.id} className="btn small ghost">{t('Ver ficha')}</Link>
          <button className="btn small ghost" onClick={() => {
            const url = window.location.origin + window.location.pathname + '#/c/' + center.id
            if (navigator.share) navigator.share({ title: center.name, url }).catch(() => {})
            else navigator.clipboard?.writeText(url)
          }}>{t('Compartir')}</button>
        </div>
      </div>
    </>
  )
}
