import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { BOOKING_STATUS, dateTime, php } from '../lib/format'

const HOLD_MIN = 15

export default function Reservas() {
  const { diver } = useAuth()
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    if (!diver) return
    const { data, error } = await supabase.from('bookings')
      .select('*, trips(departs_at, num_dives, status, centers(name, phone), boats(name))')
      .eq('diver_id', diver.id).order('created_at', { ascending: false })
    if (error) setError(errMsg(error))
    setList(data || [])
  }, [diver])

  useEffect(() => { load() }, [load])
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(i) }, [])

  async function act(fn, b, okText) {
    setError(''); setInfo('')
    const { error } = await supabase.rpc(fn, { p_booking: b.id })
    if (error) setError(errMsg(error)); else setInfo(okText)
    load()
  }

  if (!diver) return <p className="muted">Cargando…</p>
  if (list === null) return <p className="muted">Cargando…</p>

  const now = Date.now()
  const upcoming = list.filter((b) => new Date(b.trips?.departs_at) > now)
  const past = list.filter((b) => new Date(b.trips?.departs_at) <= now)

  const card = (b) => {
    const minsLeft = Math.ceil((new Date(b.created_at).getTime() + HOLD_MIN * 60000 - now) / 60000)
    const expired = b.status === 'pending_payment' && minsLeft <= 0
    const active = b.status === 'confirmed' || (b.status === 'pending_payment' && !expired)
    const future = new Date(b.trips?.departs_at) > now
    const cls = b.status === 'confirmed' ? 'pill ok' : b.status === 'pending_payment' && !expired ? 'pill warn' : 'pill bad'
    return (
      <div key={b.id} className="card">
        <div className="row between">
          <b>{b.trips?.centers?.name}</b>
          <span className={cls}>{expired ? 'Caducada (sin pagar)' : BOOKING_STATUS[b.status]}</span>
        </div>
        <div className="muted small">{dateTime(b.trips?.departs_at)} · {b.trips?.boats?.name} · {b.trips?.num_dives} inmersiones</div>
        <div className="row between" style={{ marginTop: 8 }}>
          <span>{b.seats} plaza{b.seats > 1 ? 's' : ''}{b.with_gear ? ' · con equipo' : ''}</span>
          <b>{php(b.amount_php)}</b>
        </div>
        {b.refund_php > 0 && <div className="msg ok">Reembolso: {php(b.refund_php)}</div>}
        {b.trips?.status === 'cancelled_weather' && <div className="msg err">Salida cancelada por meteo.</div>}
        {b.status === 'pending_payment' && !expired && (
          <p className="small muted">Plaza retenida {minsLeft} min más. Paga para confirmarla.</p>
        )}
        {active && future && (
          <div className="row" style={{ marginTop: 8 }}>
            {b.status === 'pending_payment' && (
              <button className="btn small" onClick={() => act('confirm_payment_demo', b, '¡Pago confirmado! (modo demo)')}>Pagar (modo demo)</button>
            )}
            <button className="btn small ghost" onClick={() => {
              const h = (new Date(b.trips.departs_at) - now) / 3600000
              const txt = b.status === 'pending_payment' ? '¿Cancelar la reserva?'
                : h >= 24 ? '¿Cancelar? Se te devolverá el 100 %.' : '¿Cancelar? Quedan menos de 24 h: se devuelve el 50 %.'
              if (window.confirm(txt)) act('cancel_my_booking', b, 'Reserva cancelada')
            }}>Cancelar</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <h1>Mis reservas</h1>
      {error && <div className="msg err">{error}</div>}
      {info && <div className="msg ok">{info}</div>}
      {upcoming.length === 0 && <div className="card center muted">No tienes reservas próximas. <Link to="/">Ver salidas</Link></div>}
      {upcoming.map(card)}
      {past.length > 0 && <><h2>Anteriores</h2>{past.map(card)}</>}
    </>
  )
}
