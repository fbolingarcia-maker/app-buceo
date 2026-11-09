// Piezas de las mejoras de usabilidad del 9 nov 2026 (ideas de Playtomic, Garmin y PADI):
// moneda aproximada, avisos en el móvil e instalar la app, aviso sin conexión, chat de la salida, reseñas,
// nivel de experiencia, «no volar», insignias de la bitácora y mapa de salidas.
import { useEffect, useRef, useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t, getLang } from './i18n'
import { php, dateTime } from './format'
import Icon from './Icon'
import { Bell, BellOff, Download, Minus, Plus, Send, Star, WifiOff, Plane, Award, MessageCircle } from 'lucide-react'

// ── Moneda: el cobro es en pesos; se muestra al lado un aproximado en la moneda del buceador ──
const CUR_KEY = 'ds_cur'
export const CURRENCIES = [['', 'Solo pesos (₱)'], ['USD', 'US$'], ['EUR', '€'], ['GBP', '£'], ['AUD', 'A$'], ['SGD', 'S$'], ['KRW', '₩'], ['JPY', '¥ (JPY)'], ['CNY', '¥ (CNY)']]
const SYMBOL = { USD: 'US$', EUR: '€', GBP: '£', AUD: 'A$', SGD: 'S$', KRW: '₩', JPY: '¥', CNY: 'CN¥' }
function guessCurrency() {
  const l = getLang()
  if (l === 'ko') return 'KRW'
  if (l === 'ja') return 'JPY'
  if (l === 'zh') return 'CNY'
  const nav = (navigator.language || '').toUpperCase()
  if (/-PH$/.test(nav)) return ''
  if (/-(US)$/.test(nav)) return 'USD'
  if (/-(GB)$/.test(nav)) return 'GBP'
  if (/-(AU)$/.test(nav)) return 'AUD'
  if (/-(SG)$/.test(nav)) return 'SGD'
  if (/-(ES|DE|FR|IT|NL|BE|AT|PT|IE|FI)$/.test(nav) || /^(DE|FR|IT|NL)/.test(nav)) return 'EUR'
  return ''
}
export function getCurrency() {
  try { const v = localStorage.getItem(CUR_KEY); if (v !== null) return v } catch (e) { /* sin almacenamiento */ }
  return guessCurrency()
}
export function setCurrency(c) { try { localStorage.setItem(CUR_KEY, c) } catch (e) { /* sin almacenamiento */ } fxListeners.forEach((f) => f()) }
let fxCache = null, fxP = null
const fxListeners = new Set()
const loadFx = () => (fxP ||= supabase.from('app_config').select('value').eq('key', 'fx').maybeSingle()
  .then(({ data }) => { try { fxCache = JSON.parse(data?.value || 'null') } catch (e) { fxCache = null } return fxCache }).catch(() => null))
export function useFx() {
  const [fx, setFx] = useState(fxCache)
  const [, tick] = useState(0)
  useEffect(() => { loadFx().then(setFx); const f = () => tick((n) => n + 1); fxListeners.add(f); return () => fxListeners.delete(f) }, [])
  return fx
}
export function approx(phpAmount, fx) {
  const cur = getCurrency()
  const rate = cur && fx?.rates?.[cur]
  if (!rate || !phpAmount) return null
  const v = phpAmount * rate
  const n = ['KRW', 'JPY'].includes(cur) ? Math.round(v / 100) * 100 : Math.round(v)
  return '≈ ' + SYMBOL[cur] + n.toLocaleString('en-US')
}
export function Approx({ php: amount, className = 'small muted' }) {
  const fx = useFx()
  const a = approx(amount, fx)
  return a ? <span className={className} title={t('Aproximado: se cobra en pesos filipinos')}>{a}</span> : null
}
export function CurrencySelect() {
  const [cur, setCur] = useState(getCurrency())
  return (
    <select value={cur} onChange={(e) => { setCurrency(e.target.value); setCur(e.target.value) }} aria-label={t('Moneda aproximada')} style={{ width: 'auto' }}>
      {CURRENCIES.map(([k, n]) => <option key={k} value={k}>{k ? n : t(n)}</option>)}
    </select>
  )
}

// ── Avisos en el móvil (Web Push) ──
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
async function swReg() {
  return (await navigator.serviceWorker.getRegistration('/app/')) || navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })
}
export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration('/app/')
  const sub = reg && await reg.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}
export async function enablePush() {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(t('Has bloqueado los avisos. Actívalos en los ajustes del navegador.'))
  const { data, error } = await supabase.rpc('push_key')
  if (error) throw new Error(errMsg(error))
  const reg = await swReg()
  await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.key) })
  const j = sub.toJSON()
  const r = await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_lang: getLang() })
  if (r.error) throw new Error(errMsg(r.error))
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/app/')
  const sub = reg && await reg.pushManager.getSubscription()
  if (sub) { await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }); await sub.unsubscribe() }
}
export function PushToggle() {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { pushState().then(setSt).catch(() => setSt('unsupported')) }, [])
  if (st === null) return null
  const ios = /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches
  return (
    <div className="li" style={{ alignItems: 'flex-start' }}>
      <span className="grow"><b>{t('Avisos en el móvil')}</b>
        <small>{st === 'unsupported' ? (ios ? t('En iPhone, primero añade DivingSlot a la pantalla de inicio (Compartir → Añadir a pantalla de inicio).') : t('Este navegador no admite avisos.'))
          : st === 'denied' ? t('Has bloqueado los avisos. Actívalos en los ajustes del navegador.')
            : t('Plaza libre en tu lista de espera, recordatorio del día antes, mensajes del centro y cancelaciones por el mar.')}</small>
        {err && <span className="small" style={{ color: 'var(--bad)' }}>{err}</span>}
      </span>
      {(st === 'on' || st === 'off') && (
        <button type="button" className={st === 'on' ? 'btn small ghost' : 'btn small'} disabled={busy} onClick={async () => {
          setBusy(true); setErr('')
          try { st === 'on' ? await disablePush() : await enablePush(); setSt(await pushState()) } catch (e) { setErr(e.message) }
          setBusy(false)
        }}><Icon icon={st === 'on' ? BellOff : Bell} size={16} /> {st === 'on' ? t('Desactivar') : t('Activar')}</button>
      )}
    </div>
  )
}

// ── Instalar la app (beforeinstallprompt lo guarda main.jsx en window.__dsInstall) ──
export function InstallButton({ className = 'btn small ghost' }) {
  const [ev, setEv] = useState(() => window.__dsInstall || null)
  useEffect(() => { const f = () => setEv(window.__dsInstall || null); window.addEventListener('ds-install', f); return () => window.removeEventListener('ds-install', f) }, [])
  if (!ev || window.matchMedia('(display-mode: standalone)').matches) return null
  return <button type="button" className={className} onClick={async () => { ev.prompt(); await ev.userChoice.catch(() => {}); window.__dsInstall = null; setEv(null) }}><Icon icon={Download} size={16} /> {t('Instalar la app')}</button>
}

// ── Sin conexión ──
export function OfflineBanner() {
  const [off, setOff] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const on = () => setOff(false), offF = () => setOff(true)
    window.addEventListener('online', on); window.addEventListener('offline', offF)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', offF) }
  }, [])
  if (!off) return null
  return <div className="banner offline" role="status"><span><Icon icon={WifiOff} size={16} /> {t('Sin conexión. Verás lo último que cargaste; los cambios se guardarán cuando vuelva la red.')}</span></div>
}

// ── Nivel de experiencia (de la certificación y las inmersiones) ──
export const EXP = { new: 'Pocas inmersiones', regular: 'Buceador habitual', experienced: 'Experimentado', expert: 'Experto' }
export const expName = (k) => (EXP[k] ? t(EXP[k]) : '')

// ── Chat de la salida ──
export function TripChat({ tripId, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen)
  const [msgs, setMsgs] = useState(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef(null)
  const load = () => supabase.rpc('trip_messages', { p_trip: tripId }).then(({ data, error }) => { if (error) setErr(errMsg(error)); else setMsgs(data || []) })
  useEffect(() => { if (!open) return; load(); const i = setInterval(load, 20000); return () => clearInterval(i) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tripId])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [msgs])
  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('post_trip_message', { p_trip: tripId, p_body: text.trim() })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setText(''); load()
  }
  return (
    <details className="card chat" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><Icon icon={MessageCircle} size={18} /> <b>{t('Chat de la salida')}</b> {msgs?.length > 0 && <span className="pill small">{msgs.length}</span>}</summary>
      <p className="small muted" style={{ margin: '6px 0 8px' }}>{t('Con el centro y los buceadores de esta salida: punto de encuentro, horarios, compartir transporte.')}</p>
      <div className="chat-list" aria-live="polite">
        {msgs === null ? <p className="small muted">{t('Cargando…')}</p> : msgs.length === 0 ? <p className="small muted">{t('Aún no hay mensajes.')}</p>
          : msgs.map((m) => (
            <div key={m.id} className={'chat-msg' + (m.mine ? ' mine' : '') + (m.is_staff ? ' staff' : '')}>
              <span className="small"><b>{m.author}</b>{m.is_staff && ' · ' + t('Centro')} <span className="muted">{dateTime(m.created_at)}</span></span>
              <span>{m.body}</span>
            </div>
          ))}
        <div ref={end} />
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      <form className="row" style={{ gap: 6, marginTop: 8 }} onSubmit={send}>
        <input className="grow" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Escribe un mensaje')} aria-label={t('Escribe un mensaje')} />
        <button className="btn small" disabled={busy || !text.trim()} aria-label={t('Enviar')}><Icon icon={Send} size={16} /></button>
      </form>
    </details>
  )
}

// ── Reseñas del centro ──
export const Stars = ({ n }) => <span className="stars-static" aria-label={t('{n} de 5', { n })}>{[1, 2, 3, 4, 5].map((i) => <Icon key={i} icon={Star} size={14} fill={i <= Math.round(n) ? 'currentColor' : 'none'} />)}</span>
export function CenterReviews({ centerId, staff = false, limit = 5 }) {
  const [d, setD] = useState(null)
  const [reply, setReply] = useState({})
  const load = () => supabase.rpc('center_reviews', { p_center: centerId, p_limit: staff ? 50 : limit }).then(({ data }) => setD(data || { reviews: [], count: 0 }))
  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId])
  if (!d) return null
  if (!d.count) return staff ? <p className="small muted">{t('Aún no tienes reseñas. Los buceadores pueden valorar el centro después de cada salida.')}</p> : null
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}><b className="big data">{d.avg}</b><Stars n={d.avg} /><span className="small muted">{d.count === 1 ? t('1 reseña') : t('{n} reseñas', { n: d.count })}</span></div>
      {d.reviews.map((r) => (
        <div key={r.id} className="review">
          <div className="row between"><b className="small">{r.author}</b><Stars n={r.rating} /></div>
          {r.body && <p style={{ margin: '4px 0' }}>{r.body}</p>}
          {r.reply && <p className="small review-reply"><b>{t('Respuesta del centro')}:</b> {r.reply}</p>}
          {staff && (
            <form className="row" style={{ gap: 6, marginTop: 4 }} onSubmit={async (e) => { e.preventDefault(); await supabase.rpc('reply_review', { p_review: r.id, p_reply: reply[r.id] ?? r.reply ?? '' }); load() }}>
              <input className="grow" maxLength={400} placeholder={t('Responder')} value={reply[r.id] ?? r.reply ?? ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} aria-label={t('Responder')} />
              <button className="btn small ghost">{t('Guardar')}</button>
            </form>
          )}
        </div>
      ))}
    </div>
  )
}
export function ReviewForm({ booking, existing, onDone }) {
  const [rating, setRating] = useState(existing?.rating || 0)
  const [body, setBody] = useState(existing?.body || '')
  const [msg, setMsg] = useState(null)
  return (
    <form onSubmit={async (e) => {
      e.preventDefault()
      const { error } = await supabase.rpc('submit_review', { p_booking: booking.id, p_rating: rating, p_body: body })
      setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: t('Gracias por tu reseña') })
      if (!error) onDone?.()
    }} style={{ marginTop: 8 }}>
      <b className="small">{existing ? t('Tu reseña del centro') : t('¿Qué tal con el centro?')}</b>
      <div className="stars" role="radiogroup" aria-label={t('Puntuación')}>
        {[1, 2, 3, 4, 5].map((i) => <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={t('{n} de 5', { n: i })} onClick={() => setRating(i)}><Icon icon={Star} size={24} fill={i <= rating ? 'currentColor' : 'none'} /></button>)}
      </div>
      <textarea rows="2" maxLength={600} placeholder={t('Cuéntalo en una frase (opcional)')} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t('Reseña')} />
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <button className="btn small" disabled={!rating} style={{ marginTop: 6 }}>{existing ? t('Actualizar reseña') : t('Publicar reseña')}</button>
    </form>
  )
}

// ── «No volar»: 18 h tras un día de varias inmersiones (recomendación DAN/PADI) ──
export const NOFLY_H = 18
export function NoFlyBanner({ lastDiveEnd }) {
  const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(i) }, [])
  if (!lastDiveEnd) return null
  const until = new Date(lastDiveEnd).getTime() + NOFLY_H * 36e5
  if (until <= Date.now() || new Date(lastDiveEnd).getTime() > Date.now()) return null
  const h = Math.ceil((until - Date.now()) / 36e5)
  return (
    <div className="msg warn row" role="status" style={{ gap: 8 }}>
      <Icon icon={Plane} size={18} />
      <span>{t('No vueles hasta el {fecha} (faltan unas {n} h): 18 h después de tu última inmersión.', { fecha: dateTime(new Date(until).toISOString()), n: h })}</span>
    </div>
  )
}

// ── Insignias de la bitácora (como las de Garmin y los retos de Playtomic) ──
export function badgesOf(logs) {
  const n = logs.length
  const sites = new Set(logs.map((l) => l.site_name).filter(Boolean))
  const deep = Math.max(0, ...logs.map((l) => +l.max_depth_m || 0))
  const night = logs.some((l) => l.entry_time && (l.entry_time >= '18:00' || l.entry_time < '05:00'))
  const nitrox = logs.some((l) => l.gas === 'nitrox')
  const signed = logs.filter((l) => l.signed_by_center).length
  const centers = new Set(logs.map((l) => l.center_id).filter(Boolean)).size
  const year = new Date().getFullYear()
  const thisYear = logs.filter((l) => String(l.dive_date).startsWith(String(year))).length
  return [
    ['first', 'Primera inmersión registrada', n >= 1],
    ['ten', '10 inmersiones', n >= 10],
    ['fifty', '50 inmersiones', n >= 50],
    ['hundred', '100 inmersiones', n >= 100],
    ['sites5', '5 puntos distintos', sites.size >= 5],
    ['sites20', '20 puntos distintos', sites.size >= 20],
    ['deep30', 'Más de 30 m', deep >= 30],
    ['night', 'Inmersión nocturna', night],
    ['nitrox', 'Con nitrox', nitrox],
    ['signed', 'Inmersión firmada por un centro', signed >= 1],
    ['explorer', '3 centros distintos', centers >= 3],
    ['year25', '25 inmersiones este año', thisYear >= 25],
  ].map(([k, label, got]) => ({ k, label, got }))
}
export function YearInReview({ logs }) {
  const year = new Date().getFullYear()
  const ys = logs.filter((l) => String(l.dive_date).startsWith(String(year)))
  if (ys.length < 3) return null
  const mins = ys.reduce((s, l) => s + (+l.duration_min || 0), 0)
  const deep = Math.max(0, ...ys.map((l) => +l.max_depth_m || 0))
  const sites = new Set(ys.map((l) => l.site_name).filter(Boolean)).size
  return (
    <div className="card year-card">
      <span className="over">{t('Tu año bajo el agua · {y}', { y: year })}</span>
      <div className="row between" style={{ marginTop: 8, gap: 8 }}>
        <div><b className="big data">{ys.length}</b><div className="small muted">{t('inmersiones')}</div></div>
        <div><b className="big data">{Math.round(mins / 60)} h</b><div className="small muted">{t('bajo el agua')}</div></div>
        <div><b className="big data">{deep} m</b><div className="small muted">{t('máxima')} · {t('{n} puntos', { n: sites })}</div></div>
      </div>
    </div>
  )
}
export function Badges({ logs }) {
  const bs = badgesOf(logs)
  const got = bs.filter((b) => b.got).length
  return (
    <div className="card">
      <div className="row between"><span className="over">{t('Insignias')}</span><span className="small muted">{got}/{bs.length}</span></div>
      <div className="badges">
        {bs.map((b) => <span key={b.k} className={'badge-item' + (b.got ? ' got' : '')} title={t(b.label)}><Icon icon={Award} size={18} /><small>{t(b.label)}</small></span>)}
      </div>
    </div>
  )
}

// ── Mapa con teselas de OpenStreetMap (sin librerías): marcadores de centros con salidas ──
const TILE = 256
const lon2x = (lng, z) => ((lng + 180) / 360) * TILE * 2 ** z
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z }
export function MapView({ points, height = 360, onPick, selected }) {
  const box = useRef(null)
  const [w, setW] = useState(360)
  const pts = points.filter((p) => p.lat != null && p.lng != null)
  const fitZ = () => {
    if (pts.length < 2) return 11
    for (let z = 12; z >= 4; z--) {
      const xs = pts.map((p) => lon2x(p.lng, z)), ys = pts.map((p) => lat2y(p.lat, z))
      if (Math.max(...xs) - Math.min(...xs) < w - 60 && Math.max(...ys) - Math.min(...ys) < height - 60) return z
    }
    return 4
  }
  const [z, setZ] = useState(null)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef(null)
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setZ(fitZ()); setOff({ x: 0, y: 0 }) }, [pts.length, w])
  if (!pts.length) return <div className="card muted small">{t('Los centros de este día no tienen la ubicación en el mapa.')}</div>
  const zz = z ?? fitZ()
  const cx = (Math.min(...pts.map((p) => lon2x(p.lng, zz))) + Math.max(...pts.map((p) => lon2x(p.lng, zz)))) / 2 - off.x
  const cy = (Math.min(...pts.map((p) => lat2y(p.lat, zz))) + Math.max(...pts.map((p) => lat2y(p.lat, zz)))) / 2 - off.y
  const left = cx - w / 2, top = cy - height / 2
  const tiles = []
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= 2 ** zz) continue
      const wx = ((tx % 2 ** zz) + 2 ** zz) % 2 ** zz
      tiles.push(<img key={tx + ':' + ty} src={`https://tile.openstreetmap.org/${zz}/${wx}/${ty}.png`} alt="" draggable="false" style={{ position: 'absolute', left: tx * TILE - left, top: ty * TILE - top, width: TILE, height: TILE }} />)
    }
  }
  return (
    <div className="map" ref={box} style={{ height }}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, o: off }; e.currentTarget.setPointerCapture?.(e.pointerId) }}
      onPointerMove={(e) => { if (drag.current) setOff({ x: drag.current.o.x + e.clientX - drag.current.x, y: drag.current.o.y + e.clientY - drag.current.y }) }}
      onPointerUp={() => { drag.current = null }}>
      {tiles}
      {pts.map((p) => (
        <button key={p.id} type="button" className={'map-pin' + (selected === p.id ? ' on' : '')} style={{ left: lon2x(p.lng, zz) - left, top: lat2y(p.lat, zz) - top }}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => onPick?.(p.id)} aria-label={p.label}>
          <span>{p.badge}</span>
        </button>
      ))}
      <div className="map-zoom">
        <button type="button" aria-label={t('Acercar')} onClick={() => { setZ(Math.min(16, zz + 1)); setOff({ x: off.x * 2, y: off.y * 2 }) }}><Icon icon={Plus} size={18} /></button>
        <button type="button" aria-label={t('Alejar')} onClick={() => { setZ(Math.max(4, zz - 1)); setOff({ x: off.x / 2, y: off.y / 2 }) }}><Icon icon={Minus} size={18} /></button>
      </div>
      <span className="map-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></span>
    </div>
  )
}

export const priceOf = (php0) => php(php0)
