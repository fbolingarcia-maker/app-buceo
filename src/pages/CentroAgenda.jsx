import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { SOURCES, sourceName, levelName, TRIP_STATUS, BOOKING_STATUS, manilaDate, addDays, dayRange, dateTime, dayLabel, time, php } from '../lib/format'
import { seatsSummary, hashParam, TRIP_SELECT } from '../lib/centro'
import { t } from '../lib/i18n'

export default function CentroAgenda() {
  const { center, verified } = useAuth()
  const today = manilaDate()
  const [day, setDay] = useState(() => hashParam('dia') || today)
  const [trips, setTrips] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(null) // id de la acción en curso (evita dobles toques)
  const timer = useRef(null)

  const load = useCallback(async () => {
    const [from, to] = dayRange(day)
    const { data, error } = await supabase.from('trips').select(TRIP_SELECT)
      .eq('center_id', center.id).gte('departs_at', from).lt('departs_at', to).order('departs_at')
    if (error) { setMsg({ ok: false, text: errMsg(error) }); setTrips(false); return }
    setTrips(data || [])
  }, [center.id, day])
  useEffect(() => { setTrips(null); load() }, [load])
  useEffect(() => () => clearTimeout(timer.current), [])

  // Aviso flotante abajo: se ve aunque estés a mitad del manifiesto
  function toast(m) {
    setMsg(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), m.ok ? 3500 : 7000)
  }

  async function run(promise, okText, key = 'x', undo = null) {
    setBusy(key)
    const { error } = await promise
    setBusy(null)
    toast(error ? { ok: false, text: errMsg(error) } : { ok: true, text: okText, undo })
    load()
    return error
  }

  return (
    <>
      <div className="row between">
        <h1>{t('Agenda')}</h1>
        <Link to="/centro/nueva" className="btn small">{t('+ Salida')}</Link>
      </div>
      <div className="days" role="group" aria-label={t('Día')}>
        {Array.from({ length: 17 }, (_, i) => addDays(today, i - 3)).map((d) => (
          <button key={d} type="button" aria-pressed={d === day} className={d === day ? 'day on' : 'day'} onClick={() => setDay(d)}>
            <small>{d === today ? t('Hoy') : dayLabel(d, { weekday: 'short' })}</small><b>{dayLabel(d, { day: 'numeric' })}</b>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>{dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      {trips === null && <p className="muted">{t('Cargando…')}</p>}
      {trips === false && <div className="msg err" role="alert">{t('No se pudo cargar la agenda.')} <button type="button" className="linkish" onClick={() => { setTrips(null); load() }}>{t('Reintentar')}</button></div>}
      {trips?.length === 0 && <div className="card muted center">{t('No hay salidas este día.')} <Link to="/centro/nueva">{t('Crear una')}</Link></div>}
      {trips && trips.map((tr) => <TripCard key={tr.id} t={tr} center={center} verified={verified} run={run} busy={busy} defaultOpen={trips.length === 1} />)}
      {msg && (
        <div className={msg.ok ? 'toast' : 'toast err'} role={msg.ok ? 'status' : 'alert'} aria-live="polite">
          <span>{msg.text}</span>
          {msg.undo && <button type="button" onClick={() => { const u = msg.undo; setMsg(null); u() }}>{t('Deshacer')}</button>}
        </div>
      )}
    </>
  )
}

function TripCard({ t: trip, center, verified, run, busy, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const [manual, setManual] = useState({ guest: '', seats: 1, gear: false, source: 'whatsapp' })
  const s = seatsSummary(trip)
  const sites = (trip.trip_sites || []).sort((a, b) => a.position - b.position).map((x) => x.dive_sites?.name)
  const active = (trip.bookings || []).filter((b) => b.status === 'confirmed' || b.status === 'pending_payment')
  const checked = active.filter((b) => b.checked_in_at).reduce((n, b) => n + b.seats, 0)
  const paidTotal = active.reduce((n, b) => n + (b.paid_php || 0), 0)
  const statusCls = trip.status === 'published' ? 'pill ok' : trip.status === 'draft' ? 'pill warn' : trip.status === 'completed' ? 'pill' : 'pill bad'
  const started = new Date(trip.departs_at) <= new Date()

  function copyList() {
    const lines = active.map((b, i) => `${i + 1}. ${b.divers?.full_name || b.guest_name} · ${b.seats === 1 ? t('{n} plaza', { n: 1 }) : t('{n} plazas', { n: b.seats })}${b.with_gear ? ' · ' + t('equipo') : ''} · ${b.paid_php >= b.amount_php ? t('pagado') : t('falta {amount}', { amount: php(b.amount_php - b.paid_php) })}`)
    const text = `${dateTime(trip.departs_at)} · ${trip.boats?.name}\n${sites.join(', ')}\n\n${lines.join('\n')}`
    navigator.clipboard?.writeText(text).then(() => run(Promise.resolve({}), t('Lista copiada: pégala en WhatsApp')))
  }

  function checkin(b) {
    const on = !b.checked_in_at
    run(supabase.rpc('set_checkin', { p_booking: b.id, p_in: on }), on ? t('Check-in hecho') : t('Check-in deshecho'), 'ci' + b.id,
      () => run(supabase.rpc('set_checkin', { p_booking: b.id, p_in: !on }), on ? t('Check-in deshecho') : t('Check-in hecho'), 'ci' + b.id))
  }

  function saveBlocked(e) {
    const v = Math.max(0, +e.target.value || 0)
    if (v !== trip.blocked_seats) run(supabase.from('trips').update({ blocked_seats: v }).eq('id', trip.id), t('Plazas bloqueadas actualizadas'), 'bl' + trip.id)
  }

  return (
    <div className="card">
      <button type="button" className="row between linkish" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ width: '100%', color: 'inherit', alignItems: 'flex-start' }}>
        <div>
          <div className="big">{time(trip.departs_at)} · {trip.boats?.name}</div>
          <div className="small muted">{t('{n} inm.', { n: trip.num_dives })} · {t('mín. {level}', { level: levelName(trip.min_level) })} · {php(trip.price_php)} · {sites.join(', ') || t('sin puntos')}</div>
        </div>
        <span className="row" style={{ gap: 6 }}><span className={statusCls}>{TRIP_STATUS[trip.status]}</span><span className="small muted" aria-hidden>{open ? '▲' : '▼'}</span></span>
      </button>
      <div className="bar" style={{ marginTop: 10 }}><div style={{ width: `${s.operative ? Math.min(100, (s.booked / s.operative) * 100) : 0}%` }} /></div>
      <div className="row wrap small" style={{ marginTop: 6, gap: 14 }}>
        <span>{t('Ocupadas')} <b>{s.booked}/{s.operative}</b></span>
        <span>{t('App')} <b>{s.app}</b></span>
        <span>{t('Manual')} <b>{s.manual}</b></span>
        <span>{t('Libres en app')} <b>{s.appFree}</b></span>
        <span>{t('Check-in')} <b>{checked}/{s.booked}</b></span>
      </div>

      {open && (
        <>
          <hr />
          <div className="row between">
            <b>{t('Manifiesto')}</b>
            {active.length > 0 && <button type="button" className="btn small ghost" onClick={copyList}>{t('Copiar lista')}</button>}
          </div>
          {active.length === 0 && <p className="muted small">{t('Sin reservas.')}</p>}
          {active.map((b) => (
            <div key={b.id} className="doc-row" style={{ display: 'block' }}>
              <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <b>{b.divers?.full_name || b.guest_name}</b>{b.seats > 1 ? ' ×' + b.seats : ''}
                  <div className="small muted">
                    {sourceName(b.source)} · {BOOKING_STATUS[b.status]}{b.with_gear ? ' · ' + t('equipo') : ''}
                    {b.divers?.logged_dives ? ' · ' + t('{n} inm.', { n: b.divers.logged_dives }) : ''}
                  </div>
                  {b.divers?.certifications?.map((c) => (
                    <div key={c.id} className="small row wrap" style={{ gap: 6 }}>
                      <span>{c.agency} {levelName(c.level)} {c.verified_at ? '✅' : ''}</span>
                      {!c.verified_at && (
                        <button type="button" className="linkish" disabled={busy === 'vc' + c.id}
                          onClick={() => run(supabase.rpc('verify_certification', { p_cert: c.id, p_center: center.id }), t('Certificación verificada'), 'vc' + c.id)}>{t('Verificar')}</button>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <b>{php(b.amount_php)}</b>
                  <div className={b.paid_php >= b.amount_php ? 'small muted' : 'small'} style={b.paid_php >= b.amount_php ? undefined : { color: 'var(--warn)' }}>
                    {b.paid_php >= b.amount_php ? t('Pagado') : t('Falta {amount}', { amount: php(b.amount_php - b.paid_php) })}
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button type="button" className={b.checked_in_at ? 'btn small grow' : 'btn small ghost grow'} aria-pressed={!!b.checked_in_at}
                  disabled={busy === 'ci' + b.id} onClick={() => checkin(b)}>
                  {b.checked_in_at ? '✓ ' + t('A bordo') : t('Check-in')}
                </button>
                {b.paid_php < b.amount_php && (
                  <button type="button" className="btn small ghost grow" disabled={busy === 'ca' + b.id} onClick={() => {
                    if (window.confirm(t('¿Registrar cobro en efectivo de {amount}?', { amount: php(b.amount_php - b.paid_php) })))
                      run(supabase.rpc('record_cash_payment', { p_booking: b.id }), t('Cobro en efectivo registrado'), 'ca' + b.id)
                  }}>{t('Cobrar efectivo')}</button>
                )}
              </div>
            </div>
          ))}

          {trip.status === 'published' && !started && (
            <form style={{ marginTop: 12 }} onSubmit={async (e) => {
              e.preventDefault()
              const err = await run(supabase.rpc('add_manual_booking', { p_trip: trip.id, p_guest: manual.guest, p_seats: manual.seats, p_with_gear: manual.gear, p_source: manual.source }), t('Reserva manual añadida'), 'mb' + trip.id)
              if (!err) setManual({ ...manual, guest: '', seats: 1 })
            }}>
              <div className="row between"><b>{t('Añadir reserva manual')}</b><span className="small muted">{t('{n} libres en el barco', { n: s.boatFree })}</span></div>
              <div className="grid2" style={{ marginTop: 6 }}>
                <input aria-label={t('Nombre del cliente')} placeholder={t('Nombre del cliente')} required value={manual.guest} onChange={(e) => setManual({ ...manual, guest: e.target.value })} />
                <select aria-label={t('Origen')} value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })}>{SOURCES.map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}</select>
                <input aria-label={t('Plazas')} type="number" inputMode="numeric" min="1" max={Math.max(1, s.boatFree)} value={manual.seats} onChange={(e) => setManual({ ...manual, seats: +e.target.value })} />
                <label className="check"><input type="checkbox" checked={manual.gear} onChange={(e) => setManual({ ...manual, gear: e.target.checked })} /> {t('Con equipo')}</label>
              </div>
              <button className="btn small" style={{ marginTop: 8 }} disabled={busy === 'mb' + trip.id || s.boatFree < 1}>{t('Añadir')}</button>
            </form>
          )}

          <hr />
          <div className="row wrap">
            <Link to={'/centro/salida/' + trip.id} className="btn small ghost">{t('Editar salida')}</Link>
            {trip.status === 'draft' && verified && (
              <button type="button" className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'published' }).eq('id', trip.id), t('Salida publicada'))}>{t('Publicar')}</button>
            )}
            {trip.status === 'draft' && !verified && <span className="small muted">{t('Podrás publicarla cuando tu centro esté verificado.')}</span>}
            {trip.status === 'published' && started && (
              <button type="button" className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'completed' }).eq('id', trip.id), t('Salida marcada como completada'))}>{t('Marcar completada')}</button>
            )}
            {trip.status === 'published' && !started && (
              <>
                <label className="small row">{t('Bloquear plazas:')}
                  <input type="number" inputMode="numeric" min="0" style={{ width: 70 }} defaultValue={trip.blocked_seats}
                    onBlur={saveBlocked} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} />
                </label>
                <button type="button" className="btn small danger" onClick={() => {
                  const txt = active.length
                    ? t('¿Cancelar la salida de las {time} por meteo? Se cancelan {n} reservas y se devuelven {amount}.', { time: time(trip.departs_at), n: active.length, amount: php(paidTotal) })
                    : t('¿Cancelar la salida de las {time} por meteo?', { time: time(trip.departs_at) })
                  if (window.confirm(txt)) run(supabase.rpc('cancel_trip_weather', { p_trip: trip.id }), t('Salida cancelada por meteo. Reembolsos generados.'))
                }}>{t('Cancelar por meteo')}</button>
              </>
            )}
          </div>
          <p className="small muted">{trip.guides === 1
            ? t('Salida: {date} · {guides} guía × {n} buceadores', { date: dateTime(trip.departs_at), guides: trip.guides, n: trip.divers_per_guide })
            : t('Salida: {date} · {guides} guías × {n} buceadores', { date: dateTime(trip.departs_at), guides: trip.guides, n: trip.divers_per_guide })}</p>
        </>
      )}
    </div>
  )
}
