import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from '../lib/router'
import { t } from '../lib/i18n'
import SiteCard from '../lib/SiteCard'
import { loadDestinations, openTripsIn, loadRatings, EXTRA_AREAS } from '../lib/places'
import Icon from '../lib/Icon'
import { ArrowLeft } from 'lucide-react'

// Página de un destino: puntos de buceo, centros y acceso a sus salidas
export default function Destino({ name }) {
  const [dest, setDest] = useState(null)
  const [sites, setSites] = useState(null)
  const [centers, setCenters] = useState([])
  const [count, setCount] = useState(null)
  const [ratings, setRatings] = useState({})

  useEffect(() => {
    loadDestinations().then((ds) => setDest(ds.find((d) => d.name === name) || false))
    loadRatings().then(setRatings)
    const areas = [name, ...(EXTRA_AREAS[name] || [])]
    supabase.from('dive_sites').select('*').in('area', areas).order('name').then(({ data }) => setSites((data || []).sort((a, b) => (a.area !== name) - (b.area !== name) || a.area.localeCompare(b.area) || a.name.localeCompare(b.name))))
    supabase.from('centers').select('id, name, locality, listing_status, verification_status').eq('destination', name).neq('listing_status', 'cerrado').not('name', 'like', 'Demo%')
      // Los centros dados de alta solo se ven cuando DivingSlot los ha verificado
      .or('listing_status.neq.socio,verification_status.eq.verified').order('name')
      .then(({ data }) => setCenters(data || []))
    supabase.from('published_trips').select('id', { count: 'exact', head: true }).eq('center_destination', name).gte('departs_at', new Date().toISOString())
      .then(({ count }) => setCount(count ?? 0))
  }, [name])

  if (dest === null) return <p className="muted">{t('Cargando…')}</p>
  if (dest === false) return <div className="card">{t('Destino no encontrado.')} <Link to="/">{t('Ver salidas')}</Link></div>

  return (
    <>
      <Link to="/" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Salidas')}</Link>
      <h1 style={{ marginTop: 8, marginBottom: 2 }}>{dest.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{dest.province} · {dest.island_group}</p>

      <div className="card row between wrap" style={{ gap: 8 }}>
        <span>{count === null ? '…' : count === 1 ? t('1 salida próxima') : t('{n} salidas próximas', { n: count })}</span>
        <button className="btn small" onClick={() => openTripsIn({ kind: 'dest', name: dest.name })}>{t('Ver salidas aquí')}</button>
      </div>

      <h2>{t('Puntos de buceo')}{sites?.length ? <span className="muted small" style={{ fontWeight: 400 }}> · {sites.length}</span> : null}</h2>
      {sites === null && <p className="muted">{t('Cargando…')}</p>}
      {sites && sites.length === 0 && <div className="card muted">{t('Aún no hay puntos de buceo registrados en este destino.')}</div>}
      {sites?.map((s) => <SiteCard key={s.id} site={s} sub={s.area !== dest.name ? s.area : null} />)}

      <h2>{t('Centros de buceo')} <span className="muted small" style={{ fontWeight: 400 }}>· {centers.length}</span></h2>
      {centers.map((c) => (
        <Link key={c.id} to={'/c/' + c.id} className="card row between" style={{ gap: 8 }}>
          <span><b>{c.name}</b>{c.locality && c.locality !== dest.name ? <span className="small muted"> · {c.locality}</span> : null}</span>
          <span className="row" style={{ gap: 6 }}>
            {ratings[c.id] && <span className="small">★ {ratings[c.id].rating}</span>}
            {c.listing_status === 'socio' && <span className="pill ok">{t('Reserva en la app')}</span>}
          </span>
        </Link>
      ))}
    </>
  )
}
