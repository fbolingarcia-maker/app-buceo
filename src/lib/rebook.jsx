// Salida cancelada por el centro (23 nov 2026): el centro indica el motivo (mar u otro imprevisto) y el buceador
// que había pagado elige pasar lo pagado a otra salida del mismo centro o el reembolso. 7 días; si no elige, reembolso.
// Backend: worker/rebook.js (rebook_options, rebook_booking, choose_refund).
import { useEffect, useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t } from './i18n'
import { dateTime, php, time } from './format'
import { activityName } from './comunidad'

export const cancelReasonText = (trip) => (trip?.cancel_reason === 'other'
  ? t('El centro ha cancelado la salida por un imprevisto.')
  : t('El centro ha cancelado la salida por el estado del mar.'))

// Centro → Agenda: cancelar la salida con su motivo
export function CancelTrip({ trip, activeCount, paidTotal, run }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('weather')
  const [note, setNote] = useState('')
  if (!open) return <button type="button" className="btn small danger" onClick={() => setOpen(true)}>{t('Cancelar salida')}</button>
  return (
    <form className="card" style={{ marginTop: 8, width: '100%' }} onSubmit={async (e) => {
      e.preventDefault()
      const err = await run(supabase.rpc('cancel_trip_weather', { p_trip: trip.id, p_reason: reason, p_note: note.trim() || null }),
        activeCount ? t('Salida cancelada. Avisamos a los buceadores para que elijan otro día o el reembolso.') : t('Salida cancelada'))
      if (!err) setOpen(false)
    }}>
      <b>{t('Cancelar la salida de las {time}', { time: time(trip.departs_at) })}</b>
      <fieldset className="row wrap" style={{ border: 0, padding: 0, margin: '8px 0', gap: 8 }}>
        <legend className="small muted">{t('Motivo')}</legend>
        <label className="check"><input type="radio" name={'why' + trip.id} checked={reason === 'weather'} onChange={() => setReason('weather')} /> {t('Estado del mar')}</label>
        <label className="check"><input type="radio" name={'why' + trip.id} checked={reason === 'other'} onChange={() => setReason('other')} /> {t('Otro imprevisto')}</label>
      </fieldset>
      <input aria-label={t('Nota para los buceadores (opcional)')} placeholder={t('Nota para los buceadores (opcional)')} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      {activeCount > 0 && (
        <p className="small muted" style={{ marginTop: 8 }}>
          {t('Se cancelan {n} reservas. Quien pagó por la app ({amount} en total) podrá pasarlo a otra salida de tu centro o pedir el reembolso. Tiene 7 días para elegir; si no elige, se le devuelve todo.', { n: activeCount, amount: php(paidTotal) })}
        </p>
      )}
      <div className="row wrap" style={{ marginTop: 8 }}>
        <button className="btn small danger">{t('Confirmar la cancelación')}</button>
        <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>{t('Volver')}</button>
      </div>
    </form>
  )
}

// Reservas: elegir otra salida del mismo centro o el reembolso
export function RebookChoice({ b, startOpen = false, onDone }) {
  const [opts, setOpts] = useState(null)
  const [showList, setShowList] = useState(startOpen)
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!showList || opts) return
    supabase.rpc('rebook_options', { p_booking: b.id }).then(({ data, error }) => { if (error) setError(errMsg(error)); else setOpts(data) })
  }, [showList, opts, b.id])

  async function rebook() {
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('rebook_booking', { p_booking: b.id, p_trip: pick.id })
    setBusy(false)
    if (error) return setError(errMsg(error))
    onDone?.(data.refund_php > 0
      ? t('Listo: tu reserva pasa al {date}. Te devolvemos la diferencia ({amount}).', { date: dateTime(pick.departs_at), amount: php(data.refund_php) })
      : data.due_php > 0
        ? t('Listo: tu reserva pasa al {date}. Quedan {amount} por pagar: puedes hacerlo abajo o en el centro.', { date: dateTime(pick.departs_at), amount: php(data.due_php) })
        : t('Listo: tu reserva pasa al {date}.', { date: dateTime(pick.departs_at) }))
  }
  async function refund() {
    if (!window.confirm(t('¿Prefieres el reembolso de {amount}?', { amount: php(b.paid_php) }))) return
    setBusy(true); setError('')
    const { error } = await supabase.rpc('choose_refund', { p_booking: b.id })
    setBusy(false)
    if (error) return setError(errMsg(error))
    onDone?.(t('Te devolvemos {amount}. Puede tardar unos días en llegar.', { amount: php(b.paid_php) }))
  }

  return (
    <div className="msg warn" role="status" id={'elegir-' + b.id}>
      {cancelReasonText(b.trips)}
      {b.trips?.cancel_note && <div className="small" style={{ marginTop: 4 }}>{t('Nota del centro')}: {b.trips.cancel_note}</div>}
      <div style={{ marginTop: 6 }}>
        {t('Tienes {amount} pagados. Pásalos a otro día en el mismo centro o pide el reembolso. Puedes elegir hasta el {date}; si no eliges, te lo devolvemos todo.', { amount: php(b.paid_php), date: dateTime(b.choice_until) })}
      </div>
      {error && <div className="msg err" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      {!showList ? (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <button type="button" className="btn small" onClick={() => setShowList(true)}>{t('Elegir otro día')}</button>
          <button type="button" className="btn small ghost" disabled={busy} onClick={refund}>{t('Prefiero el reembolso')}</button>
        </div>
      ) : opts === null ? <p className="small muted" style={{ marginTop: 8 }}>{t('Cargando…')}</p> : (
        <div style={{ marginTop: 8 }}>
          {opts.trips.length === 0 && <p className="small">{t('El centro no tiene otras salidas con plaza en los próximos 90 días. Puedes pedir el reembolso o volver a mirar más tarde.')}</p>}
          <div className="rebook-list">
            {opts.trips.map((x) => (
              <label key={x.id} className={'rebook-opt' + (pick?.id === x.id ? ' on' : '')}>
                <input type="radio" name={'rb' + b.id} checked={pick?.id === x.id} onChange={() => setPick(x)} />
                <span className="grow">
                  <b>{dateTime(x.departs_at)}</b>
                  <span className="small muted"> · {x.kind === 'course' && x.course_name ? x.course_name : x.activity && x.activity !== 'scuba' ? activityName(x.activity) : t('{n} inmersiones', { n: x.num_dives })} · {t('{n} libres', { n: x.free })}</span>
                </span>
                <span className="small">
                  {x.difference_php > 0 ? t('pagas {amount} más', { amount: php(x.difference_php) })
                    : x.difference_php < 0 ? t('te devolvemos {amount}', { amount: php(-x.difference_php) })
                    : t('mismo precio')}
                </span>
              </label>
            ))}
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button type="button" className="btn small" disabled={!pick || busy} onClick={rebook}>{pick ? t('Pasar mi reserva al {date}', { date: dateTime(pick.departs_at) }) : t('Elige una salida')}</button>
            <button type="button" className="btn small ghost" disabled={busy} onClick={refund}>{t('Prefiero el reembolso')}</button>
          </div>
          {pick && opts.trips.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>{t('Mismas plazas ({n}) y el mismo equipo de alquiler que en la reserva cancelada.', { n: opts.seats })}</p>}
        </div>
      )}
    </div>
  )
}

// Estado ya resuelto de una reserva cancelada por el centro
export function RebookResult({ b, all }) {
  if (b.refund_choice === 'rebooked') {
    const nb = all.find((x) => x.id === b.rebooked_to)
    return (
      <div className="msg ok" role="status">
        {nb ? t('Pasaste esta reserva al {date}.', { date: dateTime(nb.trips?.departs_at) }) : t('Pasaste esta reserva a otra salida del centro.')}
        {b.refund_php > 0 && <><br />{t('Te devolvemos la diferencia: {amount}.', { amount: php(b.refund_php) })}</>}
      </div>
    )
  }
  return (
    <div className="msg warn" role="status">
      {cancelReasonText(b.trips)}
      {b.refund_php > 0 && <><br />{t('Se te devuelve todo lo pagado: {amount}.', { amount: php(b.refund_php) })}</>}
    </div>
  )
}
