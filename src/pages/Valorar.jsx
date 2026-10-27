import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { Link } from '../lib/router'
import { t } from '../lib/i18n'
import { levelName, dateTime } from '../lib/format'
import { CRITERIA, ScaleInput, WINDOW_DAYS } from '../lib/buddy'
import Icon from '../lib/Icon'
import { ArrowLeft, EyeOff, Check } from 'lucide-react'

// #/valorar/<salida>: valorar a los compañeros de una salida (solo los que lo tienen activado y estuvieron a bordo)
export default function Valorar({ tripId }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.rpc('buddy_rating_targets', { p_trip: tripId }).then(({ data, error }) => {
      if (error) setError(errMsg(error)); else setD(data || { divers: [] })
    })
  }, [tripId])

  const daysLeft = d?.closes_at ? Math.max(0, Math.ceil((new Date(d.closes_at) - Date.now()) / 864e5)) : null
  return (
    <>
      <Link to="/reservas" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Reservas')}</Link>
      <h1 style={{ marginTop: 8, marginBottom: 4 }}>{t('Valora a tus buddies')}</h1>
      {d?.departs_at && <p className="muted" style={{ marginTop: 0 }}>{d.center_name} · {dateTime(d.departs_at)}</p>}
      {error && <div className="msg err" role="alert">{error}</div>}
      {!d && !error && <p className="muted">{t('Cargando…')}</p>}

      {d && (
        <div className="callout">
          <Icon icon={EyeOff} size={18} />
          <div className="small">
            <b>{t('Tu valoración es anónima')}</b>
            <div className="muted">{t('Nadie ve quién ha valorado ni tus notas sueltas: solo la media, cuando tenga al menos 3 valoraciones. Se suma cuando los dos hayáis valorado o al cerrar el plazo.')}</div>
            {daysLeft != null && <div style={{ marginTop: 4 }}>{daysLeft === 1 ? t('Queda 1 día para valorar.') : t('Quedan {n} días para valorar.', { n: daysLeft })}</div>}
          </div>
        </div>
      )}

      {d && d.divers.length === 0 && (
        <div className="card muted">{t('No hay compañeros que valorar en esta salida. Solo se puede valorar a quien tiene activadas las valoraciones y estuvo a bordo (check-in), en los {n} días siguientes.', { n: WINDOW_DAYS })}</div>
      )}
      {d?.divers.map((b, i) => <BuddyForm key={b.diver_id} tripId={tripId} b={b} startOpen={i === 0} />)}
    </>
  )
}

function BuddyForm({ tripId, b, startOpen }) {
  const [open, setOpen] = useState(startOpen)
  const [scores, setScores] = useState({})
  const [again, setAgain] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(b.rated)
  const [error, setError] = useState('')
  const first = (b.name || '').split(' ')[0]
  const rated = Object.values(scores).filter((v) => v > 0).length
  const answered = CRITERIA.every(([k]) => scores[k] != null)

  async function send() {
    setBusy(true); setError('')
    const clean = Object.fromEntries(Object.entries(scores).filter(([, v]) => v > 0))
    const { error } = await supabase.rpc('rate_buddy', { p_trip: tripId, p_diver: b.diver_id, p_scores: clean, p_dive_again: again })
    setBusy(false)
    if (error) setError(errMsg(error)); else setDone(true)
  }

  if (done) return (
    <div className="card row" style={{ gap: 12 }}>
      <div className="avatar" aria-hidden>{(b.name || '?').charAt(0).toUpperCase()}</div>
      <div className="grow"><b>{b.name}</b><div className="small muted"><Icon icon={Check} size={14} /> {t('Valoración enviada. Gracias.')}</div></div>
    </div>
  )
  // Una persona cada vez: las demás quedan plegadas para que la pantalla no sea eterna
  if (!open) return (
    <div className="card row" style={{ gap: 12 }}>
      <div className="avatar" aria-hidden>{(b.name || '?').charAt(0).toUpperCase()}</div>
      <div className="grow">
        <b>{b.name}</b>
        <div className="small muted">{[b.level && levelName(b.level), b.dives ? t('{n} inmersiones', { n: b.dives }) : null].filter(Boolean).join(' · ')}</div>
      </div>
      <button type="button" className="btn small ghost" onClick={() => setOpen(true)}>{t('Valorar')}</button>
    </div>
  )
  return (
    <section className="card buddy-form" aria-labelledby={'bf-' + b.diver_id}>
      <div className="row" style={{ gap: 12, marginBottom: 6 }}>
        <div className="avatar" aria-hidden>{(b.name || '?').charAt(0).toUpperCase()}</div>
        <div className="grow">
          <b id={'bf-' + b.diver_id}>{b.name}</b>
          <div className="small muted">{[b.level && levelName(b.level), b.dives ? t('{n} inmersiones', { n: b.dives }) : null].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {CRITERIA.map(([k, name, hint]) => (
        <ScaleInput key={k} id={'s-' + b.diver_id + '-' + k} name={name} hint={hint} value={scores[k]} onChange={(v) => setScores({ ...scores, [k]: v })} />
      ))}
      <fieldset className="scale">
        <legend><b>{t('¿Volverías a bucear con {name}?', { name: first })}</b><span className="small muted">{t('Opcional. Solo cuenta en el porcentaje, nunca se muestra suelto.')}</span></legend>
        <div className="seg" style={{ margin: '6px 0 0' }}>
          <button type="button" className={again === true ? 'on' : ''} aria-pressed={again === true} onClick={() => setAgain(again === true ? null : true)}>{t('Sí')}</button>
          <button type="button" className={again === false ? 'on' : ''} aria-pressed={again === false} onClick={() => setAgain(again === false ? null : false)}>{t('Prefiero que no')}</button>
        </div>
      </fieldset>
      {error && <div className="msg err" role="alert">{error}</div>}
      <button className="btn block" disabled={busy || !answered || rated === 0} onClick={send} style={{ marginTop: 12 }}>
        {busy ? t('Un momento…') : t('Enviar valoración de {name}', { name: first })}
      </button>
      {!answered && <p className="small muted" style={{ margin: '6px 0 0' }}>{t('Puntúa cada criterio o marca «No lo vi».')}</p>}
    </section>
  )
}
