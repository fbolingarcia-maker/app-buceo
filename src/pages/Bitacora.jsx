import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { dayLabel, manilaDate, depthColor, TZ } from '../lib/format'
import { t, locale } from '../lib/i18n'
import Icon from '../lib/Icon'
import DepthBar from '../lib/DepthBar'
import { ChevronRight, PencilLine, Star, Waves } from 'lucide-react'

// Descarga la bitácora como CSV (se abre en Excel / Google Sheets)
function exportCsv(logs) {
  const cols = ['dive_date', 'entry_time', 'site_name', 'max_depth_m', 'avg_depth_m', 'duration_min', 'water_temp_c', 'visibility_m', 'gas', 'o2_pct', 'tank_start_bar', 'tank_end_bar', 'weights_kg', 'suit', 'buddy', 'conditions', 'marine_life', 'rating', 'notes']
  const esc = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))
  const rows = [cols.join(','), ...[...logs].reverse().map((l) => cols.map((c) => esc(l[c])).join(','))]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
  a.download = 'divingslot-bitacora.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// Hitos: el próximo es el de mayor progreso sin conseguir (inmersiones, profundidad, horas y puntos distintos)
function nextMilestone({ total, maxDepth, hours, nSites }) {
  const cats = [
    [total, [1, 10, 25, 50, 100, 200, 500], (n) => t('{n} inmersiones', { n })],
    [maxDepth, [18, 30, 40], (n) => t('{n} m de profundidad', { n })],
    [hours, [10, 50, 100], (n) => t('{n} h bajo el agua', { n })],
    [nSites, [5, 10, 25], (n) => t('{n} puntos distintos', { n })],
  ]
  return cats.map(([value, goals, label]) => {
    const goal = goals.find((g) => value < g)
    return goal && { value: Math.floor(value), label: label(goal), pct: Math.min(100, (value / goal) * 100) }
  }).filter(Boolean).sort((a, b) => b.pct - a.pct)[0] || null
}

// Fila de una cifra grande con su unidad y etiqueta
const Stat = ({ v, unit, label }) => <div><b>{v}{unit && <small>{unit}</small>}</b><span>{label}</span></div>

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
  const total = appDives + (diver.logged_dives || 0)
  const maxDepth = Math.max(0, ...logs.map((l) => +l.max_depth_m || 0))
  const minutes = logs.reduce((s, l) => s + (l.duration_min || 0), 0)
  const sites = {}
  logs.forEach((l) => { if (l.site_name) sites[l.site_name] = (sites[l.site_name] || 0) + 1 })
  const fav = Object.entries(sites).sort((a, b) => b[1] - a[1])[0]?.[0]
  const next = appDives > 0 ? nextMilestone({ total, maxDepth, hours: minutes / 60, nSites: Object.keys(sites).length }) : null
  // La inmersión récord (la más profunda): solo la primera que alcanza la profundidad máxima
  const recordId = maxDepth > 0 ? logs.find((l) => +l.max_depth_m === maxDepth)?.id : null
  const Record = () => <span className="record">{t('récord')}</span>

  const feat = logs[0]
  const rest = logs.slice(1)
  const months = []
  for (const l of rest) {
    const key = (l.dive_date || '').slice(0, 7)
    if (!months.length || months[months.length - 1].key !== key) months.push({ key, logs: [] })
    months[months.length - 1].logs.push(l)
  }
  const monthName = (key) => new Intl.DateTimeFormat(locale(), { timeZone: TZ, month: 'long', year: 'numeric' }).format(new Date(key + '-15T12:00:00+08:00'))

  const pending = pendingTrips.length > 0 && (
    <div className="list pending">
      {pendingTrips.map((b) => (
        <Link key={b.id} to={`/bitacora/nueva?booking=${b.id}`} className="li">
          <span className="tile"><PencilLine size={20} /></span>
          <span className="grow">
            <b>{t('Registra tu salida del {dia}', { dia: dayLabel(manilaDate(new Date(b.trips.departs_at)), { weekday: 'long' }) })}</b>
            <small>{b.trips.centers?.name} · {t('{n} inmersiones', { n: b.trips.num_dives })}</small>
          </span>
          <ChevronRight size={18} />
        </Link>
      ))}
    </div>
  )

  return (
    <>
      <div className="row between">
        <h1>{t('Mi bitácora')}</h1>
        <div className="row" style={{ gap: 6 }}>
          {logs.length > 0 && <button className="btn small ghost" onClick={() => exportCsv(logs)}>{t('Exportar CSV')}</button>}
          <Link to="/bitacora/nueva" className="btn small">{t('+ Inmersión')}</Link>
        </div>
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}

      <div className="card log-stats">
        <div className="statrow">
          <Stat v={total} label={t('inmersiones')} />
          <Stat v={maxDepth || '—'} unit={maxDepth ? 'm' : null} label={t('prof. máxima')} />
          <Stat v={Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0')} unit="h" label={t('bajo el agua')} />
        </div>
        {next && <>
          <div className="hr" />
          <div className="row between"><span className="over">{t('Próximo hito')}</span><span className="small muted"><b className="data">{next.value}</b> {t('de {meta}', { meta: next.label })}</span></div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(next.pct)} aria-label={t('Próximo hito')}><i style={{ width: next.pct + '%' }} /></div>
        </>}
        {fav && <p className="small muted" style={{ margin: '10px 0 0' }}>{t('Punto favorito:')} <b>{fav}</b></p>}
      </div>

      {!feat && pending}
      {logs.length === 0 && pendingTrips.length === 0 && (
        <div className="card center muted">
          <p style={{ marginTop: 0 }}>{t('Aún no has registrado inmersiones. Pulsa «+ Inmersión» para añadir la primera.')}</p>
          <Link to="/bitacora/nueva" className="btn">{t('+ Inmersión')}</Link>
        </div>
      )}

      {feat && (
        <Link to={'/bitacora/' + feat.id} className="card log-feat">
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="feat-thumb">
              {thumbs[feat.id] ? <img src={thumbs[feat.id]} alt="" /> : <Waves size={26} strokeWidth={1.75} aria-hidden="true" />}
              {feat.dive_log_photos?.length > 0 && <span className="feat-count">{feat.dive_log_photos.length}</span>}
            </span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="row between" style={{ gap: 8, alignItems: 'baseline' }}>
                <b className="feat-title">{feat.site_name || t('Inmersión')}</b>
                <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{t('Inmersión {n}', { n: total })}</span>
              </span>
              <span className="small muted" style={{ display: 'block' }}>{dayLabel(feat.dive_date)}{feat.centers?.name ? ' · ' + feat.centers.name : ''}</span>
              {(feat.rating > 0 || feat.id === recordId) && (
                <span className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                  {feat.rating > 0 && <span className="coral-tag"><Star size={13} strokeWidth={2} aria-hidden="true" /> {feat.rating}{feat.marine_life ? ' · ' + feat.marine_life.split(',')[0].trim().slice(0, 28) : ''}</span>}
                  {feat.id === recordId && <Record />}
                </span>
              )}
            </span>
          </div>
          {(feat.max_depth_m || feat.duration_min || feat.water_temp_c) && (
            <div className="statrow feat-stats">
              {feat.max_depth_m ? <Stat v={+feat.max_depth_m} unit="m" label={t('máxima')} /> : null}
              {feat.duration_min ? <Stat v={feat.duration_min} unit="min" label={t('tiempo')} /> : null}
              {feat.water_temp_c ? <Stat v={+feat.water_temp_c} unit="°C" label={t('agua')} /> : null}
            </div>
          )}
          {feat.max_depth_m ? <>
            <DepthBar min={0} max={+feat.max_depth_m} />
            <div className="feat-axis" aria-hidden="true"><span style={{ left: 0 }}>0</span><span style={{ left: '45%' }}>18</span><span style={{ left: '75%' }}>30</span><span style={{ left: '100%' }}>40 m</span></div>
          </> : null}
        </Link>
      )}
      {feat && pending}

      {months.map((m) => (
        <section key={m.key}>
          <div className="over" style={{ margin: '20px 0 8px' }}>{monthName(m.key)}</div>
          <div className="list" style={{ marginTop: 0 }}>
            {m.logs.map((l) => {
              const d = +l.max_depth_m || 0
              return (
                <Link key={l.id} to={'/bitacora/' + l.id} className="li log-row">
                  <span className="log-date"><b>{dayLabel(l.dive_date, { day: 'numeric' })}</b><small>{dayLabel(l.dive_date, { weekday: 'short' })}</small></span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <b className="log-site">{l.site_name || t('Inmersión')}</b>
                    <small>{[l.centers?.name, l.duration_min ? l.duration_min + ' min' : null].filter(Boolean).join(' · ') || '—'}</small>
                  </span>
                  <span className="log-depth">
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>{l.id === recordId && <Record />}<b>{d ? d + ' m' : '—'}</b></span>
                    {d > 0 && <i style={{ width: Math.min(100, (d / 40) * 100) + '%', background: depthColor(d) }} />}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
