import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg, appUrl } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { BOOKING_STATUS, dateTime, php, manilaDate } from '../lib/format'
import { t } from '../lib/i18n'
import Icon from '../lib/Icon'
import { calendarFile } from '../lib/ics'
import { CalendarPlus, Check, Share2, X, Navigation, MessageCircle, Clock } from 'lucide-react'
import { PendingBuddyRatings } from '../lib/buddy'
import { DanCard, SeaChip } from '../lib/extras'
import { NoFlyBanner, ReviewForm, TripChat, InstallButton } from '../lib/plus'
import { PayBox, fnError, holdEnd } from '../lib/pay'

function addToCalendar(b) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([calendarFile(b)], { type: 'text/calendar;charset=utf-8' }))
  a.download = 'divingslot-' + b.id.slice(0, 8) + '.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Próxima salida destacada: hora, punto de encuentro, mar previsto y «Cómo llegar»
function NextTrip({ b }) {
  const c = b.trips?.centers || {}
  const dest = [c.locality, c.destination].filter(Boolean).join(', ')
  const maps = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(c.lat != null ? c.lat + ',' + c.lng : (c.name || '') + ' ' + (c.destination || ''))
  const h = (new Date(b.trips.departs_at) - Date.now()) / 36e5
  return (
    <div className="card next-trip">
      <span className="over">{h < 24 ? t('Tu próxima salida es hoy o mañana') : t('Tu próxima salida')}</span>
      <div className="row between wrap" style={{ gap: 8, marginTop: 6 }}>
        <div>
          <b className="big">{dateTime(b.trips.departs_at)}</b>
          <div className="small">{c.name}{dest ? ' · ' + dest : ''}{b.trips?.boats?.show_to_divers ? ' · ' + b.trips.boats.name : ''}</div>
          <div style={{ marginTop: 6 }}><SeaChip tripId={b.trip_id} /></div>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <a className="btn small" href={maps} target="_blank" rel="noreferrer"><Icon icon={Navigation} size={16} /> {t('Cómo llegar')}</a>
          {c.phone && <a className="btn small ghost" href={'https://wa.me/' + c.phone.replace(/\D/g, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Llega 15 minutos antes con tu tarjeta de certificación.')}</p>
    </div>
  )
}

// Tras pagar: resumen de la reserva confirmada y el siguiente paso (calendario, avisar a un buddy, guía del destino)
function Confirmada({ b, onClose, diver }) {
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
      <div style={{ marginTop: 10 }}><DanCard diver={diver} compact /></div>
    </div>
  )
}

// El resto, en efectivo en el centro: sin recordatorio de pago online
function PayOnSite({ b, onDone }) {
  const [busy, setBusy] = useState(false)
  return (
    <label className="check small" style={{ marginTop: 8 }}>
      <input type="checkbox" checked={!!b.pay_on_site} disabled={busy} onChange={async (e) => {
        setBusy(true); await supabase.rpc('set_pay_on_site', { p_booking: b.id, p_on: e.target.checked }); setBusy(false); onDone()
      }} /> {t('Pagaré el resto en efectivo en el centro')}
    </label>
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
  const [waits, setWaits] = useState([])
  const [reviews, setReviews] = useState({})
  const [chatFor, setChatFor] = useState(null)

  const load = useCallback(async () => {
    if (!diver) return
    const { data, error } = await supabase.from('bookings')
      .select('*, trips(departs_at, num_dives, status, centers(name, phone, destination, locality, lat, lng), boats(name, show_to_divers)), booking_extras(name, qty, price_php)')
      .eq('diver_id', diver.id).order('created_at', { ascending: false })
    if (error) setError(errMsg(error))
    setList(data || [])
  }, [diver])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!diver) return
    supabase.rpc('my_waitlist').then(({ data }) => setWaits(data || []))
    supabase.rpc('my_reviews').then(({ data }) => setReviews(Object.fromEntries((data || []).map((r) => [r.booking_id, r]))))
  }, [diver, list])
  // Recién reservada (y pagada) desde la ficha de la salida: #/reservas?pagado=<id>
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const id = q.get('pagado')
    if (id) { history.replaceState(null, '', window.location.pathname + '#/reservas'); setJustPaid(id) }
  }, [])
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
  const next = upcoming.filter((b) => b.status === 'confirmed').sort((a, b) => a.trips.departs_at.localeCompare(b.trips.departs_at))[0]
  // Fin aproximado de la última salida hecha: hora de salida + 1,5 h por inmersión (para el aviso de no volar)
  const done = past.filter((b) => b.status === 'confirmed').map((b) => new Date(b.trips.departs_at).getTime() + (b.trips.num_dives || 2) * 1.5 * 36e5).filter((x) => x <= now)
  const lastEnd = done.length ? new Date(Math.max(...done)).toISOString() : null

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
        {(b.fees_php > 0 || b.booking_extras?.length > 0 || b.discount_php > 0) && (
          <div className="small muted" style={{ marginTop: 2 }}>
            {[b.fees_php > 0 && t('Tasas de santuarios incluidas ({amount})', { amount: php(b.fees_php) }),
              ...(b.booking_extras || []).map((e) => e.name + (e.qty > 1 ? ' ×' + e.qty : '')),
              b.discount_php > 0 && t('Descuento de última hora −{amount}', { amount: php(b.discount_php) })].filter(Boolean).join(' · ')}
          </div>
        )}
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
        {active && future && (
          <button type="button" className="btn small ghost" style={{ marginTop: 8, marginRight: 8 }} onClick={() => setChatFor(chatFor === b.trip_id ? null : b.trip_id)}><Icon icon={MessageCircle} /> {t('Chat de la salida')}</button>
        )}
        {chatFor === b.trip_id && <div style={{ marginTop: 8 }}><TripChat tripId={b.trip_id} open /></div>}
        {!future && b.status === 'confirmed' && <ReviewForm booking={b} existing={reviews[b.id]} onDone={() => supabase.rpc('my_reviews').then(({ data }) => setReviews(Object.fromEntries((data || []).map((r) => [r.booking_id, r]))))} />}
        {active && future && diver?.insurance_provider && diver.insurance_expiry && diver.insurance_expiry < manilaDate(b.trips?.departs_at) && (
          <div className="msg warn" role="status">{t('Tu seguro de buceo caduca antes de esta salida.')} <a href="#/perfil?ver=buceo">{t('Actualizar')}</a></div>
        )}
        {b.status === 'pending_payment' && !expired && (
          <p className="small muted">{t('Plaza retenida {n} min más. Paga al menos la señal del 50 % ({amount}) para confirmarla.', { n: minsLeft, amount: php(b.deposit_php) })}</p>
        )}
        {b.status === 'confirmed' && balance > 0 && future && (
          <p className="small muted">{b.pay_on_site ? t('Pagarás el resto ({amount}) en efectivo en el centro.', { amount: php(balance) }) : t('Paga el resto ahora en la app o en efectivo en el centro. 24 h antes te mandamos el enlace de pago.')}</p>
        )}
        {b.status === 'confirmed' && balance > 0 && future && <PayOnSite b={b} onDone={load} />}
        {active && future && balance > 0 && !b.pay_on_site && <PayBox b={b} mode={mode} onDone={(m, paidId) => { setInfo(m || ''); if (paidId) setJustPaid(paidId); load() }} />}
        {active && future && (
          <div className="bk-actions">
            {b.status === 'confirmed' && (
              <button type="button" className="btn small ghost" onClick={() => addToCalendar(b)}><Icon icon={CalendarPlus} /> {t('Añadir al calendario')}</button>
            )}
            <button type="button" className="btn small ghost" onClick={() => {
            const h = (new Date(b.trips.departs_at) - now) / 3600000
            const keep = Math.round(b.amount_php * 0.5)
            const txt = b.status === 'pending_payment' ? t('¿Cancelar la reserva?')
              : h >= 24 ? t('¿Cancelar? Se te devolverá todo lo pagado ({amount}).', { amount: php(b.paid_php) })
              : t('¿Cancelar? Quedan menos de 24 h: el centro se queda el 50 % ({keep}). Se te devolverán {refund}.', { keep: php(keep), refund: php(Math.max(0, b.paid_php - keep)) })
            if (window.confirm(txt)) cancel(b)
            }}>{t('Cancelar reserva')}</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <h1>{t('Mis reservas')}</h1>
      {error && <div className="msg err" role="alert">{error}</div>}
      {info && <div className="msg ok" role="status">{info}</div>}
      {paid && <Confirmada b={paid} diver={diver} onClose={() => setJustPaid(null)} />}
      <PendingBuddyRatings />
      <NoFlyBanner lastDiveEnd={lastEnd} />
      {next && <NextTrip b={next} />}
      {waits.length > 0 && (
        <div className="card">
          <span className="over">{t('Listas de espera')}</span>
          {waits.map((w) => (
            <div key={w.trip_id} className="row between wrap" style={{ gap: 8, marginTop: 8 }}>
              <span className="small"><Icon icon={Clock} size={14} /> <b>{w.center_name}</b> · {dateTime(w.departs_at)} · {w.status === 'offered' ? <b className="ok-ink">{t('Plaza retenida: págala abajo')}</b> : t('puesto {n}', { n: w.position })}</span>
              <Link to={'/salida/' + w.trip_id} className="btn small ghost">{t('Ver')}</Link>
            </div>
          ))}
        </div>
      )}
      {upcoming.length === 0 && <div className="card center muted">{t('No tienes reservas próximas.')} <Link to="/">{t('Ver salidas')}</Link></div>}
      {upcoming.map(card)}
      {upcoming.length > 0 && <p className="small muted center" style={{ marginTop: 12 }}><InstallButton className="btn small ghost" /></p>}
      {past.length > 0 && <><h2>{t('Anteriores')}</h2>{past.map(card)}</>}
    </>
  )
}
