// Mi mapa (Bitácora, 26 nov 2026): los puntos de buceo de Filipinas donde ha buceado el buceador, la ruta entre ellos
// por orden de fecha, «N de 179 puntos», km entre puntos, destinos y el avance en cada destino.
// «Mi ruta en vídeo» (mapVideo.js) la cuenta como un reel; también hay imagen fija. Todo se genera en el móvil.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { t, getLang, locale } from './i18n'
import { Link } from './router'
import { norm, distKm } from './geo'
import { loadDestinations, destForArea } from './places'
import { dayLabel } from './format'
import { MapView } from './plus'
import Icon from './Icon'
import { MapPin, Share, X, Play, Image as ImageIcon, Download } from 'lucide-react'

let sitesCache = null
const loadSites = () => (sitesCache ||= supabase.from('dive_sites').select('id, name, area, lat, lng, highlight, highlight_es').then(({ data }) => (data || []).filter((s) => s.lat != null)))

const key = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim()

// Une cada inmersión con un punto del mapa: por site_id o, si se escribió a mano, por el nombre
export function matchLogs(logs, sites) {
  const byId = new Map(sites.map((s) => [s.id, s]))
  const byKey = new Map(sites.map((s) => [key(s.name), s]))
  return logs.map((l) => {
    if (l.site_id && byId.has(l.site_id)) return [l, byId.get(l.site_id)]
    const k = key(l.site_name)
    if (!k) return [l, null]
    if (byKey.has(k)) return [l, byKey.get(k)]
    if (k.length >= 6) {
      const c = sites.filter((s) => key(s.name).includes(k))
      if (c.length === 1) return [l, c[0]]
    }
    return [l, null]
  })
}

export function mapStats(logs, sites, dests) {
  const pairs = matchLogs(logs, sites).filter(([, s]) => s)
    .sort((a, b) => (a[0].dive_date + (a[0].entry_time || '')).localeCompare(b[0].dive_date + (b[0].entry_time || '')))
  const visits = {}
  const route = [], routeMins = [] // minutos de buceo acumulados al terminar cada tramo de la ruta
  let mins = 0, maxDepth = 0
  for (const [l, s] of pairs) {
    const v = (visits[s.id] ||= { n: 0, first: l.dive_date, last: l.dive_date, logs: [], mins: 0, max: 0 })
    v.n++; v.last = l.dive_date; v.logs.push(l.id)
    const d = +l.duration_min || 0, m = +l.max_depth_m || 0
    v.mins += d; v.max = Math.max(v.max, m); mins += d; maxDepth = Math.max(maxDepth, m)
    if (route[route.length - 1]?.id !== s.id) route.push(s)
    routeMins[route.length - 1] = mins
  }
  let km = 0
  for (let i = 1; i < route.length; i++) km += distKm(route[i - 1], route[i])
  const destOf = (s) => destForArea(s.area, dests) || s.area
  // Avance por destino: puntos buceados / puntos del destino (con sus islas)
  const byDest = {}
  for (const s of sites) { const d = destOf(s); (byDest[d] ||= { name: d, total: 0, done: 0 }).total++; if (visits[s.id]) byDest[d].done++ }
  const destList = Object.values(byDest).filter((d) => d.done).sort((a, b) => b.done / b.total - a.done / a.total || b.done - a.done)
  return {
    visits, route, routeMins, km: Math.round(km), dives: pairs.length, minutes: mins, maxDepth,
    years: pairs.length ? [pairs[0][0].dive_date.slice(0, 4), pairs[pairs.length - 1][0].dive_date.slice(0, 4)] : null,
    sites: Object.keys(visits).length, total: sites.length,
    dests: destList.length, destList,
    unmatched: logs.length - pairs.length, destOf,
  }
}

function Ring({ pct, size = 52 }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r
  return (
    <svg className="mymap-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--laguna)" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${Math.max(pct, 0.01) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file] })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// Ventana del vídeo: se graba mientras se ve; al acabar se puede compartir o descargar
function VideoMaker({ st, sites, thumbs, dests, name, onClose }) {
  const canvas = useRef(null)
  const ctrl = useRef(null)
  const [phase, setPhase] = useState('prep') // prep | rec | done | err
  const [pct, setPct] = useState(0)
  const [out, setOut] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    ctrl.current = new AbortController()
    ;(async () => {
      try {
        const V = await import('./mapVideo')
        // La primera foto de la bitácora en cada punto
        const photoUrls = {}
        for (const s of Object.keys(st.visits)) { const id = st.visits[s].logs.find((l) => thumbs[l]); if (id) photoUrls[s] = thumbs[id] }
        const o = await V.prepare({ st, sites, photoUrls, lang: getLang(), dests, name })
        if (!alive) return
        const setup = await V.encoderConfig()
        if (!setup && !V.videoMime()) {
          // Sin grabadora (navegadores antiguos): se ofrece la imagen fija
          const blob = await V.still(o); setOut({ blob, name: 'divingslot-mi-mapa.png', url: URL.createObjectURL(blob), image: true }); setPhase('done'); return
        }
        setPhase('rec')
        const opts = { onProgress: (p) => alive && setPct(p), signal: ctrl.current.signal }
        // Fotograma a fotograma (WebCodecs, 60 fps) y, si falla o no existe, grabación en tiempo real
        let res = null
        if (setup) { try { res = await V.exportMp4(canvas.current, o, { ...opts, setup }) } catch (e) { if (e?.name === 'AbortError') throw e } }
        if (!res) res = await V.record(canvas.current, o, opts)
        const { blob, mime } = res
        if (!alive) return
        setOut({ blob, name: 'divingslot-mi-ruta.' + (mime.includes('mp4') ? 'mp4' : 'webm'), url: URL.createObjectURL(blob) })
        setPhase('done')
      } catch (e) {
        if (alive && e?.name !== 'AbortError') { setErr(t('No se ha podido crear el vídeo. Inténtalo de nuevo.')); setPhase('err') }
      }
    })()
    return () => { alive = false; ctrl.current?.abort() }
  }, [st, sites, thumbs, dests, name])
  useEffect(() => () => out && URL.revokeObjectURL(out.url), [out])
  return (
    <div className="modal video-maker" role="dialog" aria-modal="true" aria-label={t('Mi ruta en vídeo')}>
      <div className="modal-card">
        <button type="button" className="modal-x" onClick={onClose} aria-label={t('Cerrar')}><Icon icon={X} /></button>
        <h2 style={{ marginTop: 0 }}>{t('Mi ruta en vídeo')}</h2>
        {phase === 'done' && out ? (
          out.image ? <img className="vm-screen" src={out.url} alt={t('Mi mapa de buceo')} />
            : <video className="vm-screen" src={out.url} controls autoPlay loop playsInline muted />
        ) : <canvas ref={canvas} className="vm-screen" width={1080} height={1920} />}
        {phase === 'prep' && <p className="small muted">{t('Preparando el mapa…')}</p>}
        {phase === 'rec' && <p className="small muted">{t('Creando el vídeo… {p} %', { p: Math.min(100, Math.round(pct * 100)) })}</p>}
        {phase === 'done' && out?.image && <p className="small muted">{t('Este navegador no puede grabar vídeo: aquí tienes la imagen.')}</p>}
        {err && <div className="msg err" role="alert">{err}</div>}
        {phase === 'done' && out && (
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => shareOrDownload(out.blob, out.name).catch(() => {})}><Icon icon={Share} size={16} /> {t('Compartir')}</button>
            <a className="btn ghost" href={out.url} download={out.name}><Icon icon={Download} size={16} /> {t('Descargar')}</a>
          </div>
        )}
      </div>
    </div>
  )
}

export function MiMapa({ logs, thumbs = {}, name = '' }) {
  const [sites, setSites] = useState(null)
  const [dests, setDests] = useState([])
  const [sel, setSel] = useState(null)
  const [all, setAll] = useState(false)
  const [video, setVideo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { loadSites().then(setSites); loadDestinations().then(setDests) }, [])
  const st = useMemo(() => (sites ? mapStats(logs, sites, dests) : null), [logs, sites, dests])
  if (!st) return null
  const last = st.route[st.route.length - 1]
  const site = sites.find((s) => s.id === sel)
  const v = site && st.visits[site.id]
  const shown = sites.filter((s) => all || st.visits[s.id] || st.sites === 0)
  const points = shown.map((s) => {
    const n = st.visits[s.id]?.n || 0
    return { id: s.id, lat: s.lat, lng: s.lng, weight: n, badge: n || '', cls: n ? 'visit' : 'dot', label: s.name + (n ? ' · ' + (n === 1 ? t('1 inmersión') : t('{n} inmersiones', { n })) : '') }
  })
  const hl = (s) => (getLang() === 'es' ? s.highlight_es : s.highlight)
  const thumbOf = (s) => { const id = st.visits[s.id]?.logs.find((l) => thumbs[l]); return id ? thumbs[id] : null }

  async function image() {
    setBusy(true); setMsg('')
    try {
      const V = await import('./mapVideo')
      const o = await V.prepare({ st, sites, photoUrls: {}, lang: getLang(), dests, name })
      await shareOrDownload(await V.still(o), 'divingslot-mi-mapa.png')
    } catch (e) { if (e?.name !== 'AbortError') setMsg(t('No se ha podido crear la imagen. Inténtalo de nuevo.')) }
    setBusy(false)
  }

  return (
    <section className="card mymap">
      <div className="mymap-head">
        <Ring pct={st.total ? st.sites / st.total : 0} />
        <div>
          <div><span className="mymap-big">{st.sites}</span> <span className="muted">{t('de {n} puntos de buceo', { n: st.total })}</span></div>
          <div className="small muted">{last ? <><Icon icon={MapPin} size={13} /> {t('Último: {site}', { site: last.name })}</> : t('Filipinas')}</div>
        </div>
        <div className="mymap-side">
          <b>{new Intl.NumberFormat(locale()).format(st.km)}</b> <span className="small">km</span>
          <div className="small muted">{st.dests === 1 ? t('1 destino') : t('{n} destinos', { n: st.dests })}</div>
        </div>
      </div>
      <MapView className="dark" points={points} height={340} cluster selected={sel} fit={st.route.map((s) => s.id)}
        path={st.route} onPick={(id) => setSel(id === sel ? null : id)} empty={t('Aún no hay puntos en tu mapa.')} />
      {site && (
        <div className="card mymap-site">
          {thumbOf(site) && <img src={thumbOf(site)} alt="" />}
          <div className="mymap-site-body">
            <div className="row between" style={{ gap: 8 }}>
              <b>{site.name}</b>
              <button type="button" className="linkish small" onClick={() => setSel(null)} aria-label={t('Cerrar')}><Icon icon={X} size={16} /></button>
            </div>
            <div className="small muted">{site.area}{hl(site) ? ' · ' + hl(site) : ''}</div>
            {v
              ? <p className="small" style={{ margin: '4px 0 0' }}>{v.n === 1 ? t('1 inmersión') : t('{n} inmersiones', { n: v.n })} · {v.n === 1 ? dayLabel(v.first, { day: 'numeric', month: 'short', year: 'numeric' }) : t('la primera, {d}', { d: dayLabel(v.first, { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
              : <p className="small" style={{ margin: '4px 0 0' }}>{t('Aún no has buceado aquí.')} <Link to={'/d/' + encodeURIComponent(st.destOf(site))}>{t('Ver salidas en {destino}', { destino: st.destOf(site) })}</Link></p>}
          </div>
        </div>
      )}
      <label className="check small"><input type="checkbox" checked={all || st.sites === 0} disabled={st.sites === 0} onChange={(e) => setAll(e.target.checked)} /> {t('Ver también los que me faltan')}</label>
      {st.destList.length > 0 && (
        <div className="mymap-dests">
          {st.destList.slice(0, 6).map((d) => (
            <Link key={d.name} to={'/d/' + encodeURIComponent(d.name)} className="mymap-dest">
              <span className="row between"><b>{d.name}</b><span className="small muted">{t('{a} de {b}', { a: d.done, b: d.total })}</span></span>
              <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={d.total} aria-valuenow={d.done} aria-label={d.name}><i style={{ width: (100 * d.done) / d.total + '%' }} /></span>
            </Link>
          ))}
        </div>
      )}
      {st.sites > 0 && (
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button type="button" className="btn small" onClick={() => setVideo(true)}><Icon icon={Play} size={14} /> {t('Mi ruta en vídeo')}</button>
          <button type="button" className="btn small ghost" disabled={busy} onClick={image}><Icon icon={ImageIcon} size={14} /> {busy ? t('Creando…') : t('Imagen para compartir')}</button>
        </div>
      )}
      {msg && <div className="msg err" role="alert">{msg}</div>}
      {st.sites === 0 && <p className="small muted" style={{ marginBottom: 0 }}>{t('Cuando registres inmersiones en puntos de Filipinas, aparecerán aquí con la ruta entre ellos.')}</p>}
      {st.unmatched > 0 && <p className="small muted" style={{ marginBottom: 0 }}>{st.unmatched === 1 ? t('1 inmersión no sale en el mapa: su punto no está en la lista. Elige el punto en la inmersión para sumarla.') : t('{n} inmersiones no salen en el mapa: su punto no está en la lista. Elige el punto en la inmersión para sumarlas.', { n: st.unmatched })}</p>}
      {video && <VideoMaker st={st} sites={sites} thumbs={thumbs} dests={dests} name={name} onClose={() => setVideo(false)} />}
    </section>
  )
}
