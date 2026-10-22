import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, appUrl, siteUrl } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { BOOKING_STATUS, dateTime, php } from '../lib/format'
import { t } from '../lib/i18n'
import Icon from '../lib/Icon'
import { CalendarPlus, Check, Lock, Share2, X } from 'lucide-react'

const HOLD_MIN = 15

// Descarga un .ics para añadir la salida al calendario del móvil
function addToCalendar(b) {
  const start = new Date(b.trips.departs_at)
  const end = new Date(start.getTime() + Math.max(3, (b.trips.num_dives || 2) * 1.5) * 3600000)
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DivingSlot//ES', 'BEGIN:VEVENT',
    'UID:' + b.id + '@divingslot.com', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(start), 'DTEND:' + f(end),
    'SUMMARY:' + t('Buceo con {centro}', { centro: b.trips.centers?.name || '' }),
    'DESCRIPTION:' + t('{n} inmersiones', { n: b.trips.num_dives }) + (b.trips.boats?.show_to_divers ? ' · ' + b.trips.boats.name : ''),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
  a.download = 'divingslot-' + b.id.slice(0, 8) + '.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Hasta cuándo se retiene la plaza de una reserva sin pagar
const holdEnd = (b) => Math.max(new Date(b.created_at).getTime() + HOLD_MIN * 60000, b.hold_until ? new Date(b.hold_until).getTime() : 0)

// Lee el error que devuelve la Edge Function
async function fnError(error) {
  try { const j = await error.context.json(); return j.error || error.message } catch { return error.message }
}

// Tras pagar: resumen de la reserva confirmada y el siguiente paso (calendario, avisar a un buddy, guía del destino)
function Confirmada({ b, onClose }) {
  const [copied, setCopied] = useState('')
  const balance = b.amount_php - b.paid_php
  const dest = b.trips?.centers?.destination
  async function share() {
    const url = appUrl() + '#/salida/' + b.trip_id
    const text = t('Salida de buceo con {centro} el {fecha}', { centro: b.trips?.centers?.name || '', fecha: dateTime(b.trips?.departs_at) })
    try {
      if (navigator.share) await navigator.share({ title: 'DivingSlot', text, url })
      else { await navigator.clipboard.writeText(text + ' ' + url); setCopied(t('Enlace copiado')) }
    } catch {}
  }
  const rows = [
    [t('Centro'), b.trips?.centers?.name],
    [t('Salida'), dateTime(b.trips?.departs_at)],
    [t('Plazas'), b.seats],
    [t('Pagado'), php(b.paid_php)],
    ...(balance > 0 ? [[t('Pendiente'), php(balance)]] : []),
  ]
  return (
    <div className="card confirmada" role="status">
      <div className="row between">
        <b className="row" style={{ gap: 6 }}><Icon icon={Check} className="ok-ink" />{t('Reserva confirmada')}</b>
        <button type="button" className="linkish" onClick={onClose} aria-label={t('Cerrar')}><Icon icon={X} /></button>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => <div key={k}><dt className="muted">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small ghost" onClick={() => addToCalendar(b)}><Icon icon={CalendarPlus} /> {t('Añadir al calendario')}</button>
        <button type="button" className="btn small ghost" onClick={share}><Icon icon={Share2} /> {t('Compartir con un buddy')}</button>
      </div>
      {copied && <div className="small muted" style={{ marginTop: 6 }}>{copied}</div>}
      {dest && <p className="small" style={{ margin: '10px 0 0' }}><Link to={'/d/' + encodeURIComponent(dest)}>{t('Guía del destino')}</Link></p>}
    </div>
  )
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
      return error ? setError(errMsg(error)) : onDone(null, b.id)
    }
    const { data, error } = await supabase.functions.invoke('crear-pago', {
      body: { booking_id: b.id, kind, method, return_url: siteUrl() },
    })
    if (error) { setBusy(false); return setError(await fnError(error)) }
    window.location.href = data.checkout_url
  }

  return (
    <div style={{ marginTop: 10 }}>
      {pending && <p className="small muted" style={{ margin: '0 0 6px' }}>{t('¿Cuánto quieres pagar ahora?')}</p>}
      {pending ? (
        <div className="seg">
          <button className={kind === 'deposit' ? 'on' : ''} onClick={() => setKind('deposit')}>{t('Señal 50 % · {amount}', { amount: php(b.deposit_php - b.paid_php) })}</button>
          <button className={kind === 'full' ? 'on' : ''} onClick={() => setKind('full')}>{t('Todo · {amount}', { amount: php(balance) })}</button>
        </div>
      ) : null}
      {mode !== 'demo' && (
        <div className="seg">
          <button className={method === 'gcash' ? 'on' : ''} onClick={() => setMethod('gcash')}>GCash</button>
          <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>{t('Tarjeta')}</button>
        </div>
      )}
      {error && <div className="msg err" role="alert">{error}</div>}
      <button className="btn block" disabled={busy || amount <= 0} onClick={pay}>
        {busy ? t('Un momento…')
          : mode === 'demo' ? t('Pagar {amount} (modo demo)', { amount: php(amount) })
          : method === 'gcash' ? t('Pagar {amount} con GCash', { amount: php(amount) })
          : t('Pagar {amount} con tarjeta', { amount: php(amount) })}
      </button>
      {mode !== 'demo' && <p className="small muted" style={{ margin: '6px 0 0' }}><Icon icon={Lock} size={14} /> {t('Pago seguro con PayMongo. DivingSlot no guarda los datos de tu tarjeta.')}</p>}
    </div>
  )
}

export default function Reservas() {
  const { diver } = useAuth()
  const [list, setList] = useState(null)
  const [mode, setMode] = useState('demo')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  // Reserva recién pagada: muestra arriba el resumen y el siguiente paso (no se guarda: al recargar ya no sale)
  const [justPaid, setJustPaid] = useState(null)
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    if (!diver) return
    const { data, error } = await supabase.from('bookings')
      .select('*, trips(departs_at, num_dives, status, centers(name, phone, destination), boats(name, show_to_divers))')
      .eq('diver_id', diver.id).order('created_at', { ascending: false })
    if (error) setError(errMsg(error))
    setList(data || [])
  }, [diver])

  useEffect(() => { load() }, [load])
  // Recién reservada desde la ficha de la salida
  useEffect(() => {
    try {
      if (sessionStorage.getItem('justBooked')) {
        sessionStorage.removeItem('justBooked')
        setInfo(t('¡Plaza retenida! Paga la señal en los próximos 15 min para confirmarla.'))
      }
    } catch (e) { /* sin almacenamiento */ }
  }, [])
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
    if (q.get('cancelado')) { setInfo(t('Pago cancelado. Puedes intentarlo de nuevo.')); return }
    setInfo(t('Comprobando el pago…'))
    supabase.functions.invoke('crear-pago', { body: { action: 'check', payment_id: pid } }).then(async ({ data, error }) => {
      if (error) { setInfo(''); return setError(await fnError(error)) }
      if (data.status === 'paid') {
        setInfo('')
        // El buceador puede leer sus propios pagos: de ahí sale la reserva pagada
        const { data: p } = await supabase.from('payments').select('booking_id').eq('id', pid).maybeSingle()
        if (p?.booking_id) setJustPaid(p.booking_id)
      } else setInfo(t('El pago aún no aparece como completado. Si has pagado, se actualizará en unos minutos.'))
      load()
    })
  }, [diver, load])

  async function cancel(b) {
    setError(''); setInfo('')
    const { error } = await supabase.rpc('cancel_my_booking', { p_booking: b.id })
    if (error) setError(errMsg(error)); else setInfo(t('Reserva cancelada'))
    load()
  }

  if (!diver || list === null) return <p className="muted">{t('Cargando…')}</p>

  const now = Date.now()
  const paid = justPaid && list.find((b) => b.id === justPaid)
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
          <span className={cls}>{expired ? t('Caducada (sin pagar)') : BOOKING_STATUS[b.status]}</span>
        </div>
        <div className="muted small">{dateTime(b.trips?.departs_at)}{b.trips?.boats?.show_to_divers ? ' · ' + b.trips.boats.name : ''} · {t('{n} inmersiones', { n: b.trips?.num_dives })}</div>
        <div className="row between" style={{ marginTop: 8 }}>
          <span>{b.seats > 1 ? t('{n} plazas', { n: b.seats }) : t('{n} plaza', { n: b.seats })}{b.with_gear ? ' · ' + t('con equipo') : ''}</span>
          <b>{php(b.amount_php)}</b>
        </div>
        {b.paid_php > 0 && (
          <div className="small" style={{ marginTop: 4 }}>
            {t('Pagado {amount}', { amount: php(b.paid_php) })}{balance > 0 && active ? <> · <b>{t('pendiente {amount}', { amount: php(balance) })}</b></> : ' · ' + t('todo pagado')}
          </div>
        )}
        {b.trips?.status === 'cancelled_weather' ? (
          <div className="msg warn" role="status">
            {t('El centro ha cancelado la salida por el estado del mar.')}
            {b.refund_php > 0 && <><br />{t('Se te devuelve todo lo pagado: {amount}.', { amount: php(b.refund_php) })}</>}
            <div style={{ marginTop: 6 }}><Link to="/">{t('Buscar otra salida')}</Link></div>
          </div>
        ) : b.refund_php > 0 && <div className="msg ok" role="status">{t('Reembolso: {amount}', { amount: php(b.refund_php) })}</div>}
        {b.status === 'pending_payment' && !expired && (
          <p className="small muted">{t('Plaza retenida {n} min más. Paga al menos la señal del 50 % ({amount}) para confirmarla.', { n: minsLeft, amount: php(b.deposit_php) })}</p>
        )}
        {b.status === 'confirmed' && balance > 0 && future && (
          <p className="small muted">{t('Paga el resto ahora en la app o en efectivo en el centro el día de la salida.')}</p>
        )}
        {b.status === 'confirmed' && future && (
          <button className="btn small ghost" style={{ marginTop: 8, marginRight: 8 }} onClick={() => addToCalendar(b)}><Icon icon={CalendarPlus} /> {t('Añadir al calendario')}</button>
        )}
        {active && future && balance > 0 && <PayBox b={b} mode={mode} onDone={(m, paidId) => { setInfo(m || ''); if (paidId) setJustPaid(paidId); load() }} />}
        {active && future && (
          <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => {
            const h = (new Date(b.trips.departs_at) - now) / 3600000
            const keep = Math.round(b.amount_php * 0.5)
            const txt = b.status === 'pending_payment' ? t('¿Cancelar la reserva?')
              : h >= 24 ? t('¿Cancelar? Se te devolverá todo lo pagado ({amount}).', { amount: php(b.paid_php) })
              : t('¿Cancelar? Quedan menos de 24 h: el centro se queda el 50 % ({keep}). Se te devolverán {refund}.', { keep: php(keep), refund: php(Math.max(0, b.paid_php - keep)) })
            if (window.confirm(txt)) cancel(b)
          }}>{t('Cancelar reserva')}</button>
        )}
      </div>
    )
  }

  return (
    <>
      <h1>{t('Mis reservas')}</h1>
      {error && <div className="msg err" role="alert">{error}</div>}
      {info && <div className="msg ok" role="status">{info}</div>}
      {paid && <Confirmada b={paid} onClose={() => setJustPaid(null)} />}
      {upcoming.length === 0 && <div className="card center muted">{t('No tienes reservas próximas.')} <Link to="/">{t('Ver salidas')}</Link></div>}
      {upcoming.map(card)}
      {past.length > 0 && <><h2>{t('Anteriores')}</h2>{past.map(card)}</>}
    </>
  )
}
