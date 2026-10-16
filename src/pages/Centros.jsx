import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { t } from '../lib/i18n'
import { norm, distKm, kmLabel, currentPosition } from '../lib/geo'
import { loadDestinations, GROUPS, loadRatings } from '../lib/places'
import { Link } from '../lib/router'
import { Flags } from '../lib/langs'

export default function Centros() {
  const [list, setList] = useState(null)
  const [dests, setDests] = useState([])
  const [ratings, setRatings] = useState({})
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
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
    loadRatings().then(setRatings)
    supabase.from('centers').select('id, name, area, locality, destination, province, website, phone, listing_status, lat, lng, source_url, languages')
      .neq('listing_status', 'cerrado').not('name', 'like', 'Demo%').order('name')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setList(data || []) })
  }, [])

  const destOf = (c) => c.destination || c.area || t('Otros')
  const groupOf = (c) => dests.find((d) => d.name === destOf(c))?.island_group || ''
  const words = norm(q).split(/\s+/).filter(Boolean)
  const shown = (list || [])
    .filter((c) => !group || groupOf(c) === group)
    .filter((c) => words.every((w) => norm([c.name, c.locality, destOf(c), c.province, groupOf(c)].join(' ')).includes(w)))
    .map((c) => ({ ...c, km: here && c.lat != null ? distKm(here, { lat: c.lat, lng: c.lng }) : null }))
  const byDest = shown.reduce((m, c) => { (m[destOf(c)] = m[destOf(c)] || []).push(c); return m }, {})
  const destKm = (z) => Math.min(...byDest[z].map((c) => c.km ?? 1e9))
  const order = Object.keys(byDest).sort((a, b) => (here ? destKm(a) - destKm(b) : 0) || byDest[b].length - byDest[a].length || a.localeCompare(b))
  // Socios (reservan en la app) primero dentro de cada destino
  for (const k of order) byDest[k].sort((a, b) => (b.listing_status === 'socio') - (a.listing_status === 'socio') || a.name.localeCompare(b.name))
  const groups = GROUPS.filter((g) => dests.some((d) => d.island_group === g))

  return (
    <>
      <h1>{t('Centros de buceo en Filipinas')}</h1>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input type="search" className="grow" placeholder={t('Buscar centro, zona o isla…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={here ? 'btn small' : 'btn small ghost'} style={{ whiteSpace: 'nowrap' }} disabled={locating} onClick={nearMe}>
          {locating ? t('Buscando…') : here ? t('📍 Cerca de mí ✕') : t('📍 Cerca de mí')}
        </button>
      </div>
      <div className="chips">
        <button className={!group ? 'on' : ''} onClick={() => setGroup('')}>{t('Todas')}</button>
        {groups.map((g) => <button key={g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g}</button>)}
      </div>
      {error && <div className="msg err">{error}</div>}
      {list === null && <p className="muted">{t('Cargando…')}</p>}
      {list && <p className="small muted">{shown.length === 1 ? t('1 centro') : t('{n} centros', { n: shown.length })}</p>}
      {list && shown.length === 0 && <div className="card center muted">{t('No hay centros que coincidan con tu búsqueda.')}</div>}
      {order.map((z) => (
        <div key={z}>
          <h2>
            📍 <Link to={'/d/' + encodeURIComponent(z)} style={{ color: 'inherit' }}>{z}</Link><span className="muted small" style={{ fontWeight: 400 }}>{byDest[z][0].province ? ', ' + byDest[z][0].province : ''} · {byDest[z].length}{here && destKm(z) < 1e9 ? ' · ' + kmLabel(destKm(z)) : ''}</span>
          </h2>
          {byDest[z].map((c) => (
            <div key={c.id} className="card">
              <div className="row between" style={{ gap: 8 }}>
                <Link to={'/c/' + c.id} style={{ color: 'inherit' }}><b>{c.name}</b> <Flags codes={c.languages} />{ratings[c.id] && <span className="small"> · ⭐ {ratings[c.id].rating}</span>}</Link>
                {c.listing_status === 'socio' ? <span className="pill ok">{t('Reserva en la app')}</span> : <span className="pill">{t('Próximamente')}</span>}
              </div>
              {c.locality && c.locality !== z && <div className="small muted">{c.locality}</div>}
              <div className="row wrap small" style={{ marginTop: 6, gap: 14 }}>
                {c.website ? <a href={c.website} target="_blank" rel="noreferrer">{t('Web')}</a> : c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer">{t('Más información')}</a>}
                {c.lat && c.lng && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.name + ' ' + z)}`} target="_blank" rel="noreferrer">{t('Mapa')}</a>}
                {c.phone && <a href={'https://wa.me/' + c.phone.replace(/\D/g, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="card small muted" style={{ marginTop: 16 }}>
        {t('¿Gestionas un centro de buceo? Crea una cuenta de centro y, si ya apareces aquí, escribe el mismo nombre para reclamar tu ficha.')}
      </div>
    </>
  )
}
