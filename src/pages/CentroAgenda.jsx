import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { SOURCES, sourceName, levelName, TRIP_STATUS, BOOKING_STATUS, manilaDate, addDays, dayRange, dateTime, dayLabel, time, php } from '../lib/format'
import { seatsSummary, hashParam, TRIP_SELECT } from '../lib/centro'
import { t } from '../lib/i18n'

export default function CentroAgenda() {
  const { center } = useAuth()
  const today = manilaDate()
  const [day, setDay] = useState(() => hashParam('dia') || today)
  const [trips, setTrips] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const [from, to] = dayRange(day)
    const { data, error } = await supabase.from('trips').select(TRIP_SELECT)
      .eq('center_id', center.id).gte('departs_at', from).lt('departs_at', to).order('departs_at')
    if (error) setMsg({ ok: false, text: errMsg(error) })
    setTrips(data || [])
  }, [center.id, day])
  useEffect(() => { setTrips(null); load() }, [load])

  async function run(promise, okText) {
    const { error } = await promise
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: okText })
    load()
  }

  return (
    <>
      <div className="row between">
        <h1>{t('Agenda')}</h1>
        <Link to="/centro/nueva" className="btn small">{t('+ Salida')}</Link>
      </div>
      <div className="days">
        {Array.from({ length: 17 }, (_, i) => addDays(today, i - 3)).map((d) => (
          <button key={d} className={d === day ? 'day on' : 'day'} onClick={() => setDay(d)}>
            <small>{d === today ? t('Hoy') : dayLabel(d, { weekday: 'short' })}</small><b>{dayLabel(d, { day: 'numeric' })}</b>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: -4 }}>{dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      {trips === null && <p className="muted">{t('Cargando…')}</p>}
      {trips?.length === 0 && <div className="card muted center">{t('No hay salidas este día.')} <Link to="/centro/nueva">{t('Crear una')}</Link></div>}
      {trips?.map((tr) => <TripCard key={tr.id} t={tr} center={center} run={run} defaultOpen={trips.length === 1} />)}
    </>
  )
}

function TripCard({ t: trip, center, run, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const [manual, setManual] = useState({ guest: '', seats: 1, gear: false, source: 'whatsapp' })
  const s = seatsSummary(trip)
  const sites = (trip.trip_sites || []).sort((a, b) => a.position - b.position).map((x) => x.dive_sites?.name)
  const active = (trip.bookings || []).filter((b) => b.status === 'confirmed' || b.status === 'pending_payment')
  const checked = active.filter((b) => b.checked_in_at).reduce((n, b) => n + b.seats, 0)
  const statusCls = trip.status === 'published' ? 'pill ok' : trip.status === 'draft' ? 'pill warn' : trip.status === 'completed' ? 'pill' : 'pill bad'
  const started = new Date(trip.departs_at) <= new Date()

  function copyList() {
    const lines = active.map((b, i) => `${i + 1}. ${b.divers?.full_name || b.guest_name} · ${b.seats === 1 ? t('{n} plaza', { n: 1 }) : t('{n} plazas', { n: b.seats })}${b.with_gear ? ' · ' + t('equipo') : ''} · ${b.paid_php >= b.amount_php ? t('pagado') : t('falta {amount}', { amount: php(b.amount_php - b.paid_php) })}`)
    const text = `${dateTime(trip.departs_at)} · ${trip.boats?.name}\n${sites.join(', ')}\n\n${lines.join('\n')}`
    navigator.clipboard?.writeText(text).then(() => run(Promise.resolve({}), t('Lista copiada: pégala en WhatsApp')))
  }

  return (
    <div className="card">
      <div className="row between" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <div>
          <div className="big">{time(trip.departs_at)} · {trip.boats?.name}</div>
          <div className="small muted">{t('{n} inm.', { n: trip.num_dives })} · {t('mín. {level}', { level: levelName(trip.min_level) })} · {php(trip.price_php)} · {sites.join(', ') || t('sin puntos')}</div>
        </div>
        <span className={statusCls}>{TRIP_STATUS[trip.status]}</span>
      </div>
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
            {active.length > 0 && <button className="btn small ghost" onClick={copyList}>{t('Copiar lista')}</button>}
          </div>
          {active.length === 0 && <p className="muted small">{t('Sin reservas.')}</p>}
          <table><tbody>
            {active.map((b) => (
              <tr key={b.id}>
                <td>
                  <b>{b.divers?.full_name || b.guest_name}</b>
                  <div className="small muted">
                    {sourceName(b.source)} · {BOOKING_STATUS[b.status]}{b.with_gear ? ' · ' + t('equipo') : ''}
                    {b.divers?.logged_dives ? ' · ' + t('{n} inm.', { n: b.divers.logged_dives }) : ''}
                  </div>
                  {b.divers?.certifications?.map((c) => (
                    <div key={c.id} className="small">
                      {c.agency} {levelName(c.level)} {c.verified_at ? '✅' : (
                        <button className="btn small ghost" style={{ padding: '2px 8px' }}
                          onClick={() => run(supabase.rpc('verify_certification', { p_cert: c.id, p_center: center.id }), t('Certificación verificada'))}>{t('Verificar')}</button>
                      )}
                    </div>
                  ))}
                </td>
                <td>{b.seats}</td>
                <td>
                  {php(b.amount_php)}
                  <div className="small muted">{b.paid_php >= b.amount_php ? t('Pagado') : t('Falta {amount}', { amount: php(b.amount_php - b.paid_php) })}</div>
                  {b.paid_php < b.amount_php && (
                    <button className="btn small ghost" style={{ padding: '2px 8px', marginTop: 4 }} onClick={() => {
                      if (window.confirm(t('¿Registrar cobro en efectivo de {amount}?', { amount: php(b.amount_php - b.paid_php) })))
                        run(supabase.rpc('record_cash_payment', { p_booking: b.id }), t('Cobro en efectivo registrado'))
                    }}>{t('Cobrar efectivo')}</button>
                  )}
                </td>
                <td>
                  <button className={b.checked_in_at ? 'btn small' : 'btn small ghost'} style={{ padding: '4px 8px' }}
                    onClick={() => run(supabase.rpc('set_checkin', { p_booking: b.id, p_in: !b.checked_in_at }), b.checked_in_at ? t('Check-in deshecho') : t('Check-in hecho'))}>
                    {b.checked_in_at ? '✓ ' + t('A bordo') : t('Check-in')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody></table>

          {trip.status === 'published' && !started && (
            <form style={{ marginTop: 12 }} onSubmit={(e) => {
              e.preventDefault()
              run(supabase.rpc('add_manual_booking', { p_trip: trip.id, p_guest: manual.guest, p_seats: manual.seats, p_with_gear: manual.gear, p_source: manual.source }), t('Reserva manual añadida'))
              setManual({ ...manual, guest: '', seats: 1 })
            }}>
              <b>{t('Añadir reserva manual')}</b>
              <div className="grid2" style={{ marginTop: 6 }}>
                <input placeholder={t('Nombre del cliente')} required value={manual.guest} onChange={(e) => setManual({ ...manual, guest: e.target.value })} />
                <select value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })}>{SOURCES.map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}</select>
                <input type="number" min="1" max={Math.max(1, s.boatFree)} value={manual.seats} onChange={(e) => setManual({ ...manual, seats: +e.target.value })} />
                <label className="check"><input type="checkbox" checked={manual.gear} onChange={(e) => setManual({ ...manual, gear: e.target.checked })} /> {t('Con equipo')}</label>
              </div>
              <button className="btn small" style={{ marginTop: 8 }}>{t('Añadir')}</button>
            </form>
          )}

          <hr />
          <div className="row wrap">
            <Link to={'/centro/salida/' + trip.id} className="btn small ghost">{t('Editar salida')}</Link>
            {trip.status === 'draft' && (
              <button className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'published' }).eq('id', trip.id), t('Salida publicada'))}>{t('Publicar')}</button>
            )}
            {trip.status === 'published' && started && (
              <button className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'completed' }).eq('id', trip.id), t('Salida marcada como completada'))}>{t('Marcar completada')}</button>
            )}
            {trip.status === 'published' && !started && (
              <>
                <label className="small row">{t('Bloquear plazas:')}
                  <input type="number" min="0" style={{ width: 70 }} defaultValue={trip.blocked_seats}
                    onBlur={(e) => +e.target.value !== trip.blocked_seats && run(supabase.from('trips').update({ blocked_seats: +e.target.value }).eq('id', trip.id), t('Plazas bloqueadas actualizadas'))} />
                </label>
                <button className="btn small danger" onClick={() => {
                  if (window.confirm(t('¿Cancelar por meteo? Se cancelan todas las reservas y se devuelve todo lo pagado.')))
                    run(supabase.rpc('cancel_trip_weather', { p_trip: trip.id }), t('Salida cancelada por meteo. Reembolsos generados.'))
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
