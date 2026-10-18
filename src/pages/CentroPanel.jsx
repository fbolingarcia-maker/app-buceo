import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { manilaDate, addDays, dayLabel, time, php, sourceName } from '../lib/format'
import { seatsSummary, money, holds, TRIP_SELECT } from '../lib/centro'
import { t } from '../lib/i18n'

const dayOf = (iso) => manilaDate(new Date(iso))

export default function CentroPanel() {
  const { center } = useAuth()
  const today = manilaDate()
  const [trips, setTrips] = useState(null)
  const [error, setError] = useState('')
  const [boats, setBoats] = useState(null)
  const [anyTrip, setAnyTrip] = useState(null)
  const [copied, setCopied] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setError('')
    const from = new Date(addDays(today, -7) + 'T00:00:00+08:00').toISOString()
    const to = new Date(addDays(today, 8) + 'T00:00:00+08:00').toISOString()
    supabase.from('trips').select(TRIP_SELECT).eq('center_id', center.id)
      .gte('departs_at', from).lt('departs_at', to).order('departs_at')
      .then(({ data, error }) => { if (error) { setError(errMsg(error)); setTrips(false) } else setTrips(data || []) })
    // Para la guía de primeros pasos
    supabase.from('boats').select('id', { count: 'exact', head: true }).eq('center_id', center.id).then(({ count }) => setBoats(count ?? 0))
    supabase.from('trips').select('id', { count: 'exact', head: true }).eq('center_id', center.id).then(({ count }) => setAnyTrip(count ?? 0))
  }, [center.id, today, reload])

  if (trips === false) return (
    <div className="msg err" role="alert">{error} <button type="button" className="linkish" onClick={() => { setTrips(null); setReload((n) => n + 1) }}>{t('Reintentar')}</button></div>
  )
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
  const recent = trips.flatMap((tr) => (tr.bookings || []).map((b) => ({ ...b, trip: tr })))
    .filter((b) => Date.now() - new Date(b.created_at).getTime() < 3 * 86400000)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)
  const balanceDue = php(balances.reduce((s, b) => s + b.amount_php - b.paid_php, 0))
  const alerts = [
    unpaid.length && [unpaid.length === 1 ? t('{n} reserva pendiente de pagar la señal', { n: 1 }) : t('{n} reservas pendientes de pagar la señal', { n: unpaid.length }), '/centro/informes?ver=cobros'],
    balances.length && [(balances.length === 1 ? t('{n} reserva con resto pendiente ({amount})', { n: 1, amount: balanceDue }) : t('{n} reservas con resto pendiente ({amount})', { n: balances.length, amount: balanceDue })), '/centro/informes?ver=cobros'],
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
      {error && <div className="msg err" role="alert">{error}</div>}

      <FirstSteps center={center} boats={boats} anyTrip={anyTrip} />

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

      {recent.length > 0 && (
        <>
          <h2>{t('Últimas reservas')}</h2>
          <div className="card">
            {recent.map((b) => (
              <Link key={b.id} to={'/centro/agenda?dia=' + dayOf(b.trip.departs_at)} className="row between alert-row" style={{ gap: 8 }}>
                <span style={{ minWidth: 0 }}>
                  <b>{b.divers?.full_name || b.guest_name || t('Sin nombre')}</b>{b.seats > 1 ? ' ×' + b.seats : ''}
                  <span className="small muted"> · {dayLabel(dayOf(b.trip.departs_at))} {time(b.trip.departs_at)} · {sourceName(b.source)}</span>
                </span>
                <span className={b.status === 'confirmed' ? 'pill ok' : b.status === 'pending_payment' ? 'pill warn' : 'pill bad'} style={{ whiteSpace: 'nowrap' }}>
                  {b.status === 'confirmed' ? t('Confirmada') : b.status === 'pending_payment' ? t('Sin pagar') : t('Cancelada')}
                </span>
              </Link>
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
                <td style={{ paddingLeft: 12 }}><Link to={`/centro/agenda?dia=${w.d}`} style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}>{w.d === today ? t('Hoy') : dayLabel(w.d)}</Link></td>
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
        <Link to="/centro/informes" className="btn ghost">{t('Informes y clientes')}</Link>
      </div>
      <div className="card row between wrap" style={{ marginTop: 12, gap: 8 }}>
        <span className="small">{t('Tu ficha pública: compártela con tus clientes para que reserven en la app.')}</span>
        <div className="row" style={{ gap: 6 }}>
          <Link to={'/c/' + center.id} className="btn small ghost">{t('Ver ficha')}</Link>
          <button className="btn small ghost" onClick={() => {
            const url = window.location.origin + window.location.pathname + '#/c/' + center.id
            if (navigator.share) navigator.share({ title: center.name, url }).catch(() => {})
            else navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000) })
          }}>{copied ? t('Enlace copiado') : t('Compartir')}</button>
        </div>
      </div>
    </>
  )
}

// Guía para un centro nuevo: qué le falta para empezar a recibir reservas
function FirstSteps({ center, boats, anyTrip }) {
  if (boats === null || anyTrip === null) return null
  const steps = [
    [center.verification_status === 'verified', t('Verifica tu centro'), '/centro/verificacion'],
    [boats > 0, t('Añade tu primer barco'), '/centro/ajustes'],
    [center.lat != null, t('Marca la ubicación del centro'), '/centro/ajustes'],
    [(center.languages || []).length > 0, t('Indica idiomas y agencias'), '/centro/ajustes'],
    [anyTrip > 0, t('Crea tu primera salida'), '/centro/nueva'],
  ]
  const done = steps.filter((s) => s[0]).length
  if (done === steps.length) return null
  return (
    <div className="card stack">
      <div className="row between"><b>{t('Primeros pasos')}</b><span className="small muted">{t('{a} de {b}', { a: done, b: steps.length })}</span></div>
      <div className="bar"><div style={{ width: (done / steps.length) * 100 + '%' }} /></div>
      <ul className="steps">
        {steps.map(([ok, label, to], i) => (
          <li key={label} className={ok ? 'done' : steps.findIndex((s) => !s[0]) === i ? 'now' : ''}>
            <span className="dot">{ok ? '✓' : i + 1}</span>
            {ok ? <span className="muted">{label}</span> : <Link to={to}>{label}</Link>}
          </li>
        ))}
      </ul>
    </div>
  )
}
