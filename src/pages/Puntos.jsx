import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { t } from '../lib/i18n'
import { norm, distKm, kmLabel, currentPosition } from '../lib/geo'
import { loadDestinations, GROUPS, destForArea } from '../lib/places'
import { Link } from '../lib/router'
import SiteCard from '../lib/SiteCard'
import ZonaSwitch from '../lib/ZonaSwitch'
import Icon from '../lib/Icon'
import { LocateFixed, MapPin, X } from 'lucide-react'

// Puntos de buceo de toda Filipinas, agrupados por destino (zona) igual que el directorio de centros
export default function Puntos() {
  const [list, setList] = useState(null)
  const [dests, setDests] = useState([])
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [level, setLevel] = useState('')
  const [error, setError] = useState('')
  const [here, setHere] = useState(null)
  const [locating, setLocating] = useState(false)

  async function nearMe() {
    if (here) return setHere(null)
    setError(''); setLocating(true)
    try { setHere(await currentPosition()) } catch (e) { setError(e.message) }
    setLocating(false)
  }

  useEffect(() => {
    loadDestinations().then(setDests)
    supabase.from('dive_sites').select('id, name, area, province, min_depth_m, max_depth_m, recommended_min, highlight, highlight_es').order('name')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setList(data || []) })
  }, [])

  // Zona = destino desde el que se bucea (Balicasag y Pamilacan van con Panglao, Verde Island con Puerto Galera…)
  const destOf = (s) => destForArea(s.area, dests) || s.area
  const infoOf = (z) => dests.find((d) => d.name === z)
  const groupOf = (s) => infoOf(destOf(s))?.island_group || ''
  const words = norm(q).split(/\s+/).filter(Boolean)
  const shown = (list || [])
    .filter((s) => !group || groupOf(s) === group)
    .filter((s) => !level || s.recommended_min === level)
    .filter((s) => words.every((w) => norm([s.name, s.area, destOf(s), s.province, groupOf(s), s.highlight, s.highlight_es].join(' ')).includes(w)))
  const byDest = shown.reduce((m, s) => { (m[destOf(s)] = m[destOf(s)] || []).push(s); return m }, {})
  const km = (z) => { const d = infoOf(z); return here && d?.lat != null ? distKm(here, { lat: d.lat, lng: d.lng }) : null }
  const groupRank = (z) => { const i = GROUPS.indexOf(infoOf(z)?.island_group); return i < 0 ? GROUPS.length : i }
  // Cerca de mí: por distancia. Si no, por región (de norte a sur) y dentro de cada una las zonas con más puntos primero
  const order = Object.keys(byDest).sort((a, b) => (here ? (km(a) ?? 1e9) - (km(b) ?? 1e9) : 0)
    || groupRank(a) - groupRank(b) || byDest[b].length - byDest[a].length || a.localeCompare(b))
  // Dentro de la zona, primero los puntos del propio destino y luego los de sus islas
  for (const z of order) byDest[z].sort((a, b) => (a.area !== z) - (b.area !== z) || a.area.localeCompare(b.area) || a.name.localeCompare(b.name))
  const groups = GROUPS.filter((g) => dests.some((d) => d.island_group === g))

  return (
    <>
      <h1>{t('Puntos de buceo')}</h1>
      <ZonaSwitch on="puntos" />
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input type="search" className="grow" placeholder={t('Buscar punto, zona o isla…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Buscar punto, zona o isla…')} />
        <button type="button" className={here ? 'btn small' : 'btn small ghost'} style={{ whiteSpace: 'nowrap' }} disabled={locating} onClick={nearMe}>
          {locating ? t('Buscando…') : <><Icon icon={LocateFixed} />{t('Cerca de mí')}{here && <Icon icon={X} />}</>}
        </button>
      </div>
      <div className="chips">
        <button className={!group ? 'on' : ''} onClick={() => setGroup('')}>{t('Todas')}</button>
        {groups.map((g) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g}</button>)}
      </div>
      <div className="chips">
        <button className={!level ? 'on' : ''} onClick={() => setLevel('')}>{t('Cualquier nivel')}</button>
        <button className={level === 'open_water' ? 'on' : ''} onClick={() => setLevel(level === 'open_water' ? '' : 'open_water')}>{t('Para Open Water')}</button>
        <button className={level === 'advanced' ? 'on' : ''} onClick={() => setLevel(level === 'advanced' ? '' : 'advanced')}>{t('Para Advanced')}</button>
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      {list === null && <p className="muted">{t('Cargando…')}</p>}
      {list && (
        <p className="small muted">
          {shown.length === 1 ? t('1 punto') : t('{n} puntos', { n: shown.length })} · {order.length === 1 ? t('1 zona') : t('{n} zonas', { n: order.length })}
        </p>
      )}
      {list && shown.length === 0 && <div className="card center muted">{t('No hay puntos de buceo que coincidan con tu búsqueda.')}</div>}
      {order.map((z) => {
        const d = infoOf(z)
        const k = km(z)
        return (
          <div key={z}>
            <h2>
              <Icon icon={MapPin} /> {d ? <Link to={'/d/' + encodeURIComponent(z)} style={{ color: 'inherit' }}>{z}</Link> : z}
              <span className="muted small" style={{ fontWeight: 400 }}>{d?.province ? ', ' + d.province : ''} · {byDest[z].length}{k != null ? ' · ' + kmLabel(k) : ''}</span>
            </h2>
            {byDest[z].map((s) => <SiteCard key={s.id} site={s} sub={s.area !== z ? s.area : null} />)}
            {d && <Link to={'/d/' + encodeURIComponent(z)} className="small">{t('Centros y salidas en {zona}', { zona: z })}</Link>}
          </div>
        )
      })}
      <div className="card small muted" style={{ marginTop: 16 }}>
        {t('La profundidad y el nivel son orientativos. El centro decide cada día el punto según el mar y el grupo.')}
      </div>
    </>
  )
}
