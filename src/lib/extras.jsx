// Piezas compartidas de las mejoras de noviembre: enlace propio del centro, condiciones del mar, Green Fins,
// prácticas ecológicas, extras del centro y precio de la salida (última hora y tasas).
import { useEffect, useState } from 'react'
import { t } from './i18n'
import { php } from './format'
import Icon from './Icon'
import { Leaf, Wind } from 'lucide-react'

// ── Canal propio del centro: divingslot.com/r/<id> guarda de dónde llega el buceador 7 días ──
const VIA_KEY = 'ds_via'
export function setVia(centerId) { try { localStorage.setItem(VIA_KEY, JSON.stringify({ c: centerId, at: Date.now() })) } catch (e) { /* sin almacenamiento */ } }
export function viaFor(centerId) {
  try {
    const v = JSON.parse(localStorage.getItem(VIA_KEY) || 'null')
    return v && v.c === centerId && Date.now() - v.at < 7 * 864e5 ? centerId : null
  } catch (e) { return null }
}
export const bookingLink = (id) => window.location.origin + '/r/' + id

// ── Precio de una salida: descuento de última hora y tasas incluidas ──
export function unitPrice(trip) {
  const pct = trip?.last_minute_pct || 0
  return Math.floor(((trip?.price_php || 0) * (100 - pct)) / 100)
}
export function LastMinuteTag({ trip }) {
  if (!trip?.last_minute_pct) return null
  return <span className="pill lastmin">{t('Última hora −{n} %', { n: trip.last_minute_pct })}</span>
}
export function PriceTag({ trip }) {
  const unit = unitPrice(trip)
  return unit < trip.price_php
    ? <><s className="muted small">{php(trip.price_php)}</s> <b>{php(unit)}</b></>
    : <b>{php(trip.price_php)}</b>
}

// ── Extras que vende el centro ──
export const EXTRA_KINDS = [['insurance', 'Seguro de buceo'], ['course', 'Curso'], ['photo', 'Fotos'], ['video', 'Vídeo'], ['nitrox', 'Nitrox'], ['other', 'Otro']]
export const extraKind = (k) => t((EXTRA_KINDS.find(([x]) => x === k) || [, k])[1])
export const extrasTotal = (extras, chosen, seats) => extras.filter((e) => chosen.includes(e.id)).reduce((s, e) => s + e.price_php * (e.per_seat ? seats : 1), 0)

// ── Green Fins y prácticas ecológicas ──
export const GREEN_FINS = [['member', 'Miembro de Green Fins'], ['certified', 'Certificado Green Fins'], ['digital', 'Green Fins Digital']]
export const ECO = [
  ['reef_safe', 'Protector solar sin oxibenzona (reef-safe)'],
  ['mooring', 'Boyas de amarre: nunca anclan en el arrecife'],
  ['no_touch', 'No se toca el arrecife ni se usan guantes'],
  ['briefing', 'Briefing ambiental antes de cada inmersión'],
  ['small_groups', 'Grupos pequeños (máx. 4 buceadores por guía)'],
  ['no_feeding', 'No se alimenta ni se persigue a la fauna'],
  ['no_plastic', 'Sin plásticos de un solo uso a bordo'],
  ['cleanups', 'Limpiezas de arrecife o playa'],
]
export function GreenFinsBadge({ level, verified, small }) {
  if (!level) return null
  const name = t((GREEN_FINS.find(([k]) => k === level) || [, 'Green Fins'])[1])
  return (
    <span className={'pill eco' + (small ? ' small' : '')} title={verified ? t('Comprobado por DivingSlot') : t('Declarado por el centro')}>
      <Icon icon={Leaf} size={14} /> {small ? 'Green Fins' : name}{verified ? ' ✓' : ''}
    </span>
  )
}
export function EcoList({ eco }) {
  const on = ECO.filter(([k]) => eco?.[k])
  if (!on.length) return null
  return <ul className="eco-list small">{on.map(([k, n]) => <li key={k}><Icon icon={Leaf} size={14} /> {t(n)}</li>)}</ul>
}

// ── Condiciones del mar (Open-Meteo, vía /api/sea) ──
const LEVEL = {
  good: ['pill ok', 'Buenas condiciones'],
  moderate: ['pill warn', 'Mar algo movido'],
  rough: ['pill bad', 'Posible cancelación por el mar'],
}
export function useSea(tripId) {
  const [d, setD] = useState(null)
  useEffect(() => {
    if (!tripId) return
    let off = false
    fetch('/api/sea?trip=' + encodeURIComponent(tripId), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off) setD(j || false) }).catch(() => { if (!off) setD(false) })
    return () => { off = true }
  }, [tripId])
  return d
}
export function SeaChip({ tripId }) {
  const d = useSea(tripId)
  const f = d?.forecast
  if (!f) return null
  const [cls, label] = LEVEL[f.level] || LEVEL.good
  return <span className={cls} title={seaLine(f)}><Icon icon={Wind} size={14} /> {t(label)}</span>
}
const seaLine = (f) => [
  f.wave_m != null && t('Olas {n} m', { n: f.wave_m }),
  f.wind_kmh != null && t('Viento {n} km/h', { n: f.wind_kmh }) + (f.gust_kmh != null ? ' (' + t('rachas {n}', { n: f.gust_kmh }) + ')' : ''),
].filter(Boolean).join(' · ')
export function SeaCard({ tripId }) {
  const d = useSea(tripId)
  if (!d || (!d.forecast && !d.visibility)) return null
  const f = d.forecast
  const [cls, label] = f ? LEVEL[f.level] || LEVEL.good : []
  return (
    <div className="card stack small sea">
      <div className="row between wrap" style={{ gap: 6 }}>
        <span className="over">{t('Condiciones del mar')}</span>
        {f && <span className={cls}><Icon icon={Wind} size={14} /> {t(label)}</span>}
      </div>
      {f && <>
        <div className="row between"><span className="muted">{t('Olas')}</span><span>{f.wave_m != null ? f.wave_m + ' m' : '—'}{f.swell_m != null ? ' · ' + t('mar de fondo {n} m', { n: f.swell_m }) : ''}{f.period_s ? ' · ' + Math.round(f.period_s) + ' s' : ''}</span></div>
        <div className="row between"><span className="muted">{t('Viento')}</span><span>{f.wind_kmh != null ? f.wind_kmh + ' km/h' : '—'}{f.gust_kmh != null ? ' · ' + t('rachas {n}', { n: f.gust_kmh }) : ''}</span></div>
        {f.rain_pct != null && <div className="row between"><span className="muted">{t('Probabilidad de lluvia')}</span><span>{f.rain_pct} %</span></div>}
        {f.level === 'rough' && <div className="msg warn" role="status" style={{ margin: 0 }}>{t('Con este mar algunos centros cancelan. Si el centro cancela por el mar, se devuelve todo lo pagado.')}</div>}
      </>}
      {d.visibility && <div className="row between"><span className="muted">{t('Visibilidad reciente')}</span><span>~{d.visibility.avg_m} m · {t('{n} inmersiones en la bitácora', { n: d.visibility.n })}</span></div>}
      <span className="muted" style={{ fontSize: 12 }}>{t('Previsión de Open-Meteo para la hora de la salida. Es orientativa: el centro decide si sale.')}</span>
    </div>
  )
}
