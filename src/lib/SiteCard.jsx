import { t, getLang } from './i18n'
import { levelName } from './format'

// Tarjeta de un punto de buceo: nombre, nivel recomendado, profundidad y qué se ve.
// sub: zona del punto cuando no es la del destino (p. ej. Balicasag dentro de Panglao)
export default function SiteCard({ site: s, sub }) {
  const depth = s.min_depth_m != null && s.max_depth_m ? t('{a}–{b} m', { a: s.min_depth_m, b: s.max_depth_m })
    : s.max_depth_m ? t('hasta {b} m', { b: s.max_depth_m }) : ''
  const highlight = s.highlight ? (getLang() === 'es' ? (s.highlight_es || s.highlight) : s.highlight) : ''
  return (
    <div className="card">
      <div className="row between wrap" style={{ gap: 6 }}>
        <b>{s.name}</b>
        <span className={s.recommended_min === 'advanced' ? 'pill warn' : 'pill'}>{levelName(s.recommended_min)}</span>
      </div>
      <div className="small muted">
        {[sub, depth, highlight].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}
