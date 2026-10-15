import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, appUrl } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { BOOKING_STATUS, dateTime, php } from '../lib/format'

const HOLD_MIN = 15

// Hasta cuándo se retiene la plaza de una reserva sin pagar
const holdEnd = (b) => Math.max(new Date(b.created_at).getTime() + HOLD_MIN * 60000, b.hold_until ? new Date(b.hold_until).getTime() : 0)

// Lee el error que devuelve la Edge Function
async function fnError(error) {
  try { const j = await error.context.json(); return j.error || error.message } catch { return error.message }
}

function PayBox({ b, mode, onDone }) {
  const pending = b.status === 'pending_payment'
  const balance = b.amount_php - b.paid_php
  const [kind, setKind] = useState(pending ? 'deposit' : 'balance')
  const [method, setMethod] = useState('gcash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const amount = kind === 'deposit' ? b.deposit_php - b.paid_php : balance

  async function pay() {
    setBusy(true); setError('')
    if (mode === 'demo') {
      const { error } = await supabase.rpc('confirm_payment_demo', { p_booking: b.id, p_kind: kind })
      setBusy(false)
      return error ? setError(errMsg(error)) : onDone('¡Pago registrado! (modo demo)')
    }
    const { data, error } = await supabase.functions.invoke('crear-pago', {
      body: { booking_id: b.id, kind, method, return_url: appUrl() },
    })
    if (error) { setBusy(false); return setError(await fnError(error)) }
    window.location.href = data.checkout_url
  }

  return (
    <div style={{ marginTop: 10 }}>
      {pending ? (
        <div className="seg">
          <button className={kind === 'deposit' ? 'on' : ''} onClick={() => setKind('deposit')}>Señal 50 % · {php(b.deposit_php - b.paid_php)}</button>
          <button className={kind === 'full' ? 'on' : ''} onClick={() => setKind('full')}>Todo · {php(balance)}</button>
        </div>
      ) : null}
      {mode !== 'demo' && (
        <div className="seg">
          <button className={method === 'gcash' ? 'on' : ''} onClick={() => setMethod('gcash')}>GCash</button>
          <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>Tarjeta</button>
        </div>
      )}
      {error && <div className="msg err">{error}</div>}
      <button className="btn block" disabled={busy || amount <= 0} onClick={pay}>
        {busy ? 'Un momento…' : `Pagar ${php(amount)}${mode === 'demo' ? ' (modo demo)' : method === 'gcash' ? ' con GCash' : ' con tarjeta'}`}
      </button>
    </div>
  )
}

export default function Reservas() {
  const { diver } = useAuth()
  const [list, setList] = useState(null)
  const [mode, setMode] = useState('demo')
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
  useEffect(() => {
    supabase.from('app_config').select('value').eq('key', 'payments_mode').maybeSingle()
      .then(({ data }) => data && setMode(data.value))
  }, [])

  // Vuelta desde PayMongo: #/reservas?pago=<id>[&cancelado=1]
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const pid = q.get('pago')
    if (!pid || !diver) return
    history.replaceState(null, '', window.location.pathname + '#/reservas')
    if (q.get('cancelado')) { setInfo('Pago cancelado. Puedes intentarlo de nuevo.'); return }
    setInfo('Comprobando el pago…')
    supabase.functions.invoke('crear-pago', { body: { action: 'check', payment_id: pid } }).then(async ({ data, error }) => {
      if (error) { setInfo(''); return setError(await fnError(error)) }
      setInfo(data.status === 'paid' ? '¡Pago recibido! Tu reserva está confirmada.' : 'El pago aún no aparece como completado. Si has pagado, se actualizará en unos minutos.')
      load()
    })
  }, [diver, load])

  async function cancel(b) {
    setError(''); setInfo('')
    const { error } = await supabase.rpc('cancel_my_booking', { p_booking: b.id })
    if (error) setError(errMsg(error)); else setInfo('Reserva cancelada')
    load()
  }

  if (!diver || list === null) return <p className="muted">Cargando…</p>

  const now = Date.now()
  const upcoming = list.filter((b) => new Date(b.trips?.departs_at) > now)
  const past = list.filter((b) => new Date(b.trips?.departs_at) <= now)

  const card = (b) => {
    const minsLeft = Math.ceil((holdEnd(b) - now) / 60000)
    const expired = b.status === 'pending_payment' && minsLeft <= 0
    const active = b.status === 'confirmed' || (b.status === 'pending_payment' && !expired)
    const future = new Date(b.trips?.departs_at) > now
    const balance = b.amount_php - b.paid_php
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
        {b.paid_php > 0 && (
          <div className="small" style={{ marginTop: 4 }}>
            Pagado {php(b.paid_php)}{balance > 0 && active ? <> · <b>pendiente {php(balance)}</b></> : ' · todo pagado'}
          </div>
        )}
        {b.refund_php > 0 && <div className="msg ok">Reembolso: {php(b.refund_php)}</div>}
        {b.trips?.status === 'cancelled_weather' && <div className="msg err">Salida cancelada por meteo.</div>}
        {b.status === 'pending_payment' && !expired && (
          <p className="small muted">Plaza retenida {minsLeft} min más. Paga al menos la señal del 50 % ({php(b.deposit_php)}) para confirmarla.</p>
        )}
        {b.status === 'confirmed' && balance > 0 && future && (
          <p className="small muted">Paga el resto ahora en la app o en efectivo en el centro el día de la salida.</p>
        )}
        {active && future && balance > 0 && <PayBox b={b} mode={mode} onDone={(t) => { setInfo(t); load() }} />}
        {active && future && (
          <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => {
            const h = (new Date(b.trips.departs_at) - now) / 3600000
            const keep = Math.round(b.amount_php * 0.5)
            const txt = b.status === 'pending_payment' ? '¿Cancelar la reserva?'
              : h >= 24 ? `¿Cancelar? Se te devolverá todo lo pagado (${php(b.paid_php)}).`
              : `¿Cancelar? Quedan menos de 24 h: el centro se queda el 50 % (${php(keep)}). Se te devolverán ${php(Math.max(0, b.paid_php - keep))}.`
            if (window.confirm(txt)) cancel(b)
          }}>Cancelar reserva</button>
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
