import { useEffect, useMemo, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { levelName, levelRank, sourceName, manilaDate, addDays, dayLabel, dateTime, time, php } from '../lib/format'
import { seatsSummary, holds, hashParam, TRIP_SELECT } from '../lib/centro'
import { downloadCsv } from '../lib/csv'
import { t } from '../lib/i18n'
import { norm } from '../lib/geo'
import Icon from '../lib/Icon'
import { Mail, MessageCircle } from 'lucide-react'
import { langName } from '../lib/langs'

const dayOf = (iso) => manilaDate(new Date(iso))
const iso = (ymd) => new Date(ymd + 'T00:00:00+08:00').toISOString()
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const firstOfMonth = (ymd, add = 0) => {
  const [y, m] = ymd.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + add, 1))
  return d.toISOString().slice(0, 10)
}
const isLive = (b) => b.status === 'confirmed' || holds(b)
const isCancelled = (b) => b.status === 'cancelled_by_diver' || b.status === 'cancelled_by_center'
const clientName = (b) => b.divers?.full_name || b.guest_name || t('Sin nombre')
const KINDS = { deposit: 'Señal', full: 'Total', balance: 'Resto' }
const METHODS = { cash: 'Efectivo', card: 'Tarjeta', gcash: 'GCash', demo: 'Demo' }
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

function periodRange(p, today) {
  if (p === 'last') return [firstOfMonth(today, -1), firstOfMonth(today)]
  if (p === '30') return [addDays(today, -29), addDays(today, 1)]
  if (p === 'year') return [today.slice(0, 4) + '-01-01', (+today.slice(0, 4) + 1) + '-01-01']
  if (p === 'next') return [today, addDays(today, 30)]
  return [firstOfMonth(today), firstOfMonth(today, 1)]
}
const PERIODS = [['month', 'Este mes'], ['last', 'Mes pasado'], ['30', 'Últimos 30 días'], ['next', 'Próximos 30 días'], ['year', 'Este año']]
const VIEWS = [['resumen', 'Resumen'], ['cobros', 'Cobros pendientes'], ['clientes', 'Clientes'], ['movimientos', 'Movimientos']]

export default function CentroInformes() {
  const [view, setView] = useState(() => hashParam('ver') || 'resumen')
  const pick = (v) => { setView(v); go('/centro/informes?ver=' + v) }
  return (
    <>
      <h1>{t('Informes y seguimiento')}</h1>
      <div className="seg">
        {VIEWS.map(([k, n]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => pick(k)}>{t(n)}</button>)}
      </div>
      {view === 'resumen' && <Resumen onPick={pick} />}
      {view === 'cobros' && <Cobros />}
      {view === 'clientes' && <Clientes />}
      {view === 'movimientos' && <Movimientos />}
    </>
  )
}

function PeriodPicker({ value, onChange, options = PERIODS }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto', marginBottom: 12 }} aria-label={t('Periodo')}>
      {options.map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}
    </select>
  )
}

// ---------- Resumen del periodo ----------
function Resumen({ onPick }) {
  const { center } = useAuth()
  const today = manilaDate()
  const [period, setPeriod] = useState('month')
  const [trips, setTrips] = useState(null)
  const [pays, setPays] = useState([])
  const [error, setError] = useState('')
  const [from, to] = periodRange(period, today)

  useEffect(() => {
    setTrips(null)
    supabase.from('trips').select(TRIP_SELECT).eq('center_id', center.id).neq('status', 'draft')
      .gte('departs_at', iso(from)).lt('departs_at', iso(to)).order('departs_at')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setTrips(data || []) })
    supabase.from('payments').select('amount_php, method, kind, paid_at').eq('status', 'paid')
      .gte('paid_at', iso(from)).lt('paid_at', iso(to))
      .then(({ data }) => setPays(data || []))
  }, [center.id, from, to])

  const r = useMemo(() => {
    if (!trips) return null
    const active = trips.filter((tr) => tr.status !== 'cancelled_weather')
    const now = Date.now()
    const all = trips.flatMap((tr) => (tr.bookings || []).map((b) => ({ ...b, trip: tr })))
    const live = all.filter((b) => b.trip.status !== 'cancelled_weather' && isLive(b))
    const cancelled = all.filter((b) => isCancelled(b) || (b.trip.status === 'cancelled_weather' && b.status !== 'pending_payment'))
    const seats = active.reduce((a, tr) => { const s = seatsSummary(tr); return { booked: a.booked + s.booked, op: a.op + s.operative } }, { booked: 0, op: 0 })
    const total = live.reduce((s, b) => s + b.amount_php, 0)
    const paid = live.reduce((s, b) => s + (b.paid_php || 0), 0)
    const commission = live.filter((b) => b.status === 'confirmed').reduce((s, b) => s + (b.commission_php || 0), 0)
    const refunds = all.reduce((s, b) => s + (b.refund_php || 0), 0)
    const bySource = {}
    for (const b of live) bySource[b.source] = (bySource[b.source] || 0) + b.seats
    const sites = {}
    for (const tr of active) for (const x of tr.trip_sites || []) if (x.dive_sites?.name) sites[x.dive_sites.name] = (sites[x.dive_sites.name] || 0) + 1
    const wd = WEEKDAYS.map(() => ({ booked: 0, op: 0, n: 0 }))
    for (const tr of active) {
      const i = (new Date(dayOf(tr.departs_at) + 'T12:00:00Z').getUTCDay() + 6) % 7
      const s = seatsSummary(tr); wd[i].booked += s.booked; wd[i].op += s.operative; wd[i].n++
    }
    const hours = {}
    for (const tr of active) { const h = time(tr.departs_at); const s = seatsSummary(tr); hours[h] = hours[h] || { booked: 0, op: 0, n: 0 }; hours[h].booked += s.booked; hours[h].op += s.operative; hours[h].n++ }
    const divers = new Set(live.map((b) => b.diver_id || 'g:' + clientName(b)))
    const byMethod = {}
    for (const p of pays) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount_php
    return {
      done: active.filter((tr) => new Date(tr.departs_at).getTime() < now).length,
      upcoming: active.filter((tr) => new Date(tr.departs_at).getTime() >= now).length,
      weather: trips.length - active.length,
      seats, total, paid, pending: total - paid, commission, refunds,
      cancelled: cancelled.length, cancelledSeats: cancelled.reduce((s, b) => s + b.seats, 0),
      bySource, sites: Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 8), wd,
      hours: Object.entries(hours).sort((a, b) => a[0].localeCompare(b[0])), clients: divers.size,
      byMethod, cashIn: pays.reduce((s, p) => s + p.amount_php, 0), live,
    }
  }, [trips, pays])

  function exportBookings() {
    downloadCsv('divingslot-reservas-' + from + '.csv',
      [t('Fecha'), t('Hora'), t('Cliente'), t('Plazas'), t('Estado'), t('Origen'), t('Importe'), t('Pagado'), t('Pendiente'), t('A bordo')],
      trips.flatMap((tr) => (tr.bookings || []).map((b) => [
        dayOf(tr.departs_at), time(tr.departs_at), clientName(b), b.seats, b.status, b.source, b.amount_php, b.paid_php || 0,
        isLive(b) ? b.amount_php - (b.paid_php || 0) : 0, b.checked_in_at ? 'sí' : '',
      ])))
  }

  return (
    <>
      <div className="row between wrap" style={{ gap: 8 }}>
        <PeriodPicker value={period} onChange={setPeriod} />
        {trips?.length > 0 && <button className="btn small ghost" style={{ marginBottom: 12 }} onClick={exportBookings}>{t('Exportar reservas (CSV)')}</button>}
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>{dayLabel(from, { day: 'numeric', month: 'short', year: 'numeric' })} – {dayLabel(addDays(to, -1), { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      {error && <div className="msg err" role="alert">{error}</div>}
      {!r ? <p className="muted">{t('Cargando…')}</p> : (
        <>
          <div className="kpis">
            <div className="kpi"><span>{t('Salidas')}</span><b>{r.done + r.upcoming}</b><small>{t('{a} hechas · {b} próximas', { a: r.done, b: r.upcoming })}</small></div>
            <div className="kpi"><span>{t('Buceadores')}</span><b>{r.seats.booked}</b><small>{t('{n} clientes distintos', { n: r.clients })}</small></div>
            <div className="kpi"><span>{t('Ocupación')}</span><b>{pct(r.seats.booked, r.seats.op)} %</b><small>{r.seats.booked}/{r.seats.op}</small></div>
            <div className="kpi"><span>{t('Facturado')}</span><b>{php(r.total)}</b><small>{t('pendiente {amount}', { amount: php(r.pending) })}</small></div>
          </div>

          <div className="card stack small">
            <div className="row between"><span className="muted">{t('Cobrado de estas salidas')}</span><b>{php(r.paid)}</b></div>
            <div className="row between"><span className="muted">{t('Pendiente de cobrar')}</span><b style={{ color: r.pending ? 'var(--warn)' : undefined }}>{php(r.pending)}</b></div>
            {r.commission > 0 && <div className="row between"><span className="muted">{t('Comisión DivingSlot')}</span><span>{php(r.commission)}</span></div>}
            <div className="row between"><span className="muted">{t('Cancelaciones')}</span><span>{r.cancelled === 1 ? t('1 reserva') : t('{n} reservas', { n: r.cancelled })} · {t('{n} plazas', { n: r.cancelledSeats })}</span></div>
            {r.refunds > 0 && <div className="row between"><span className="muted">{t('Reembolsos')}</span><span>{php(r.refunds)}</span></div>}
            {r.weather > 0 && <div className="row between"><span className="muted">{t('Salidas canceladas por meteo')}</span><span>{r.weather}</span></div>}
          </div>

          <h2>{t('Dinero recibido en el periodo')}</h2>
          <div className="card stack small">
            {Object.keys(r.byMethod).length === 0 && <span className="muted">{t('Sin cobros en este periodo.')}</span>}
            {Object.entries(r.byMethod).map(([m, v]) => (
              <div key={m} className="row between"><span>{t(METHODS[m] || m)}</span><b>{php(v)}</b></div>
            ))}
            {Object.keys(r.byMethod).length > 1 && <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}><span>{t('Total')}</span><b>{php(r.cashIn)}</b></div>}
            <button type="button" className="linkish small" onClick={() => onPick('movimientos')}>{t('Ver todos los movimientos')} ›</button>
          </div>

          <h2>{t('De dónde vienen las reservas')}</h2>
          <div className="card stack small">
            {Object.keys(r.bySource).length === 0 && <span className="muted">{t('Sin reservas en este periodo.')}</span>}
            {Object.entries(r.bySource).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
              <div key={s}>
                <div className="row between"><span>{sourceName(s)}</span><span>{t('{n} plazas', { n })} · {pct(n, r.seats.booked)} %</span></div>
                <div className="bar" style={{ marginTop: 4 }}><div style={{ width: pct(n, r.seats.booked) + '%' }} /></div>
              </div>
            ))}
          </div>

          <h2>{t('Ocupación por día de la semana')}</h2>
          <div className="card stack small">
            {r.wd.map((w, i) => (
              <div key={i} className="row" style={{ gap: 10, alignItems: 'center' }}>
                <span style={{ width: 34 }}>{t(WEEKDAYS[i])}</span>
                <div className="bar grow"><div style={{ width: pct(w.booked, w.op) + '%' }} /></div>
                <span className="muted" style={{ width: 92, textAlign: 'right' }}>{w.op ? pct(w.booked, w.op) + ' % · ' + (w.n === 1 ? t('1 salida') : t('{n} salidas', { n: w.n })) : '—'}</span>
              </div>
            ))}
          </div>

          {r.hours.length > 0 && (
            <>
              <h2>{t('Ocupación por horario')}</h2>
              <div className="card stack small">
                {r.hours.map(([h, w]) => (
                  <div key={h} className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <span style={{ width: 44 }}>{h}</span>
                    <div className="bar grow"><div style={{ width: pct(w.booked, w.op) + '%' }} /></div>
                    <span className="muted" style={{ width: 92, textAlign: 'right' }}>{pct(w.booked, w.op)} % · {w.n === 1 ? t('1 salida') : t('{n} salidas', { n: w.n })}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {r.sites.length > 0 && (
            <>
              <h2>{t('Puntos de buceo más usados')}</h2>
              <div className="card stack small">
                {r.sites.map(([s, n]) => <div key={s} className="row between"><span>{s}</span><span className="muted">{n === 1 ? t('1 salida') : t('{n} salidas', { n })}</span></div>)}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

// ---------- Cobros pendientes ----------
function Cobros() {
  const { center } = useAuth()
  const today = manilaDate()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.from('trips').select(TRIP_SELECT).eq('center_id', center.id).in('status', ['published', 'completed'])
      .gte('departs_at', iso(addDays(today, -90))).lt('departs_at', iso(addDays(today, 120))).order('departs_at')
      .then(({ data, error }) => {
        if (error) setError(errMsg(error))
        setRows((data || []).flatMap((tr) => (tr.bookings || []).filter((b) => isLive(b) && (b.paid_php || 0) < b.amount_php).map((b) => ({ ...b, trip: tr }))))
      })
  }, [center.id, today])
  if (!rows) return <p className="muted">{error || t('Cargando…')}</p>
  const past = rows.filter((b) => dayOf(b.trip.departs_at) < today)
  const coming = rows.filter((b) => dayOf(b.trip.departs_at) >= today)
  const sum = (l) => l.reduce((s, b) => s + b.amount_php - (b.paid_php || 0), 0)
  const List = ({ list }) => list.map((b) => (
    <Link key={b.id} to={'/centro/agenda?dia=' + dayOf(b.trip.departs_at)} className="card">
      <div className="row between" style={{ gap: 8 }}>
        <b>{clientName(b)}{b.seats > 1 ? ' ×' + b.seats : ''}</b>
        <b style={{ color: 'var(--warn)' }}>{php(b.amount_php - (b.paid_php || 0))}</b>
      </div>
      <div className="row between small" style={{ gap: 8, marginTop: 2 }}>
        <span className="muted">{dateTime(b.trip.departs_at)} · {sourceName(b.source)}</span>
        <span className={b.status === 'pending_payment' ? 'pill warn' : 'pill'}>{b.status === 'pending_payment' ? t('Señal sin pagar') : t('Pagado {paid} de {total}', { paid: php(b.paid_php || 0), total: php(b.amount_php) })}</span>
      </div>
    </Link>
  ))
  return (
    <>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="kpis">
        <div className="kpi"><span>{t('Por cobrar (próximas)')}</span><b>{php(sum(coming))}</b><small>{coming.length === 1 ? t('1 reserva') : t('{n} reservas', { n: coming.length })}</small></div>
        <div className="kpi"><span>{t('Atrasado (salidas pasadas)')}</span><b style={{ color: past.length ? 'var(--bad)' : undefined }}>{php(sum(past))}</b><small>{past.length === 1 ? t('1 reserva') : t('{n} reservas', { n: past.length })}</small></div>
      </div>
      {rows.length === 0 && <div className="card center muted">{t('Todo cobrado. ¡Bien!')}</div>}
      {past.length > 0 && <><h2>{t('Salidas pasadas con dinero pendiente')}</h2><List list={past} /></>}
      {coming.length > 0 && <><h2>{t('Próximas salidas')}</h2><List list={coming} /></>}
      <p className="small muted">{t('Pulsa una reserva para ir a la agenda de ese día y registrar el cobro.')}</p>
    </>
  )
}

// ---------- Clientes ----------
function Clientes() {
  const { center } = useAuth()
  const today = manilaDate()
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('recent')
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.from('bookings')
      .select('id, seats, status, amount_php, paid_php, source, guest_name, diver_id, created_at, checked_in_at, divers(full_name, email, country, logged_dives, languages, certifications(level, agency, verified_at)), trips!inner(id, departs_at, center_id, status)')
      .eq('trips.center_id', center.id).order('created_at', { ascending: false }).limit(3000)
      .then(({ data, error }) => {
        if (error) setError(errMsg(error))
        const m = {}
        for (const b of data || []) {
          const key = b.diver_id || 'g:' + norm(b.guest_name || '')
          const c = m[key] || (m[key] = { key, name: clientName(b), diver: b.divers, bookings: [], spent: 0, seats: 0, trips: new Set(), sources: new Set(), last: null, next: null, cancelled: 0 })
          c.bookings.push(b)
          if (isCancelled(b)) { c.cancelled++; continue }
          if (!isLive(b) || b.trips.status === 'cancelled_weather') continue
          c.spent += b.paid_php || 0; c.seats += b.seats; c.trips.add(b.trips.id); c.sources.add(b.source)
          const d = dayOf(b.trips.departs_at)
          if (d < today) { if (!c.last || d > c.last) c.last = d } else if (!c.next || d < c.next) c.next = d
        }
        setList(Object.values(m).filter((c) => c.trips.size || c.cancelled))
      })
  }, [center.id, today])
  if (!list) return <p className="muted">{error || t('Cargando…')}</p>
  const level = (c) => {
    const certs = c.diver?.certifications || []
    const best = certs.sort((a, b) => levelRank(b.level) - levelRank(a.level))[0]
    return best ? { name: levelName(best.level), verified: certs.some((x) => x.verified_at) } : null
  }
  const w = norm(q).trim()
  let shown = list.filter((c) => !w || norm([c.name, c.diver?.email, c.diver?.country].join(' ')).includes(w))
  shown = [...shown].sort((a, b) => sort === 'spent' ? b.spent - a.spent : sort === 'trips' ? b.trips.size - a.trips.size : sort === 'name' ? a.name.localeCompare(b.name) : (b.next || b.last || '').localeCompare(a.next || a.last || ''))
  const repeat = list.filter((c) => c.trips.size > 1).length
  function exportClients() {
    downloadCsv('divingslot-clientes.csv', [t('Nombre'), 'Email', t('País'), t('Nivel'), t('Salidas'), t('Plazas'), t('Pagado'), t('Última salida'), t('Próxima salida'), t('Origen')],
      shown.map((c) => [c.name, c.diver?.email || '', c.diver?.country || '', level(c)?.name || '', c.trips.size, c.seats, c.spent, c.last || '', c.next || '', [...c.sources].join(' ')]))
  }
  return (
    <>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="kpis">
        <div className="kpi"><span>{t('Clientes')}</span><b>{list.length}</b></div>
        <div className="kpi"><span>{t('Repiten')}</span><b>{repeat}</b><small>{pct(repeat, list.length)} %</small></div>
      </div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <input type="search" className="grow" placeholder={t('Buscar por nombre, email o país…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }} aria-label={t('Ordenar')}>
          <option value="recent">{t('Ordenar: recientes')}</option>
          <option value="trips">{t('Ordenar: más salidas')}</option>
          <option value="spent">{t('Ordenar: más gasto')}</option>
          <option value="name">{t('Ordenar: nombre')}</option>
        </select>
        {shown.length > 0 && <button className="btn small ghost" onClick={exportClients}>{t('Exportar CSV')}</button>}
      </div>
      {shown.length === 0 && <div className="card center muted">{list.length ? t('Ningún cliente coincide con tu búsqueda.') : t('Aún no tienes clientes. Aparecerán aquí cuando reserven.')}</div>}
      {shown.map((c) => {
        const lv = level(c)
        return (
          <div key={c.key} className="card">
            <button type="button" className="center-head" style={{ padding: 0 }} onClick={() => setOpen(open === c.key ? null : c.key)}>
              <div className="row between" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 10, minWidth: 0 }}>
                  <div className="avatar" aria-hidden="true">{c.name.charAt(0).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <b>{c.name}</b>
                    <div className="small muted">{[lv ? lv.name + (lv.verified ? ' ✓' : '') : (c.diver ? t('Sin certificación') : t('Reserva manual')), c.diver?.country, c.diver?.logged_dives ? t('{n} inmersiones', { n: c.diver.logged_dives }) : null].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <b>{php(c.spent)}</b>
                  <div className="small muted">{c.trips.size === 1 ? t('1 salida') : t('{n} salidas', { n: c.trips.size })}</div>
                </div>
              </div>
              <div className="row wrap small" style={{ gap: 6, marginTop: 8 }}>
                {c.next && <span className="pill ok">{t('Próxima: {d}', { d: dayLabel(c.next) })}</span>}
                {c.last && <span className="pill">{t('Última: {d}', { d: dayLabel(c.last) })}</span>}
                {c.trips.size > 1 && <span className="pill">{t('Repite')}</span>}
                {c.cancelled > 0 && <span className="pill warn">{c.cancelled === 1 ? t('1 cancelación') : t('{n} cancelaciones', { n: c.cancelled })}</span>}
              </div>
            </button>
            {open === c.key && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                {c.diver?.email && <div className="small" style={{ marginBottom: 6 }}><Icon icon={Mail} size={14} /> <a href={'mailto:' + c.diver.email}>{c.diver.email}</a></div>}
                {c.diver?.languages?.length > 0 && <div className="small muted" style={{ marginBottom: 6 }}><Icon icon={MessageCircle} size={14} /> {[].concat(c.diver.languages).map(langName).join(', ')}</div>}
                {c.bookings.map((b) => (
                  <Link key={b.id} to={'/centro/agenda?dia=' + dayOf(b.trips.departs_at)} className="row between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', color: 'inherit', textDecoration: 'none', gap: 8 }}>
                    <span>{dateTime(b.trips.departs_at)}{b.seats > 1 ? ' · ×' + b.seats : ''}</span>
                    <span className="muted">{isCancelled(b) ? t('Cancelada') : b.status === 'pending_payment' ? t('Sin pagar') : php(b.paid_php || 0) + ' / ' + php(b.amount_php)}{b.checked_in_at ? ' · ✅' : ''}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// ---------- Movimientos (cobros registrados) ----------
function Movimientos() {
  const today = manilaDate()
  const [period, setPeriod] = useState('month')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [from, to] = periodRange(period, today)
  useEffect(() => {
    setRows(null)
    supabase.from('payments').select('id, kind, method, amount_php, paid_at, bookings(guest_name, seats, divers(full_name), trips(departs_at))')
      .eq('status', 'paid').gte('paid_at', iso(from)).lt('paid_at', iso(to)).order('paid_at', { ascending: false })
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setRows(data || []) })
  }, [from, to])
  const total = (rows || []).reduce((s, p) => s + p.amount_php, 0)
  const name = (p) => p.bookings?.divers?.full_name || p.bookings?.guest_name || '—'
  return (
    <>
      <div className="row between wrap" style={{ gap: 8 }}>
        <PeriodPicker value={period} onChange={setPeriod} options={PERIODS.filter(([k]) => k !== 'next')} />
        {rows?.length > 0 && (
          <button className="btn small ghost" style={{ marginBottom: 12 }} onClick={() => downloadCsv('divingslot-cobros-' + from + '.csv',
            [t('Fecha del cobro'), t('Cliente'), t('Concepto'), t('Método'), t('Importe'), t('Salida')],
            rows.map((p) => [dateTime(p.paid_at), name(p), t(KINDS[p.kind] || p.kind), t(METHODS[p.method] || p.method), p.amount_php, p.bookings?.trips ? dateTime(p.bookings.trips.departs_at) : '']))}>
            {t('Exportar CSV')}
          </button>
        )}
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      {!rows ? <p className="muted">{t('Cargando…')}</p> : (
        <>
          <div className="kpis">
            <div className="kpi"><span>{t('Cobrado')}</span><b>{php(total)}</b><small>{rows.length === 1 ? t('1 cobro') : t('{n} cobros', { n: rows.length })}</small></div>
          </div>
          {rows.length === 0 && <div className="card center muted">{t('Sin cobros en este periodo.')}</div>}
          {rows.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead><tr><th style={{ paddingLeft: 12 }}>{t('Fecha')}</th><th>{t('Cliente')}</th><th>{t('Concepto')}</th><th style={{ textAlign: 'right', paddingRight: 12 }}>{t('Importe')}</th></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td style={{ paddingLeft: 12 }} className="small">{dateTime(p.paid_at)}</td>
                      <td>{name(p)}</td>
                      <td className="small">{t(KINDS[p.kind] || p.kind)} · {t(METHODS[p.method] || p.method)}</td>
                      <td style={{ textAlign: 'right', paddingRight: 12 }}><b>{php(p.amount_php)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
