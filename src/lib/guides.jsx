import { useEffect, useState } from 'react'
import { t } from './i18n'
import { supabase, errMsg } from './supabase'
import { Link } from './router'
import { dayLabel, manilaDate } from './format'
import { ScaleInput } from './buddy'
import Icon from './Icon'
import { Star, ChevronRight, Compass, Check, EyeOff, MessageSquare } from 'lucide-react'

// Valoraciones de los guías / divemasters (worker/guides.js).
// Las hace quien estuvo a bordo (check-in) en los 14 días siguientes a la salida: nota general 1–5 y cuatro criterios
// opcionales. La media es pública cuando la han valorado 3 buceadores distintos. El comentario solo lo leen el centro y el guía,
// y nadie ve quién ha puesto qué.
export const GUIDE_MIN = 3
export const GUIDE_CRITERIA = [
  ['briefing', 'Explicación previa', 'Briefing claro: el punto, la ruta, las señales y qué hacer si algo falla'],
  ['safety', 'Seguridad', 'Revisa el equipo, controla el aire y el grupo, y asciende con calma'],
  ['spotting', 'Encontrar vida marina', 'Te enseña lo interesante: macro, tortugas, peces raros'],
  ['friendly', 'Trato e idioma', 'Amable, paciente y se le entiende bien'],
]
const fmt = (x) => (Math.round(x * 10) / 10).toFixed(1)
const label = (n) => (n >= 4.5 ? t('Guía excelente') : n >= 3.5 ? t('Muy buen guía') : t('Guía'))

function StarPick({ value, onChange, id }) {
  return (
    <div className="stars" role="radiogroup" aria-label={t('Nota general')} id={id}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={t('{n} de 5', { n: i })} onClick={() => onChange(i)}>
          <Icon icon={Star} size={26} fill={i <= (value || 0) ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )
}

// Valorar a los guías de una salida (página #/valorar/<salida>). No pinta nada si la salida no tiene guías asignados.
export function GuideRatingForms({ tripId, onLoaded }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    supabase.rpc('guide_rating_targets', { p_trip: tripId }).then(({ data }) => {
      const v = data || { guides: [] }
      setD(v); onLoaded?.(v)
    })
  }, [tripId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !d.guides.length) return null
  return (
    <>
      <h2 style={{ marginBottom: 4 }}>{d.guides.length === 1 ? t('Tu guía') : t('Tus guías')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        <Icon icon={EyeOff} size={14} /> {t('La media aparece en la ficha del centro cuando le han valorado al menos {n} buceadores. El comentario solo lo leen el guía y el centro, sin tu nombre.', { n: GUIDE_MIN })}
      </p>
      {d.guides.map((g, i) => <GuideForm key={g.user_id} tripId={tripId} g={g} open={d.open} startOpen={i === 0} />)}
    </>
  )
}

function GuideForm({ tripId, g, open: windowOpen, startOpen }) {
  const [open, setOpen] = useState(startOpen)
  const [overall, setOverall] = useState(0)
  const [scores, setScores] = useState({})
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(g.rated)
  const [error, setError] = useState('')
  const first = (g.name || '').split(' ')[0]
  const head = (
    <div className="row" style={{ gap: 12 }}>
      <div className="avatar" aria-hidden><Icon icon={Compass} size={18} /></div>
      <div className="grow"><b id={'gf-' + g.user_id}>{g.name}</b><div className="small muted">{done ? <><Icon icon={Check} size={14} /> {t('Valoración enviada. Gracias.')}</> : t('Guía de la salida')}</div></div>
      {!done && !open && windowOpen && <button type="button" className="btn small ghost" onClick={() => setOpen(true)}>{t('Valorar')}</button>}
    </div>
  )
  if (done || !open || !windowOpen) return <div className="card">{head}</div>

  async function send() {
    setBusy(true); setError('')
    const clean = Object.fromEntries(Object.entries(scores).filter(([, v]) => v > 0))
    const { error } = await supabase.rpc('rate_guide', { p_trip: tripId, p_guide: g.user_id, p_overall: overall, p_scores: clean, p_comment: comment.trim() || null })
    setBusy(false)
    if (error) setError(errMsg(error)); else setDone(true)
  }
  return (
    <section className="card buddy-form" aria-labelledby={'gf-' + g.user_id}>
      {head}
      <div className="scale">
        <b>{t('¿Qué tal {name} como guía?', { name: first })}</b>
        <StarPick value={overall} onChange={setOverall} id={'gs-' + g.user_id} />
      </div>
      {overall > 0 && (
        <>
          <p className="small muted" style={{ margin: '10px 0 0' }}>{t('Opcional: puntúa lo que quieras o déjalo en blanco.')}</p>
          {GUIDE_CRITERIA.map(([k, name, hint]) => (
            <ScaleInput key={k} id={'g-' + g.user_id + '-' + k} name={name} hint={hint} value={scores[k]} onChange={(v) => setScores({ ...scores, [k]: v })} />
          ))}
          <label className="scale" style={{ display: 'block' }}>
            <b>{t('Comentario para el guía y el centro')}</b>
            <span className="small muted" style={{ display: 'block' }}>{t('Opcional y privado: no se publica.')}</span>
            <textarea rows="2" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('Lo mejor de la inmersión, o qué mejorarías')} style={{ marginTop: 6 }} />
          </label>
        </>
      )}
      {error && <div className="msg err" role="alert">{error}</div>}
      <button className="btn block" disabled={busy || !overall} onClick={send} style={{ marginTop: 12 }}>
        {busy ? t('Un momento…') : t('Enviar valoración de {name}', { name: first })}
      </button>
    </section>
  )
}

// Aviso «Valora a tu guía» en Reservas
export function PendingGuideRatings() {
  const [list, setList] = useState([])
  useEffect(() => { supabase.rpc('my_pending_guide_ratings').then(({ data }) => setList(Array.isArray(data) ? data : [])) }, [])
  if (!list.length) return null
  return (
    <div className="list pending">
      {list.map((p) => {
        const dia = dayLabel(manilaDate(new Date(p.departs_at)), { weekday: 'long' })
        return (
          <Link key={p.trip_id} to={'/valorar/' + p.trip_id} className="li">
            <span className="tile"><Compass size={20} /></span>
            <span className="grow">
              <b>{p.pending === 1 ? t('Valora a tu guía del {dia}', { dia }) : t('Valora a tus {n} guías del {dia}', { n: p.pending, dia })}</b>
              <small>{p.center_name}</small>
            </span>
            <ChevronRight size={18} />
          </Link>
        )
      })}
    </div>
  )
}

function GuideSummary({ s }) {
  return (
    <>
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <div className="buddy-big"><Icon icon={Star} size={22} /><b className="data">{fmt(s.overall)}</b></div>
        <div className="grow small">
          <b>{s.name || label(s.overall)}</b>
          <div className="muted">{s.raters === 1 ? t('1 buceador') : t('{n} buceadores', { n: s.raters })}{s.name ? ' · ' + label(s.overall) : ''}</div>
        </div>
      </div>
      {Object.keys(s.scores || {}).length > 0 && (
        <div className="buddy-bars">
          {GUIDE_CRITERIA.map(([k, name]) => s.scores[k] != null && (
            <div key={k} className="buddy-bar">
              <span className="small">{t(name)}</span>
              <span className="bar" aria-hidden><span style={{ width: (s.scores[k] / 5) * 100 + '%' }} /></span>
              <b className="data small">{fmt(s.scores[k])}</b>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Comments({ list }) {
  const [all, setAll] = useState(false)
  if (!list?.length) return null
  const shown = all ? list : list.slice(0, 3)
  return (
    <div style={{ marginTop: 10 }}>
      <div className="over" style={{ marginBottom: 4 }}><Icon icon={MessageSquare} size={14} /> {t('Comentarios privados')}</div>
      <ul className="team-list">
        {shown.map((c, i) => <li key={i} className="small"><b className="data">{c.overall}★</b> {c.comment} <span className="muted">· {dayLabel(manilaDate(new Date(c.at)), { day: 'numeric', month: 'short' })}</span></li>)}
      </ul>
      {list.length > 3 && !all && <button type="button" className="btn small ghost" onClick={() => setAll(true)}>{t('Ver todos ({n})', { n: list.length })}</button>}
    </div>
  )
}

// Ficha pública del centro: guías con 3+ buceadores. Equipo del centro: todos, con comentarios (Ajustes).
export function CenterGuideRatings({ centerId, staff }) {
  const [list, setList] = useState(null)
  useEffect(() => { supabase.rpc('guide_ratings', { p_center: centerId }).then(({ data }) => setList(Array.isArray(data) ? data : [])) }, [centerId])
  if (!list) return null
  if (!staff && !list.length) return null
  return (
    <>
      <h2>{staff ? t('Valoraciones de tus guías') : t('Guías')}</h2>
      {staff && <p className="small muted" style={{ marginTop: 0 }}>{t('Las valoran los buceadores con check-in, en los 14 días siguientes a la salida. La media se publica en tu ficha cuando un guía tiene {n} buceadores; los comentarios no se publican. Últimos 12 meses.', { n: GUIDE_MIN })}</p>}
      {staff && !list.length && <div className="card muted">{t('Aún no hay valoraciones. Asigna los guías a cada salida para que los buceadores puedan valorarlos.')}</div>}
      {list.map((s, i) => (
        <div key={s.user_id || i} className="card buddy-sum" style={{ marginBottom: 10 }}>
          <GuideSummary s={s} />
          {staff && s.raters < GUIDE_MIN && <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Aún no es pública: {n} de {m} buceadores.', { n: s.raters, m: GUIDE_MIN })}</p>}
          {staff && <Comments list={s.comments} />}
        </div>
      ))}
    </>
  )
}

// El guía ve las suyas (página del guía)
export function MyGuideRatings() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { supabase.rpc('my_guide_ratings').then(({ data, error }) => { if (error) setErr(errMsg(error)); else setS(data) }) }, [])
  if (err || !s) return null
  return (
    <>
      <h2>{t('Tus valoraciones')}</h2>
      <div className="card buddy-sum">
        {!s.raters
          ? <p className="small muted" style={{ margin: 0 }}>{t('Aún no tienes valoraciones. Los buceadores te pueden valorar cuando el centro te asigna a la salida y hacen check-in.')}</p>
          : <>
            <GuideSummary s={{ ...s, name: null }} />
            <p className="small muted" style={{ margin: '8px 0 0' }}>{s.public ? t('Tu media se ve en la ficha del centro.') : t('Tu media se publica cuando te hayan valorado {m} buceadores ({n} de {m}).', { n: s.raters, m: GUIDE_MIN })}</p>
            <Comments list={s.comments} />
          </>}
      </div>
    </>
  )
}
