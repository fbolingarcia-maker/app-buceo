import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { dayLabel, dateTime } from '../lib/format'
import { t } from '../lib/i18n'

export default function Bitacora() {
  const { diver } = useAuth()
  const [logs, setLogs] = useState(null)
  const [thumbs, setThumbs] = useState({})
  const [pendingTrips, setPendingTrips] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!diver) return
    supabase.from('dive_logs').select('*, centers(name), dive_log_photos(path)').eq('diver_id', diver.id)
      .order('dive_date', { ascending: false }).order('entry_time', { ascending: false, nullsFirst: false })
      .then(async ({ data, error }) => {
        if (error) setError(errMsg(error))
        setLogs(data || [])
        const first = (data || []).filter((l) => l.dive_log_photos?.length).map((l) => [l.id, l.dive_log_photos[0].path])
        if (first.length) {
          const { data: urls } = await supabase.storage.from('dive-photos').createSignedUrls(first.map((x) => x[1]), 3600)
          setThumbs(Object.fromEntries(first.map(([id], i) => [id, urls?.[i]?.signedUrl])))
        }
      })
    // Salidas ya hechas sin registrar en la bitácora
    Promise.all([
      supabase.from('bookings').select('id, trips(departs_at, num_dives, centers(name))').eq('diver_id', diver.id).eq('status', 'confirmed'),
      supabase.from('dive_logs').select('booking_id').eq('diver_id', diver.id).not('booking_id', 'is', null),
    ]).then(([b, l]) => {
      const logged = new Set((l.data || []).map((x) => x.booking_id))
      setPendingTrips((b.data || []).filter((x) => x.trips && new Date(x.trips.departs_at) < new Date() && !logged.has(x.id)))
    })
  }, [diver])

  if (!diver || logs === null) return <p className="muted">{t('Cargando bitácora…')}</p>

  const appDives = logs.length
  const maxDepth = Math.max(0, ...logs.map((l) => +l.max_depth_m || 0))
  const minutes = logs.reduce((s, l) => s + (l.duration_min || 0), 0)
  const sites = {}
  logs.forEach((l) => { if (l.site_name) sites[l.site_name] = (sites[l.site_name] || 0) + 1 })
  const fav = Object.entries(sites).sort((a, b) => b[1] - a[1])[0]?.[0]

  return (
    <>
      <div className="row between">
        <h1>{t('Mi bitácora')}</h1>
        <Link to="/bitacora/nueva" className="btn small">{t('+ Inmersión')}</Link>
      </div>
      {error && <div className="msg err">{error}</div>}

      <div className="stats">
        <div><b>{appDives + (diver.logged_dives || 0)}</b><span>{diver.logged_dives ? t('inmersiones ({n} aquí)', { n: appDives }) : t('inmersiones')}</span></div>
        <div><b>{maxDepth ? `${maxDepth} m` : '—'}</b><span>{t('prof. máxima')}</span></div>
        <div><b>{minutes ? t('{h} h {m} min', { h: Math.floor(minutes / 60), m: minutes % 60 }) : '—'}</b><span>{t('bajo el agua')}</span></div>
      </div>
      {fav && <p className="small muted" style={{ marginTop: -4 }}>{t('Punto favorito:')} <b>{fav}</b></p>}

      {pendingTrips.map((b) => (
        <Link key={b.id} to={`/bitacora/nueva?booking=${b.id}`} className="card" style={{ borderColor: 'var(--accent)' }}>
          <b>📝 {t('Registra tus inmersiones')}</b>
          <div className="small muted">{b.trips.centers?.name} · {dateTime(b.trips.departs_at)} · {t('{n} inmersiones', { n: b.trips.num_dives })}</div>
        </Link>
      ))}

      {logs.length === 0 && pendingTrips.length === 0 && (
        <div className="card center muted">{t('Aún no has registrado inmersiones. Pulsa «+ Inmersión» para añadir la primera.')}</div>
      )}
      {logs.map((l, i) => (
        <Link key={l.id} to={'/bitacora/' + l.id} className="card row" style={{ alignItems: 'stretch' }}>
          {thumbs[l.id] && <img src={thumbs[l.id]} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />}
          <div className="grow">
            <div className="row between">
              <b>#{logs.length - i + (diver.logged_dives || 0)} · {l.site_name || t('Inmersión')}</b>
              <span className="small">{l.rating ? '★'.repeat(l.rating) : ''}</span>
            </div>
            <div className="small muted">
              {dayLabel(l.dive_date)}{l.centers?.name ? ` · ${l.centers.name}` : ''}
            </div>
            <div className="small" style={{ marginTop: 4 }}>
              {l.max_depth_m ? `⬇ ${l.max_depth_m} m` : ''}{l.duration_min ? ` · ⏱ ${l.duration_min} min` : ''}{l.water_temp_c ? ` · 🌡 ${l.water_temp_c} °C` : ''}
              {l.dive_log_photos?.length ? ` · 📷 ${l.dive_log_photos.length}` : ''}
            </div>
          </div>
        </Link>
      ))}
    </>
  )
}
