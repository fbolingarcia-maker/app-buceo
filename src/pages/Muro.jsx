// Muro (11 nov): inmersiones de quien sigues, avistamientos de tus centros y sus próximas salidas
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../lib/i18n'
import { Link } from '../lib/router'
import { php, dayLabel, time, manilaDate } from '../lib/format'
import { when, activityName, Sightings } from '../lib/comunidad'
import Icon from '../lib/Icon'
import { Fish, Waves, Ship } from 'lucide-react'

export default function Muro() {
  const [feed, setFeed] = useState(null)
  const [fol, setFol] = useState(null)
  useEffect(() => {
    supabase.rpc('feed', {}).then(({ data }) => setFeed(data || { items: [], trips: [] }))
    supabase.rpc('my_follows', {}).then(({ data }) => setFol(data || { divers: [], centers: [] }))
  }, [])
  if (!feed || !fol) return <p className="muted">{t('Cargando…')}</p>
  const empty = !feed.items.length && !feed.trips.length
  return (
    <>
      <div className="seg" role="group" aria-label={t('Bitácora')}>
        <Link to="/bitacora">{t('Mi bitácora')}</Link>
        <Link to="/muro" className="on" aria-current="page">{t('Muro')}</Link>
      </div>
      <h1>{t('Muro')}</h1>
      <p className="small muted" style={{ marginTop: -6 }}>{t('Sigues a {d} buceadores y {c} centros.', { d: fol.divers.length, c: fol.centers.length })}</p>
      {empty && <div className="card muted">{t('Sigue a centros desde su ficha y a buceadores con perfil público desde «¿Quién va?» o el ranking de un destino. Aquí verás sus inmersiones, avistamientos y salidas.')}</div>}
      {feed.trips.length > 0 && (
        <section>
          <h2 className="row" style={{ gap: 6 }}><Icon icon={Ship} size={20} /> {t('Próximas salidas de tus centros')}</h2>
          {feed.trips.map((x) => (
            <Link key={x.id} to={'/salida/' + x.id} className="card row between" style={{ marginBottom: 8, textDecoration: 'none', color: 'inherit' }}>
              <span><b>{x.center_name}</b><br /><span className="small muted">{dayLabel(manilaDate(new Date(x.departs_at)), { weekday: 'short', day: 'numeric' })} · {time(x.departs_at)} · {x.kind === 'course' ? x.course_name || t('Curso') : x.activity && x.activity !== 'scuba' ? activityName(x.activity) : x.sites.join(', ')}</span></span>
              <span className="small">{php(x.price_php)}<br />{t('{n} libres', { n: x.available_seats })}</span>
            </Link>
          ))}
        </section>
      )}
      {feed.items.length > 0 && <h2>{t('Novedades')}</h2>}
      {feed.items.map((i) => i.type === 'log' ? (
        <div key={'l' + i.id} className="card feed-item" style={{ marginBottom: 8 }}>
          <span><Icon icon={Waves} size={14} /> <Link to={'/buzo/' + i.diver_id} className="who">{i.who}</Link> {t('ha buceado en {site}', { site: i.site || '—' })}</span>
          <span className="small muted">{[i.area, i.max_depth_m != null ? i.max_depth_m + ' m' : null, i.duration_min ? i.duration_min + ' min' : null, i.center_name, when(i.created_at)].filter(Boolean).join(' · ')}</span>
          {i.marine_life && <span className="small">{i.marine_life}</span>}
        </div>
      ) : (
        <div key={'s' + i.id} className="card feed-item" style={{ marginBottom: 8 }}>
          <span><Icon icon={Fish} size={14} /> <b>{t(i.species)}</b> {t('en {site}', { site: i.site })}</span>
          <span className="small muted">{[i.area, i.center_name, dayLabel(i.seen_on, { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</span>
          {i.note && <span className="small">{i.note}</span>}
        </div>
      ))}
      <Sightings days={7} allowAdd={false} />
      {fol.centers.length > 0 && <><h2>{t('Centros que sigues')}</h2><p className="small">{fol.centers.map((c, k) => <span key={c.id}>{k ? ' · ' : ''}<Link to={'/c/' + c.id}>{c.name}</Link></span>)}</p></>}
      {fol.divers.length > 0 && <><h2>{t('Buceadores que sigues')}</h2><p className="small">{fol.divers.map((d, k) => <span key={d.id}>{k ? ' · ' : ''}<Link to={'/buzo/' + d.id}>{d.name}</Link></span>)}</p></>}
    </>
  )
}
