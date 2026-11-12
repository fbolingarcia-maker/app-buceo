// Mensajes privados buceador ↔ centro de una reserva (worker/chat.js).
// ChatThread: el hilo (mensajes + escribir), refresca cada 6 s mientras está a la vista. Para el centro, encima va la
// ficha del buceador y de la salida/reserva; para el buceador, solo la de la salida.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t } from './i18n'
import { Link } from './router'
import { BOOKING_STATUS, dateTime, php, levelName, manilaDate } from './format'
import { medicalValid, medicalUntil, daysSinceDive } from './medical'
import { langName } from './langs'
import { extraName } from './extras'
import Icon from './Icon'
import { Send, TriangleAlert, Check, Mail, CalendarDays } from 'lucide-react'

const POLL_MS = 6000

export function ChatThread({ bookingId, compactInfo = false }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef(null)
  const last = useRef(null)

  const load = useCallback(async (full) => {
    const { data, error } = await supabase.rpc('booking_chat', { p_booking: bookingId, ...(full || !last.current ? {} : { p_after: last.current }) })
    if (error) return setErr(errMsg(error))
    setErr('')
    setD((prev) => {
      const msgs = full || !prev ? data.messages : [...prev.messages, ...data.messages.filter((m) => !prev.messages.some((p) => p.id === m.id))]
      if (msgs.length) last.current = msgs[msgs.length - 1].created_at
      return full || !prev ? data : { ...prev, messages: msgs, other_read_at: data.other_read_at, closed: data.closed }
    })
  }, [bookingId])

  useEffect(() => {
    last.current = null; setD(null); load(true)
    const i = setInterval(() => { if (document.visibilityState === 'visible') load(false) }, POLL_MS)
    return () => clearInterval(i)
  }, [bookingId, load])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [d?.messages?.length])

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('booking_chat_send', { p_booking: bookingId, p_body: body })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setText(''); load(false)
  }

  if (!d) return err ? <div className="msg err" role="alert">{err}</div> : <p className="muted">{t('Cargando…')}</p>
  const lastMine = [...d.messages].reverse().find((m) => m.mine)
  const seen = lastMine && d.other_read_at && d.other_read_at >= lastMine.created_at
  return (
    <div className="stack" style={{ gap: 12 }}>
      {d.side === 'center' && d.diver && <DiverCard diver={d.diver} trip={d.trip} />}
      {!compactInfo && <TripCard d={d} />}
      <div className="card chat">
        <div className="chat-list tall" aria-live="polite">
          {d.messages.length === 0
            ? <p className="small muted">{d.side === 'diver' ? t('Escribe al centro: material, punto de encuentro, dudas sobre la salida. Solo lo ve el centro.') : t('Aún no hay mensajes en esta reserva.')}</p>
            : d.messages.map((m) => (
              <div key={m.id} className={'chat-msg' + (m.mine ? ' mine' : '') + (m.sender === 'center' ? ' staff' : '')}>
                <span className="small"><b>{m.author}</b> <span className="muted">{dateTime(m.created_at)}</span></span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
              </div>
            ))}
          {seen && <span className="small muted" style={{ alignSelf: 'flex-end' }}><Icon icon={Check} size={14} /> {t('Leído')}</span>}
          <div ref={end} />
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>{d.side === 'diver' ? t('Privado: solo lo veis tú y el centro. Se guarda cifrado y se borra 12 meses después de la salida.') : t('Privado: solo lo veis el buceador y tu centro. Se guarda cifrado y se borra 12 meses después de la salida.')}</p>
        {err && <div className="msg err" role="alert">{err}</div>}
        {d.closed ? <p className="small muted" style={{ margin: '8px 0 0' }}>{t('La conversación se cerró 14 días después de la salida. Puedes seguir leyéndola.')}</p>
            : (
              <form className="row" style={{ gap: 6, marginTop: 8, alignItems: 'flex-end' }} onSubmit={send}>
                <textarea className="grow" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e) }}
                  placeholder={t('Escribe un mensaje')} aria-label={t('Escribe un mensaje')} />
                <button className="btn" disabled={busy || !text.trim()} aria-label={t('Enviar')}><Icon icon={Send} size={18} /></button>
              </form>
            )}
      </div>
    </div>
  )
}

// Salida y reserva (los dos lados)
export function TripCard({ d }) {
  const { trip, booking } = d
  if (!trip) return null
  const due = Math.max(0, (booking.amount_php || 0) - (booking.paid_php || 0))
  return (
    <div className="card stack facts" style={{ gap: 6 }}>
      <div className="row between wrap" style={{ gap: 6 }}>
        <b>{d.side === 'center' ? t('Salida y reserva') : trip.center_name}</b>
        <span className={booking.status === 'confirmed' ? 'pill ok' : booking.status === 'pending_payment' ? 'pill warn' : 'pill'}>{BOOKING_STATUS[booking.status]}</span>
      </div>
      <div className="row between"><span className="muted">{t('Salida')}</span><span>{dateTime(trip.departs_at)}</span></div>
      {trip.kind === 'course' && trip.course_name && <div className="row between"><span className="muted">{t('Curso')}</span><span>{trip.course_name}</span></div>}
      {trip.sites?.length > 0 && <div className="row between"><span className="muted">{t('Puntos')}</span><span style={{ textAlign: 'right' }}>{trip.sites.join(' · ')}</span></div>}
      <div className="row between"><span className="muted">{t('Inmersiones')}</span><span>{trip.num_dives}</span></div>
      {d.side === 'center' && trip.boat_name && <div className="row between"><span className="muted">{t('Barco')}</span><span>{trip.boat_name}</span></div>}
      <div className="row between"><span className="muted">{t('Plazas')}</span><span>{booking.seats}{booking.with_gear ? ' · ' + t('alquila equipo') : ''}</span></div>
      {booking.extras?.length > 0 && <div className="row between"><span className="muted">{t('Extras')}</span><span style={{ textAlign: 'right' }}>{booking.extras.map((e) => extraName(e) + (e.qty > 1 ? ' ×' + e.qty : '')).join(', ')}</span></div>}
      <div className="row between"><span className="muted">{t('Pago')}</span><span>{php(booking.paid_php)} / {php(booking.amount_php)}{due > 0 && <> · {booking.pay_on_site ? t('resto en efectivo') : t('pendiente {amount}', { amount: php(due) })}</>}</span></div>
      {booking.checked_in_at && <div className="row between"><span className="muted">{t('A bordo')}</span><span><Icon icon={Check} size={14} /> {dateTime(booking.checked_in_at)}</span></div>}
      {d.side === 'center' && <Link to={'/centro/agenda?dia=' + manilaDate(new Date(trip.departs_at))} className="small"><Icon icon={CalendarDays} size={14} /> {t('Ver en la agenda')}</Link>}
      {d.side === 'diver' && <Link to="/reservas" className="small">{t('Ver la reserva')}</Link>}
    </div>
  )
}

// Ficha del buceador para el centro: lo mismo que el manifiesto, con avisos de lo que falta
export function DiverCard({ diver, trip }) {
  const med = medicalValid(diver)
  const since = daysSinceDive(diver)
  const insExpires = diver.insurance_expiry && trip?.departs_at && diver.insurance_expiry < manilaDate(new Date(trip.departs_at))
  const warn = (x) => <span className="warn-text"><Icon icon={TriangleAlert} size={14} /> {x}</span>
  return (
    <div className="card stack facts" style={{ gap: 6 }}>
      <div className="row between wrap" style={{ gap: 6 }}>
        <b>{diver.full_name}</b>
        {diver.email && <a className="small" href={'mailto:' + diver.email}><Icon icon={Mail} size={14} /> {diver.email}</a>}
      </div>
      {(diver.country || diver.languages?.length > 0) && <div className="small muted">{[diver.country, diver.languages?.map(langName).join(', ')].filter(Boolean).join(' · ')}</div>}
      <div className="row between"><span className="muted">{t('Certificación')}</span><span style={{ textAlign: 'right' }}>{diver.certifications?.length
        ? diver.certifications.map((c, i) => <span key={i}>{i > 0 && ', '}{c.agency} {levelName(c.level)}{c.verified && <Icon icon={Check} size={14} aria-label={t('Verificada')} />}</span>)
        : warn(t('Sin certificación'))}</span></div>
      <div className="row between"><span className="muted">{t('Inmersiones')}</span><span>{diver.dives}{diver.nitrox ? ' · Nitrox' : ''}</span></div>
      <div className="row between"><span className="muted">{t('Última inmersión')}</span><span>{since == null ? t('Sin indicar') : since > 365 ? warn(t('hace más de 12 meses')) : t('hace {n} días', { n: since })}</span></div>
      <div className="row between"><span className="muted">{t('Cuestionario médico')}</span><span>{med ? t('Al día hasta {fecha}', { fecha: medicalUntil(diver) }) : warn(t('Falta o caducado'))}</span></div>
      <div className="row between"><span className="muted">{t('Seguro de buceo')}</span><span>{diver.insurance_provider ? <>{diver.insurance_provider}{diver.insurance_expiry && ' · ' + diver.insurance_expiry}{insExpires && <> {warn(t('caduca antes de la salida'))}</>}</> : warn(t('Sin indicar'))}</span></div>
      <div className="row between"><span className="muted">{t('Tallas')}</span><span>{[diver.wetsuit_size && t('Traje {x}', { x: diver.wetsuit_size }), diver.bcd_size && t('Chaleco {x}', { x: diver.bcd_size }), diver.fin_size && t('Aletas {x}', { x: diver.fin_size })].filter(Boolean).join(' · ') || t('Sin indicar')}</span></div>
      {diver.allergies && <div className="msg warn" style={{ margin: 0 }}><b>{t('Alergias')}:</b> {diver.allergies}</div>}
    </div>
  )
}
