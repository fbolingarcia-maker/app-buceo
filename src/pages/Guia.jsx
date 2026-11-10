// Día del guía (11 nov): salidas del día de sus centros, las asignadas primero, con el manifiesto y el check-in con QR
import { useCallback, useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { t } from '../lib/i18n'
import { time, dayLabel, manilaDate, addDays, levelName } from '../lib/format'
import { QrCheckin, activityName } from '../lib/comunidad'
import Icon from '../lib/Icon'
import { Check } from 'lucide-react'

export default function Guia() {
  const [day, setDay] = useState(manilaDate())
  const [trips, setTrips] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => supabase.rpc('guide_day', { p_day: day }).then(({ data, error }) => { if (error) setErr(errMsg(error)); else { setErr(''); setTrips(data || []) } }), [day])
  useEffect(() => { load() }, [load])
  const days = [0, 1, 2].map((n) => addDays(manilaDate(), n))
  return (
    <>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h1 style={{ margin: 0 }}>{t('Mis salidas como guía')}</h1>
        <QrCheckin onDone={load} />
      </div>
      <div className="seg" role="group" aria-label={t('Día')} style={{ margin: '10px 0' }}>
        {days.map((d, i) => <button key={d} type="button" className={day === d ? 'on' : ''} onClick={() => setDay(d)}>{i === 0 ? t('Hoy') : i === 1 ? t('Mañana') : dayLabel(d, { weekday: 'short', day: 'numeric' })}</button>)}
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      {trips && trips.length === 0 && <div className="card muted">{t('No hay salidas este día.')}</div>}
      {(trips || []).map((tr) => {
        const seats = tr.bookings.reduce((n, b) => n + b.seats, 0)
        const aboard = tr.bookings.filter((b) => b.checked_in_at).reduce((n, b) => n + b.seats, 0)
        return (
          <div key={tr.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row between wrap" style={{ gap: 6 }}>
              <b>{time(tr.departs_at)} · {tr.boat}</b>
              {tr.mine ? <span className="pill ok">{t('Tu salida')}</span> : <span className="pill">{tr.center_name}</span>}
            </div>
            <div className="small muted">
              {tr.kind === 'course' ? tr.course_name || t('Curso') : tr.activity && tr.activity !== 'scuba' ? activityName(tr.activity) : t('{n} inmersiones', { n: tr.num_dives }) + ' · ' + t('mín. {nivel}', { nivel: levelName(tr.min_level) })}
              {tr.sites.length > 0 && ' · ' + tr.sites.join(', ')}
            </div>
            <div className="small" style={{ marginTop: 4 }}>{t('Guías')}: {tr.guides.join(', ') || t('sin asignar')} · {t('A bordo {a} de {n}', { a: aboard, n: seats })}</div>
            <ul className="team-list" style={{ marginTop: 8 }}>
              {tr.bookings.map((b) => (
                <li key={b.id}>
                  <div className="row between wrap" style={{ gap: 6 }}>
                    <b>{b.full_name || t('Sin nombre')}{b.seats > 1 ? ' ×' + b.seats : ''}</b>
                    {b.checked_in_at ? <span className="pill ok"><Icon icon={Check} size={14} /> {t('A bordo')}</span> : <span className="pill">{t('Sin check-in')}</span>}
                  </div>
                  <div className="small muted">
                    {[b.cert_level ? (b.cert_agency ? b.cert_agency + ' ' : '') + levelName(b.cert_level) : null, b.cert_verified ? t('verificada') : null, b.medical_result ? t('cuestionario médico al día') : t('sin cuestionario médico'),
                      b.with_gear ? t('alquila equipo') + (b.wetsuit_size ? ' · ' + t('traje {t}', { t: b.wetsuit_size }) : '') + (b.bcd_size ? ' · BCD ' + b.bcd_size : '') + (b.fin_size ? ' · ' + t('aletas {t}', { t: b.fin_size }) : '') : null,
                      b.nitrox ? 'Nitrox' : null, b.insurance_provider ? t('seguro {s}', { s: b.insurance_provider }) : t('sin seguro')].filter(Boolean).join(' · ')}
                  </div>
                  {b.allergies && <div className="small"><b>{t('Alergias')}:</b> {b.allergies}</div>}
                  {b.amount_php - b.paid_php > 0 && <div className="small">{t('Le quedan {amount} por pagar.', { amount: '₱' + (b.amount_php - b.paid_php).toLocaleString('en-US') })}{b.pay_on_site ? ' ' + t('(en efectivo)') : ''}</div>}
                </li>
              ))}
              {tr.bookings.length === 0 && <li className="muted small">{t('Aún no hay reservas.')}</li>}
            </ul>
          </div>
        )
      })}
    </>
  )
}
