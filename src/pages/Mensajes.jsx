// Mensajes privados de una reserva.
// - Buceador: #/mensajes/<reserva> (desde Reservas o el aviso).
// - Centro: #/centro/mensajes (bandeja) y #/centro/mensajes/<reserva> (hilo con la ficha del buceador y la salida).
//   En pantallas anchas, bandeja y hilo van lado a lado.
import { useCallback, useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { t } from '../lib/i18n'
import { Link } from '../lib/router'
import { dateTime, BOOKING_STATUS } from '../lib/format'
import { ChatThread } from '../lib/bookingChat'
import Icon from '../lib/Icon'
import { ArrowLeft, MessageSquare } from 'lucide-react'

export default function Mensajes({ id }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Link to="/reservas" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Reservas')}</Link>
      <h1 style={{ marginTop: 8 }}>{t('Mensajes con el centro')}</h1>
      <ChatThread bookingId={id} />
    </div>
  )
}

export function CentroMensajes({ id }) {
  const { center, readOnly } = useAuth()
  if (readOnly) return <><h1><Icon icon={MessageSquare} size={26} /> {t('Mensajes')}</h1><div className="card muted">{t('Las conversaciones son privadas entre el buceador y el centro. DivingSlot no tiene acceso a ellas.')}</div></>
  return <Inbox center={center} id={id} />
}

function Inbox({ center, id }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => supabase.rpc('chat_inbox', { p_center: center.id }).then(({ data, error }) => {
    if (error) setErr(errMsg(error)); else { setErr(''); setList(data || []) }
  }), [center.id])
  useEffect(() => {
    load()
    const i = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000)
    return () => clearInterval(i)
  }, [load, id])

  const inbox = (
    <div className="stack" style={{ gap: 6 }}>
      {err && <div className="msg err" role="alert">{err}</div>}
      {list === null ? <p className="muted">{t('Cargando…')}</p> : list.length === 0 ? (
        <div className="card muted">{t('Aún no hay conversaciones. Cuando un buceador te escriba desde su reserva, aparecerá aquí con sus datos y los de la salida.')}</div>
      ) : list.map((c) => (
        <Link key={c.booking_id} to={'/centro/mensajes/' + c.booking_id} className={'card inbox-row' + (c.booking_id === id ? ' on' : '') + (c.unread > 0 ? ' unread' : '')}>
          <div className="row between" style={{ gap: 8 }}>
            <b className="trip-title">{c.diver_name}</b>
            {c.unread > 0 ? <span className="badge">{c.unread}</span> : <span className="small muted">{dateTime(c.last_at)}</span>}
          </div>
          <div className="small muted">{t('Salida')} {dateTime(c.departs_at)} · {BOOKING_STATUS[c.status]}</div>
          <div className="small trip-title">{c.last_sender === 'center' ? t('Tú') + ': ' : ''}{c.last_body}</div>
        </Link>
      ))}
    </div>
  )

  return (
    <>
      <h1><Icon icon={MessageSquare} size={26} /> {t('Mensajes')}</h1>
      <div className={'inbox' + (id ? ' has-thread' : '')}>
        <div className="inbox-list">{inbox}</div>
        {id && (
          <div className="inbox-thread">
            <Link to="/centro/mensajes" className="small inbox-back"><Icon icon={ArrowLeft} size={16} /> {t('Todas las conversaciones')}</Link>
            <ChatThread bookingId={id} />
          </div>
        )}
      </div>
    </>
  )
}
