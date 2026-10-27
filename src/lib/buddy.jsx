import { useEffect, useState } from 'react'
import { t } from './i18n'
import { supabase } from './supabase'
import { Link } from './router'
import { dayLabel, manilaDate } from './format'
import Icon from './Icon'
import { Star, ChevronRight, Users } from 'lucide-react'

// Valoraciones entre buddies (opcional, cada buceador lo activa en su perfil).
// Solo puede valorar quien buceó contigo: los dos con check-in en la misma salida, hasta 14 días después.
// Nadie ve quién le ha valorado ni las notas sueltas: solo la media cuando hay al menos MIN valoraciones.
// Interruptor de la función: se enciende cuando estén la migración de Supabase y el Worker (ver claude/valoraciones-buddies-y-ux.md).
// Mientras esté apagado, la app no muestra nada de esto y se puede subir sin la parte de servidor.
export const BUDDY_RATINGS = import.meta.env.VITE_BUDDY_RATINGS === 'on'
export const MIN_RATINGS = 3
export const WINDOW_DAYS = 14

// Criterios de un buen buddy (guías de PADI/SDI: flotabilidad, gas, atención al compañero, procedimientos y medio)
export const CRITERIA = [
  ['buoyancy', 'Flotabilidad', 'Control de la flotabilidad y buena posición en el agua'],
  ['air', 'Gestión del aire', 'Vigila su aire y avisa con tiempo'],
  ['awareness', 'Atención al buddy', 'Se queda cerca y está pendiente de ti'],
  ['safety', 'Seguridad en el agua', 'Revisa el equipo, usa las señales y asciende con control'],
  ['reef', 'Respeto al arrecife', 'No toca, no levanta arena y no persigue la fauna'],
]
const SCALE = ['Mejorable', 'Regular', 'Bien', 'Muy bien', 'Excelente']
export const scaleName = (n) => t(SCALE[n - 1])
const fmt = (x) => (Math.round(x * 10) / 10).toFixed(1)

// Etiqueta corta para listas («¿Quién va?»): ★ 4.7 · 9
export function BuddyChip({ buddy, onClick, open }) {
  if (!BUDDY_RATINGS) return null
  if (!buddy?.count || buddy.count < MIN_RATINGS) return null
  const label = t('Valoración como buddy: {s} de 5, {n} valoraciones', { s: fmt(buddy.score), n: buddy.count })
  return (
    <button type="button" className="buddy-chip" onClick={onClick} aria-expanded={onClick ? !!open : undefined} aria-label={label} title={label}>
      <Icon icon={Star} size={13} /> <b className="data">{fmt(buddy.score)}</b> <span>{t('buddy')} · {buddy.count}</span>
    </button>
  )
}

// Resumen completo: media, criterios y «volvería a bucear contigo»
export function BuddyBreakdown({ s, own }) {
  if (!s || (s.count || 0) < MIN_RATINGS) {
    const n = s?.count || 0
    return (
      <div className="buddy-empty">
        <div className="buddy-dots" aria-hidden>{Array.from({ length: MIN_RATINGS }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</div>
        <p className="small muted" style={{ margin: 0 }}>
          {own
            ? (n === 0 ? t('Aún no tienes valoraciones. Tu media aparece cuando tengas {m}.', { m: MIN_RATINGS }) : t('{n} de {m} valoraciones. Tu media aparece cuando tengas {m}.', { n, m: MIN_RATINGS }))
            : t('Todavía no tiene suficientes valoraciones.')}
        </p>
        {own && s?.pending_reveal > 0 && <p className="small muted" style={{ margin: '4px 0 0' }}>{s.pending_reveal === 1 ? t('1 valoración más se sumará al cerrar el plazo de su salida.') : t('{n} valoraciones más se sumarán al cerrar el plazo de sus salidas.', { n: s.pending_reveal })}</p>}
      </div>
    )
  }
  const top = CRITERIA.filter(([k]) => s.scores?.[k] >= 4.5)
  return (
    <div className="buddy-sum">
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <div className="buddy-big"><Icon icon={Star} size={22} /><b className="data">{fmt(s.overall)}</b></div>
        <div className="grow small">
          <b>{s.overall >= 4.5 ? t('Buddy excelente') : s.overall >= 3.5 ? t('Buen buddy') : t('Buddy en progreso')}</b>
          <div className="muted">{t('{n} valoraciones de {r} buceadores', { n: s.count, r: s.raters || s.count })}</div>
        </div>
      </div>
      <div className="buddy-bars">
        {CRITERIA.map(([k, name]) => s.scores?.[k] != null && (
          <div key={k} className="buddy-bar">
            <span className="small">{t(name)}</span>
            <span className="bar" aria-hidden><span style={{ width: (s.scores[k] / 5) * 100 + '%' }} /></span>
            <b className="data small">{fmt(s.scores[k])}</b>
          </div>
        ))}
      </div>
      {(top.length > 0 || s.dive_again >= 0.8) && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {s.dive_again >= 0.8 && <span className="pill ok">{own ? t('El {p} % volvería a bucear contigo', { p: Math.round(s.dive_again * 100) }) : t('El {p} % repetiría como buddy', { p: Math.round(s.dive_again * 100) })}</span>}
          {top.map(([k, name]) => <span key={k} className="pill">{t('{c}: excelente', { c: t(name) })}</span>)}
        </div>
      )}
      {own && s.pending_reveal > 0 && <p className="small muted" style={{ margin: '8px 0 0' }}>{s.pending_reveal === 1 ? t('1 valoración más se sumará al cerrar el plazo de su salida.') : t('{n} valoraciones más se sumarán al cerrar el plazo de sus salidas.', { n: s.pending_reveal })}</p>}
    </div>
  )
}

// Selector 1–5 de un criterio, con «No lo vi»
export function ScaleInput({ id, name, hint, value, onChange }) {
  const [focus, setFocus] = useState(null)
  const shown = focus ?? value
  return (
    <fieldset className="scale">
      <legend><b>{t(name)}</b><span className="small muted">{t(hint)}</span></legend>
      <div className="scale-row" role="radiogroup" aria-label={t(name)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={n + ' · ' + scaleName(n)}
            className={value && n <= value ? 'on' : ''} onClick={() => onChange(value === n ? null : n)}
            onMouseEnter={() => setFocus(n)} onMouseLeave={() => setFocus(null)} id={n === 1 ? id : undefined}>{n}</button>
        ))}
        <button type="button" className={'skip' + (value === 0 ? ' on' : '')} aria-pressed={value === 0} onClick={() => onChange(value === 0 ? null : 0)}>{t('No lo vi')}</button>
      </div>
      <div className="small muted scale-label" aria-live="polite">{shown ? scaleName(shown) : value === 0 ? t('No cuenta en su media') : ' '}</div>
    </fieldset>
  )
}

// Aviso «Valora a tus buddies» de las salidas recientes con compañeros por valorar (Reservas y Bitácora)
export function PendingBuddyRatings() {
  const [list, setList] = useState([])
  useEffect(() => {
    if (!BUDDY_RATINGS) return
    supabase.rpc('my_pending_buddy_ratings').then(({ data }) => setList(Array.isArray(data) ? data : []))
  }, [])
  if (!list.length) return null
  return (
    <div className="list pending">
      {list.map((p) => {
        const days = Math.max(0, Math.ceil((new Date(p.closes_at) - Date.now()) / 864e5))
        return (
          <Link key={p.trip_id} to={'/valorar/' + p.trip_id} className="li">
            <span className="tile"><Users size={20} /></span>
            <span className="grow">
              <b>{p.pending === 1 ? t('Valora a tu buddy del {dia}', { dia: dayLabel(manilaDate(new Date(p.departs_at)), { weekday: 'long' }) }) : t('Valora a tus {n} buddies del {dia}', { n: p.pending, dia: dayLabel(manilaDate(new Date(p.departs_at)), { weekday: 'long' }) })}</b>
              <small>{p.center_name} · {days === 1 ? t('queda 1 día') : t('quedan {n} días', { n: days })}</small>
            </span>
            <ChevronRight size={18} />
          </Link>
        )
      })}
    </div>
  )
}
