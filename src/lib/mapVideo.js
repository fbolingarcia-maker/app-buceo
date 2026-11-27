// «Mi ruta en vídeo» (Bitácora, 26 nov 2026): animación vertical 1080×1920 al estilo de los reels de mapas.
// La cámara vuela de un punto de buceo al siguiente (por orden de la primera inmersión en cada uno), la ruta se va
// dibujando y en cada parada salen la tarjeta del punto (con la foto del buceador si tiene) y el contador
// «N de 179 puntos de buceo». Se codifica en el móvil fotograma a fotograma con WebCodecs (MP4 a 60 fps, mp4mux.js)
// y, si el navegador no lo permite, se graba en tiempo real con MediaRecorder; no se sube nada.
// Fondo: la costa de Filipinas de Natural Earth (dominio público, phLand.js) dibujada en el propio lienzo:
// no depende de servidores de mapas ni de CORS, y se ve igual sin conexión.
import { t, locale } from './i18n'
import PH from './phLand'

export const W = 1080, H = 1920
const TILE = 256
const CYAN = '#5fd3e0', CORAL = '#f0604d', NAVY = '#0b1f2c'
const DATA = '"Barlow Condensed", "Arial Narrow", sans-serif'
const UI = 'Figtree, -apple-system, "Segoe UI", Roboto, sans-serif'
const CLOSE = 11.6 // zoom de cámara en cada parada
// Zonas seguras de Instagram Reels (Meta): libres el 14 % de arriba (~270 px), el 35 % de abajo (~670 px) y un 6 % a
// cada lado (~65 px). Los textos van entre y = 280 y 1240; el mapa ocupa todo el fondo.
const SAFE_T = 280, SAFE_B = 1240, SX = 66
const FY = 780 // los puntos de buceo quedan entre el panel de arriba y la tarjeta de abajo

// Mercator en «píxeles de mundo» a zoom z (z puede tener decimales)
const wx = (lng, z) => ((lng + 180) / 360) * TILE * 2 ** z
const wy = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const lerp = (a, b, k) => a + (b - a) * k
const distKm = (a, b) => { const r = Math.PI / 180; const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)) }

// Zoom que encaja unos puntos en la pantalla con margen
function fitZoom(pts, padX = 200, padY = 520, max = CLOSE) {
  if (pts.length < 2) return max
  const xs = pts.map((p) => wx(p.lng, 0)), ys = pts.map((p) => wy(p.lat, 0))
  const sx = Math.max(...xs) - Math.min(...xs) || 1e-9, sy = Math.max(...ys) - Math.min(...ys) || 1e-9
  return clamp(Math.min(Math.log2((W - padX) / sx), Math.log2((H - padY) / sy)), 4.5, max)
}
const centerOf = (pts) => {
  const xs = pts.map((p) => wx(p.lng, 0)), ys = pts.map((p) => wy(p.lat, 0))
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } // en píxeles de mundo a zoom 0
}
const at0 = (p) => ({ x: wx(p.lng, 0), y: wy(p.lat, 0) })

// ── Vuelo de cámara «flyTo» (van Wijk y Nuij, 2003; el mismo que Mapbox/MapLibre): se aleja, viaja y se acerca
// en un único movimiento continuo, a velocidad percibida constante. Cámara = { c: centro en píxeles de mundo a zoom 0, z }.
const RHO = 1.42
function flyPath(a, b) {
  const w0 = Math.max(W, H) / 2 ** a.z, w1 = Math.max(W, H) / 2 ** b.z
  const u1 = Math.hypot(b.c.x - a.c.x, b.c.y - a.c.y)
  if (u1 < 1e-9) {
    const S = Math.abs(Math.log(w1 / w0)) / RHO
    return { S, at: (k) => ({ c: { ...a.c }, z: lerp(a.z, b.z, k), fy: lerp(a.fy, b.fy, k), u: k }) }
  }
  const bf = (i) => { const w = i ? w1 : w0; return (w1 * w1 - w0 * w0 + (i ? -1 : 1) * RHO ** 4 * u1 * u1) / (2 * w * RHO * RHO * u1) }
  const r = (i) => Math.log(Math.sqrt(bf(i) ** 2 + 1) - bf(i))
  const r0 = r(0), r1 = r(1), S = (r1 - r0) / RHO
  return {
    S,
    at: (k) => {
      const s = k * S
      const w = Math.cosh(r0) / Math.cosh(r0 + RHO * s)
      const u = (w0 * ((Math.cosh(r0) * Math.tanh(r0 + RHO * s) - Math.sinh(r0)) / (RHO * RHO))) / u1
      const uu = clamp(u, 0, 1)
      return { c: { x: lerp(a.c.x, b.c.x, u), y: lerp(a.c.y, b.c.y, u) }, z: k >= 1 ? b.z : a.z + Math.log2(1 / w), fy: lerp(a.fy, b.fy, uu), u: uu }
    },
  }
}
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10) } // smootherstep: arranca y frena sin tirones
const sine = (x) => 0.5 - Math.cos(Math.PI * clamp(x, 0, 1)) / 2

// ── Guion: paradas (primera vez en cada punto), km acumulados y la línea de tiempo de la cámara ──
export function buildScript(st, { maxStops = 40 } = {}) {
  const seen = new Set()
  let km = 0
  const stops = []
  st.route.forEach((s, i) => {
    if (i) km += distKm(st.route[i - 1], s)
    if (!seen.has(s.id)) { seen.add(s.id); stops.push({ site: s, routeIdx: i, km, n: seen.size, mins: st.routeMins?.[i] || 0 }) }
  })
  const shown = stops.slice(-maxStops)
  const all = st.route.length ? st.route : []
  const ph = [{ lng: 117.2, lat: 4.8 }, { lng: 126.6, lat: 19.2 }]
  // fy: altura de la pantalla donde cae el centro de la cámara (los textos van en las zonas seguras de Reels/TikTok)
  const intro0 = { c: centerOf(ph), z: fitZoom(ph, 60, 560, 9), fy: 900 }
  const intro1 = { c: intro0.c, z: intro0.z + 0.22, fy: 900 }
  // Final: la ruta entera entre el panel y el título (y 600–1010)
  const overview = { c: all.length ? centerOf(all) : intro0.c, z: all.length ? fitZoom(all, 220, H - 400, 10.5) : intro0.z, fy: 585 }
  const arrive = (s) => ({ c: at0(s), z: CLOSE - 0.3, fy: FY })
  const push = (cam, dz) => ({ c: cam.c, z: cam.z + dz, fy: cam.fy })
  // Vuelos: la duración sigue la longitud del vuelo (S), con límites
  const flies = []
  let prev = intro1
  shown.forEach((s, i) => {
    const to = arrive(s.site), path = flyPath(prev, to)
    flies.push({ from: prev, to, path, d: clamp(path.S / 1.25, i ? 1.15 : 1.9, i ? 2.5 : 3.0) })
    prev = push(to, 0.3)
  })
  const outroPath = flyPath(prev, overview)
  const flyTotal = flies.reduce((a, f) => a + f.d, 0)
  const INTRO = 1.8, OUTRO_HOLD = 3.4, outroFly = clamp(outroPath.S / 1.25, 1.4, 2.6)
  const hold = clamp((56 - INTRO - flyTotal - outroFly - OUTRO_HOLD) / Math.max(1, shown.length), 0.95, 1.7)
  const seg = [{ kind: 'intro', t0: 0, t1: INTRO, from: intro0, to: intro1 }]
  let tt = INTRO
  shown.forEach((s, i) => {
    const f = flies[i]
    seg.push({ kind: 'fly', t0: tt, t1: tt + f.d, path: f.path, stop: i }); tt += f.d
    seg.push({ kind: 'hold', t0: tt, t1: tt + hold, from: f.to, to: push(f.to, 0.3), stop: i }); tt += hold
  })
  seg.push({ kind: 'fly', t0: tt, t1: tt + outroFly, path: outroPath, stop: null, outro: true }); tt += outroFly
  seg.push({ kind: 'hold', t0: tt, t1: tt + OUTRO_HOLD, from: overview, to: push(overview, 0.12), stop: null, outro: true }); tt += OUTRO_HOLD
  const route0 = st.route.map(at0)
  return { stops: shown, skipped: stops.length - shown.length, seg, duration: tt, INTRO, overview, route0, outroAt: tt - OUTRO_HOLD - outroFly }
}

// Estado en el instante t: cámara, parada, avance del vuelo actual
function stateAt(sc, t) {
  t = clamp(t, 0, sc.duration)
  const s = sc.seg.find((x) => t < x.t1) || sc.seg[sc.seg.length - 1]
  const k = clamp((t - s.t0) / (s.t1 - s.t0), 0, 1)
  let cam, u = 1
  if (s.kind === 'fly') { const r = s.path.at(smooth(k)); cam = { c: r.c, z: r.z, fy: r.fy }; u = r.u }
  else { const e = sine(k); cam = { c: { x: lerp(s.from.c.x, s.to.c.x, e), y: lerp(s.from.c.y, s.to.c.y, e) }, z: lerp(s.from.z, s.to.z, e), fy: lerp(s.from.fy, s.to.fy, e) } }
  // Parada actual: la última a la que se ha llegado; «flying» = índice de la parada a la que se va
  let arrived = -1, flying = null, since = 0
  for (const x of sc.seg) {
    if (x.stop == null) continue
    if (x.kind === 'fly' && t >= x.t1) { arrived = x.stop; since = t - x.t1 }
    if (x.kind === 'fly' && t >= x.t0 && t < x.t1) flying = x.stop
  }
  return { t, s, k, u, cam, arrived, flying, since, outro: t >= sc.outroAt }
}

// ── Costa: anillos en grados (lng, lat) con su caja para descartar los que no se ven ──
export function decodeLand(str = PH) {
  return str.split(';').map((r) => {
    const v = r.split(',').map(Number), pts = []
    let x = 0, y = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (let i = 0; i < v.length; i += 2) {
      x += v[i]; y += v[i + 1]; const lng = x / 500, lat = y / 500
      pts.push([lng, lat]); x0 = Math.min(x0, lng); x1 = Math.max(x1, lng); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat)
    }
    return { pts, box: [x0, y0, x1, y1] }
  })
}
function drawLand(ctx, land, cam) {
  const ox = cam.c.x * 2 ** cam.z - W / 2, oy = cam.c.y * 2 ** cam.z - cam.fy
  ctx.beginPath()
  for (const r of land) {
    const [x0, y0, x1, y1] = r.box
    if (wx(x1, cam.z) - ox < -10 || wx(x0, cam.z) - ox > W + 10 || wy(y0, cam.z) - oy < -10 || wy(y1, cam.z) - oy > H + 10) continue
    r.pts.forEach(([lng, lat], i) => { const x = wx(lng, cam.z) - ox, y = wy(lat, cam.z) - oy; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.closePath()
  }
  // Arrecife: halo turquesa suave alrededor de la costa; tierra en azul pizarra
  ctx.save(); ctx.strokeStyle = 'rgba(95,211,224,.16)'; ctx.lineWidth = clamp((cam.z - 5) * 4, 4, 26); ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore()
  ctx.fillStyle = '#1d3a4b'; ctx.fill('evenodd')
  ctx.strokeStyle = 'rgba(150,200,215,.45)'; ctx.lineWidth = 1.5; ctx.stroke()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
function spaced(ctx, text, x, y, sp) {
  if ('letterSpacing' in ctx) { ctx.letterSpacing = sp + 'px'; ctx.fillText(text, x, y); ctx.letterSpacing = '0px'; return }
  ctx.fillText(text, x, y)
}
function fitText(ctx, text, max) { let s = text; while (ctx.measureText(s).width > max && s.length > 2) s = s.slice(0, -2) + '…'; return s }
function brand(ctx, x, y) {
  ctx.fillStyle = '#d62828'; ctx.fillRect(x, y, 54, 36)
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 11, y); ctx.lineTo(x + 54, y + 29); ctx.lineTo(x + 54, y + 36); ctx.lineTo(x + 43, y + 36); ctx.lineTo(x, y + 7); ctx.closePath(); ctx.fill()
  ctx.font = '800 40px ' + UI; ctx.fillText('DivingSlot', x + 72, y + 32)
}
const dateLabel = (d) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(d + 'T12:00:00+08:00'))

// ── Ruta: cada tramo es una curva suave (como en los reels de viajes) ──
function curves(sc) {
  if (sc._curves) return sc._curves
  const P = sc.route0, out = [null]
  for (let j = 1; j < P.length; j++) {
    const a = P[j - 1], b = P[j], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy)
    // Punto de control desplazado en perpendicular (20 % de la longitud): arco discreto, siempre al mismo lado
    out.push({ a, b, c: { x: (a.x + b.x) / 2 - dy * 0.2, y: (a.y + b.y) / 2 + dx * 0.2 }, L })
  }
  return (sc._curves = out)
}
const qpt = (q, t) => ({ x: (1 - t) ** 2 * q.a.x + 2 * (1 - t) * t * q.c.x + t * t * q.b.x, y: (1 - t) ** 2 * q.a.y + 2 * (1 - t) * t * q.c.y + t * t * q.b.y })
const bump = (x) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x)) // 0 → 1 → 0

// ── Un fotograma ──
// opts: { st, sc, sites, land, dests, photos: {siteId: HTMLImageElement}, lang }
export function drawFrame(ctx, tm, o) {
  const { st, sc, sites, photos } = o
  const S = stateAt(sc, tm)
  const cam = S.cam, Z = 2 ** cam.z
  const ox = cam.c.x * Z - W / 2, oy = cam.c.y * Z - cam.fy
  const P0 = (q) => [q.x * Z - ox, q.y * Z - oy]
  const px = (p) => [wx(p.lng, cam.z) - ox, wy(p.lat, cam.z) - oy]
  const stops = sc.stops

  // Fondo: degradado, costa y puntos de buceo
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0e2a3b'); g.addColorStop(1, '#081822')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  if (o.land) drawLand(ctx, o.land, cam)
  ctx.fillStyle = 'rgba(255,255,255,.3)'
  const dot = clamp(2 + (cam.z - 5) * 0.8, 2.5, 7)
  for (const x of sites) { const [a, b] = px(x); if (a > -20 && a < W + 20 && b > -20 && b < H + 20) { ctx.beginPath(); ctx.arc(a, b, dot, 0, 7); ctx.fill() } }
  // Nombres de los destinos (como «Sumba» o «Flores» en los reels), tenues, al acercarse
  const la = clamp((cam.z - 7.4) / 0.8, 0, 1) * clamp((12.5 - cam.z) / 0.8, 0, 1)
  if (la > 0 && o.dests?.length) {
    ctx.font = '600 30px ' + UI; ctx.fillStyle = `rgba(255,255,255,${0.42 * la})`; ctx.textAlign = 'center'
    for (const d of o.dests) { const [a, b] = px(d); if (a > 60 && a < W - 60 && b > 640 && b < 980) spaced(ctx, d.name.toUpperCase(), a, b - 26, 4) }
    ctx.textAlign = 'left'
  }

  // Ruta: tramos completos hasta la última parada y el tramo en vuelo según el avance de la cámara
  const C = curves(sc)
  const first = stops[0]?.routeIdx ?? 0
  let upto = S.arrived >= 0 ? stops[S.arrived].routeIdx : first
  let live = null // { from, to, f } índices de ruta y fracción recorrida
  if (S.outro) { upto = S.s.kind === 'hold' ? st.route.length - 1 : upto; if (S.s.kind === 'fly' && S.s.outro) live = { from: upto, to: st.route.length - 1, f: S.u } }
  else if (S.flying != null && S.flying > 0) live = { from: stops[S.flying - 1].routeIdx, to: stops[S.flying].routeIdx, f: S.u }
  ctx.save(); ctx.strokeStyle = CYAN; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.shadowColor = CYAN; ctx.shadowBlur = 22
  ctx.beginPath()
  for (let j = first + 1; j <= upto; j++) { const q = C[j]; const [ax, ay] = P0(q.a), [cx, cy] = P0(q.c), [bx, by] = P0(q.b); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by) }
  let head = null
  if (live && live.to > live.from) {
    const segs = C.slice(live.from + 1, live.to + 1), tot = segs.reduce((a, q) => a + q.L, 0) || 1
    let left = tot * live.f
    for (const q of segs) {
      if (left <= 0) break
      const f = Math.min(1, left / (q.L || 1)); left -= q.L
      const n = Math.max(2, Math.ceil(28 * f))
      for (let i = 0; i <= n; i++) { const [x, y] = P0(qpt(q, (f * i) / n)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
      head = P0(qpt(q, f))
    }
  }
  ctx.stroke(); ctx.restore()
  if (head) { // Cabeza de la ruta: punto blanco con halo
    const hg = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], 34); hg.addColorStop(0, 'rgba(95,211,224,.7)'); hg.addColorStop(1, 'rgba(95,211,224,0)')
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(head[0], head[1], 34, 0, 7); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(head[0], head[1], 9, 0, 7); ctx.fill()
  }
  // Puntos visitados: aparecen con un pequeño «pop»
  const nVis = S.outro ? stops.length : S.arrived + 1
  for (let i = 0; i < nVis; i++) {
    const [x, y] = px(stops[i].site)
    const r = 11 * (1 + (i === S.arrived && !S.outro ? 0.6 * bump(S.since / 0.45) : 0))
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.strokeStyle = CORAL; ctx.lineWidth = 5; ctx.stroke()
  }
  // Ondas en la parada actual mientras la cámara se recrea en ella
  if (S.arrived >= 0 && !S.outro && S.flying == null) {
    const [x, y] = px(stops[S.arrived].site)
    for (const off of [0, 0.6]) {
      const ph = ((S.since + off) % 1.2) / 1.2
      ctx.strokeStyle = `rgba(240,96,77,${0.8 * (1 - ph)})`; ctx.lineWidth = 4
      ctx.beginPath(); ctx.arc(x, y, 16 + ph * 56, 0, 7); ctx.stroke()
    }
  }

  // Velos: arriba (panel) y abajo (tarjeta); debajo de y = 1240 el mapa queda atenuado, ahí van los botones de Reels
  { const gg = ctx.createLinearGradient(0, 0, 0, 660); gg.addColorStop(0, 'rgba(8,24,34,.96)'); gg.addColorStop(0.55, 'rgba(8,24,34,.7)'); gg.addColorStop(1, 'rgba(8,24,34,0)'); ctx.fillStyle = gg; ctx.fillRect(0, 0, W, 660) }
  { const gg = ctx.createLinearGradient(0, 940, 0, 1300); gg.addColorStop(0, 'rgba(8,24,34,0)'); gg.addColorStop(1, 'rgba(8,24,34,.78)'); ctx.fillStyle = gg; ctx.fillRect(0, 940, W, 360)
    const g2 = ctx.createLinearGradient(0, 1300, 0, H); g2.addColorStop(0, 'rgba(8,24,34,.78)'); g2.addColorStop(0.35, 'rgba(8,24,34,.5)'); g2.addColorStop(1, 'rgba(8,24,34,.72)'); ctx.fillStyle = g2; ctx.fillRect(0, 1300, W, H - 1300) }

  // Barra superior: marca y nombre del buceador
  ctx.fillStyle = '#fff'; brand(ctx, SX, SAFE_T - 4)
  if (o.name) { ctx.font = '600 30px ' + UI; ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.textAlign = 'right'; ctx.fillText(fitText(ctx, o.name, 520), W - SX, SAFE_T + 26); ctx.textAlign = 'left' }

  // ── Panel de cifras (arriba): puntos, km y tiempo bajo el agua; todo cuenta hacia arriba ──
  const base = (stops[0]?.n ?? 1) - 1
  const last = stops[stops.length - 1]
  let cnt, km, mins
  if (S.outro) {
    const f = S.s.kind === 'fly' ? S.u : 1
    cnt = lerp(last?.n ?? 0, st.sites, f); km = lerp(last?.km ?? 0, st.km, f); mins = lerp(last?.mins ?? 0, st.minutes || 0, f)
  } else if (S.flying != null) {
    const p = S.flying > 0 ? stops[S.flying - 1] : null, q = stops[S.flying]
    cnt = p ? p.n : base; km = p ? lerp(p.km, q.km, S.u) : q.km; mins = p ? p.mins : 0
  } else if (S.arrived >= 0) {
    const q = stops[S.arrived], p = S.arrived > 0 ? stops[S.arrived - 1] : null, e = smooth(S.since / 0.6)
    cnt = q.n - 1 + smooth(S.since / 0.4); km = q.km; mins = lerp(p ? p.mins : 0, q.mins, e)
  } else { cnt = base; km = stops[0]?.km ?? 0; mins = 0 }
  const pop = S.arrived >= 0 && !S.outro && S.flying == null ? 0.12 * bump(S.since / 0.5) : 0
  const outA = S.outro ? smooth((tm - sc.outroAt - 0.2) / 0.7) : 0 // resumen final
  ctx.save(); ctx.globalAlpha = 1 - outA
  const PY = SAFE_T + 60, PH = 224
  ctx.fillStyle = 'rgba(16,36,50,.92)'; roundRect(ctx, SX, PY, W - 2 * SX, PH, 36); ctx.fill()
  const rx = SX + 84, ry = PY + 92, rr = 50
  ctx.lineWidth = 13; ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.arc(rx, ry, rr, 0, 7); ctx.stroke()
  ctx.strokeStyle = CYAN; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + Math.max(0.02, cnt / Math.max(1, st.total)) * 2 * Math.PI); ctx.stroke(); ctx.lineCap = 'butt'
  const nS = String(Math.round(cnt)), NX = SX + 166, NY = PY + 128
  ctx.save(); ctx.translate(NX, NY); ctx.scale(1 + pop, 1 + pop)
  ctx.fillStyle = '#fff'; ctx.font = '600 120px ' + DATA; ctx.fillText(nS, 0, 0); ctx.restore()
  ctx.font = '600 120px ' + DATA
  const nw = ctx.measureText(nS).width
  const nf = new Intl.NumberFormat(locale())
  const kmS = nf.format(Math.round(km))
  ctx.font = '600 78px ' + DATA; const kmW = ctx.measureText(kmS).width
  const lx = NX + nw + 14, lmax = W - SX - 92 - kmW - 26 - lx
  const lbl = t('de {n} puntos', { n: st.total })
  let lf = 40; do { ctx.font = '600 ' + lf + 'px ' + DATA; lf -= 2 } while (lf > 24 && ctx.measureText(lbl).width > lmax)
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(fitText(ctx, lbl, lmax), lx, NY)
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = '600 78px ' + DATA; ctx.fillText(kmS, W - SX - 86, NY - 4)
  ctx.font = '600 38px ' + DATA; ctx.fillText('km', W - SX - 32, NY - 4)
  // Segunda línea: dónde y cuándo (o el resumen al final) · tiempo bajo el agua con un reloj
  const row = PY + 186
  const tS = fmtTime(Math.round(mins))
  ctx.font = '600 32px ' + UI; ctx.fillStyle = '#fff'; ctx.fillText(tS, W - SX - 32, row)
  const tw = ctx.measureText(tS).width
  clock(ctx, W - SX - 32 - tw - 26, row - 11, 13)
  ctx.textAlign = 'left'
  const subStop = S.flying != null && !S.outro ? stops[S.flying] : S.arrived >= 0 ? stops[S.arrived] : null
  const sub = S.outro ? [st.dests === 1 ? t('1 destino') : t('{n} destinos', { n: st.dests }), st.dives === 1 ? t('1 inmersión') : t('{n} inmersiones', { n: st.dives })].join(' · ')
    : subStop ? subStop.site.area + ' · ' + dateLabel(st.visits[subStop.site.id].first) : t('Filipinas')
  ctx.font = '600 30px ' + UI; ctx.fillStyle = 'rgba(255,255,255,.72)'
  ctx.fillText(fitText(ctx, sub, W - SX - 32 - tw - 60 - (SX + 40)), SX + 40, row)
  ctx.restore()
  if (outA > 0) summary(ctx, o, { a: outA, t: tm - sc.outroAt, cnt, km, mins })

  // ── Título (principio y final), en el hueco de la tarjeta ──
  const titleA = S.outro ? 0 : 1 - smooth((tm - sc.INTRO + 0.2) / 0.6)
  if (titleA > 0) {
    ctx.globalAlpha = titleA
    const dy = (1 - titleA) * 18
    ctx.fillStyle = '#fff'
    const title = t('Mi mapa de buceo').toUpperCase()
    let ts = 96; do { ctx.font = '600 ' + ts + 'px ' + DATA; ts -= 4 } while (ts > 56 && ctx.measureText(title).width > W - 2 * SX - 16)
    ctx.fillText(title, SX + 4, SAFE_B - 112 + dy)
    const yrs = st.years ? (st.years[0] === st.years[1] ? st.years[0] : st.years[0] + '–' + st.years[1]) : ''
    ctx.font = '600 40px ' + DATA; ctx.fillStyle = 'rgba(255,255,255,.78)'
    ctx.fillText([t('Filipinas').toUpperCase(), yrs].filter(Boolean).join(' · '), SX + 6, SAFE_B - 58 + dy)
    if (S.outro) { ctx.font = '700 30px ' + UI; ctx.fillStyle = CYAN; ctx.fillText('divingslot.com', SX + 6, SAFE_B - 10 + dy) }
    ctx.globalAlpha = 1
  }

  // ── Tarjeta del punto (abajo, dentro de la zona segura): entra al llegar y sale al despegar ──
  if (S.arrived >= 0 && !(S.outro && S.s.kind === 'hold')) {
    const inA = smooth((S.since + 0.1) / 0.45)
    const leaving = S.flying != null || (S.outro && S.s.kind === 'fly')
    const outA = leaving ? 1 - smooth(S.k / 0.28) : 1
    const a = Math.min(inA, outA)
    if (a > 0.01) {
      const x = stops[S.arrived].site, v = st.visits[x.id]
      const photo = photos?.[x.id]
      const CH = 214, cy = SAFE_B - CH + (1 - inA) * 40 - (1 - outA) * 24
      ctx.save(); ctx.globalAlpha = a
      ctx.fillStyle = 'rgba(16,36,50,.92)'; roundRect(ctx, SX, cy, W - 2 * SX, CH, 36); ctx.fill()
      let tx = SX + 36
      if (photo) {
        ctx.save(); roundRect(ctx, SX, cy, W - 2 * SX, CH, 36); ctx.clip()
        const zk = 1 + 0.08 * clamp(S.since / 3, 0, 1) // acercamiento lento a la foto
        const k = Math.max(CH / photo.width, CH / photo.height) * zk, w = photo.width * k, h = photo.height * k
        ctx.beginPath(); ctx.rect(SX, cy, CH, CH); ctx.clip()
        ctx.drawImage(photo, SX + (CH - w) / 2, cy + (CH - h) / 2, w, h)
        ctx.restore()
        tx = SX + CH + 30
      }
      const tmax = W - SX - 30 - tx
      ctx.fillStyle = '#fff'
      let fs = 76; do { ctx.font = '600 ' + fs + 'px ' + DATA; fs -= 4 } while (fs >= 52 && ctx.measureText(x.name).width > tmax)
      ctx.fillText(fitText(ctx, x.name, tmax), tx, cy + 82)
      const hl = o.lang === 'es' ? x.highlight_es : x.highlight
      ctx.font = '600 30px ' + UI; ctx.fillStyle = 'rgba(255,255,255,.8)'
      ctx.fillText(fitText(ctx, x.area + (hl ? ' · ' + hl : ''), tmax), tx, cy + 130)
      const facts = [v.n === 1 ? t('1 inmersión') : t('{n} inmersiones', { n: v.n }), v.max ? t('máx. {n} m', { n: Math.round(v.max) }) : null, v.mins ? fmtTime(v.mins) : null].filter(Boolean).join(' · ')
      ctx.font = '600 28px ' + UI; ctx.fillStyle = CYAN
      ctx.fillText(fitText(ctx, facts, tmax), tx, cy + 176)
      ctx.restore()
    }
  }
}

// ── Resumen final, centrado abajo (dentro de la zona segura): título, años y las cifras grandes ──
function summary(ctx, o, { a, t: tt, cnt, km, mins }) {
  const { st } = o
  const top = 846, bottom = SAFE_B + 10
  ctx.save(); ctx.globalAlpha = a
  ctx.fillStyle = 'rgba(16,36,50,.93)'; roundRect(ctx, SX, top + (1 - a) * 40, W - 2 * SX, bottom - top, 40); ctx.fill()
  ctx.textAlign = 'center'
  const cx = W / 2
  const title = t('Mi mapa de buceo').toUpperCase()
  let ts = 76; do { ctx.font = '600 ' + ts + 'px ' + DATA; ts -= 4 } while (ts > 48 && ctx.measureText(title).width > W - 2 * SX - 60)
  ctx.fillStyle = '#fff'; ctx.fillText(title, cx, top + 86)
  const yrs = st.years ? (st.years[0] === st.years[1] ? st.years[0] : st.years[0] + '–' + st.years[1]) : ''
  ctx.font = '600 34px ' + DATA; ctx.fillStyle = 'rgba(255,255,255,.75)'
  ctx.fillText([t('Filipinas').toUpperCase(), yrs].filter(Boolean).join(' · '), cx, top + 132)
  // Cifras: cada una entra un poco después que la anterior
  const nf = new Intl.NumberFormat(locale())
  const cell = (i, x, y, value, small, label, maxW) => {
    const e = smooth((tt - 0.5 - i * 0.12) / 0.5)
    if (e <= 0) return
    ctx.save(); ctx.globalAlpha = a * e; ctx.translate(0, (1 - e) * 22)
    // La cifra encoge si no cabe en su columna
    let fs = 86, vw, sw
    do { ctx.font = '600 ' + fs + 'px ' + DATA; vw = ctx.measureText(value).width; ctx.font = '600 ' + Math.round(fs * 0.44) + 'px ' + DATA; sw = small ? ctx.measureText(small).width + 6 : 0; fs -= 4 } while (fs > 44 && vw + sw > maxW)
    fs += 4
    const x0 = x - (vw + sw) / 2
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '600 ' + fs + 'px ' + DATA; ctx.fillText(value, x0, y)
    if (small) { ctx.font = '600 ' + Math.round(fs * 0.44) + 'px ' + DATA; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(small, x0 + vw + 6, y) }
    ctx.textAlign = 'center'; ctx.font = '700 24px ' + UI; ctx.fillStyle = CYAN
    spaced(ctx, label.toUpperCase(), x, y + 38, 2)
    ctx.restore()
  }
  const w3 = (W - 2 * SX) / 3, w2 = (W - 2 * SX) / 2
  cell(0, SX + w3 * 0.5, top + 236, String(Math.round(cnt)), '/' + st.total, t('Puntos'), w3 - 30)
  cell(1, SX + w3 * 1.5, top + 236, String(st.dests), null, t('Destinos'), w3 - 30)
  cell(2, SX + w3 * 2.5, top + 236, String(st.dives), null, t('Inmersiones'), w3 - 30)
  cell(3, SX + w2 * 0.5, top + 352, nf.format(Math.round(km)), 'km', t('Recorridos'), w2 - 50)
  cell(4, SX + w2 * 1.5, top + 352, fmtTime(Math.round(mins)), null, t('Bajo el agua'), w2 - 50)
  ctx.textAlign = 'center'; ctx.font = '700 28px ' + UI; ctx.fillStyle = CYAN; ctx.globalAlpha = a * smooth((tt - 1.3) / 0.5)
  ctx.fillText('divingslot.com', cx, bottom + 52)
  ctx.restore(); ctx.textAlign = 'left'
}

// «12 h 05 min», «45 min» en el idioma de la app
export function fmtTime(m) {
  const h = Math.floor(m / 60), mm = m % 60
  return h ? t('{h} h {m} min', { h, m: String(mm).padStart(2, '0') }) : t('{m} min', { m: mm })
}
function clock(ctx, x, y, r) {
  ctx.save(); ctx.strokeStyle = CYAN; ctx.lineWidth = 3.5; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.6); ctx.moveTo(x, y); ctx.lineTo(x + r * 0.45, y + r * 0.2); ctx.stroke(); ctx.restore()
}

// Carga fotos (mismo origen: no ensucian el lienzo)
export async function loadPhotos(urls) {
  const out = {}
  await Promise.all(Object.entries(urls).map(([id, url]) => new Promise((res) => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => { out[id] = img; res() }; img.onerror = () => res(); img.src = url
  })))
  return out
}

// Prepara todo: guion, costa, fuentes y fotos; devuelve las opciones para drawFrame
let landCache = null
export async function prepare({ st, sites, photoUrls, lang, dests = [], name = '' }) {
  await Promise.all([document.fonts.load('600 120px "Barlow Condensed"'), document.fonts.load('800 40px Figtree'), document.fonts.load('600 36px Figtree')]).catch(() => {})
  const sc = buildScript(st)
  const land = (landCache ||= decodeLand())
  const photos = await loadPhotos(photoUrls || {})
  return { st, sc, sites, land, photos, lang, dests: dests.filter((d) => d.lat != null), name: (name || '').trim().split(/\s+/)[0] || '' }
}

// Imagen fija (el final del vídeo) como PNG
export async function still(o) {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  drawFrame(c.getContext('2d'), o.sc.duration - 0.01, o)
  return new Promise((res, rej) => { try { c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png') } catch (e) { rej(e) } })
}

export function videoMime() {
  if (typeof MediaRecorder === 'undefined') return null
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported?.(m)) || null
}

// Graba en tiempo real sobre el lienzo dado (que se ve en pantalla mientras tanto). Devuelve { blob, mime }.
export function record(canvas, o, { onProgress, signal } = {}) {
  const mime = videoMime()
  if (!mime) return Promise.reject(new Error('NO_RECORDER'))
  const ctx = canvas.getContext('2d')
  const stream = canvas.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  return new Promise((resolve, reject) => {
    let t0 = null, raf
    rec.onstop = () => { cancelAnimationFrame(raf); signal?.aborted ? reject(new DOMException('aborted', 'AbortError')) : resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), mime }) }
    const frame = (now) => {
      if (t0 == null) t0 = now
      const tt = (now - t0) / 1000
      drawFrame(ctx, Math.min(tt, o.sc.duration), o)
      onProgress?.(tt / o.sc.duration)
      if (tt >= o.sc.duration + 0.3 || signal?.aborted) { rec.state !== 'inactive' && rec.stop(); return }
      raf = requestAnimationFrame(frame)
    }
    drawFrame(ctx, 0, o)
    rec.start(250)
    raf = requestAnimationFrame(frame)
  })
}

// ── Exportación fotograma a fotograma (WebCodecs + mp4mux): fluida a 60 fps aunque el móvil vaya justo,
// porque cada fotograma se dibuja y se codifica con su tiempo exacto (no depende del tiempo real) ──
const CODECS = [['avc1.64002A', 60], ['avc1.4D402A', 60], ['avc1.640028', 30], ['avc1.4D4028', 30], ['avc1.42E028', 30]]
export async function encoderConfig() {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null
  for (const [codec, fps] of CODECS) {
    const cfg = { codec, width: W, height: H, bitrate: fps === 60 ? 5_000_000 : 4_000_000, framerate: fps, avc: { format: 'avc' }, latencyMode: 'realtime', hardwareAcceleration: 'no-preference' }
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { cfg, fps } } catch { /* siguiente */ }
  }
  return null
}

export async function exportMp4(canvas, o, { onProgress, signal, setup } = {}) {
  const ec = setup || (await encoderConfig())
  if (!ec) throw new Error('NO_WEBCODECS')
  const mux = (await import('./mp4mux')).muxMp4
  const { cfg, fps } = ec
  const ctx = canvas.getContext('2d')
  const samples = []
  let avcC = null, failed = null, lastTs = -1, ordered = true
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description && !avcC) avcC = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer)
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data)
      if (chunk.timestamp < lastTs) ordered = false
      lastTs = chunk.timestamp
      samples.push({ data, key: chunk.type === 'key' })
    },
    error: (e) => { failed = e },
  })
  encoder.configure(cfg)
  const frames = Math.ceil(o.sc.duration * fps) + Math.round(fps * 0.3)
  const usPerFrame = 1e6 / fps
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) { encoder.close(); throw new DOMException('aborted', 'AbortError') }
    if (failed) throw failed
    drawFrame(ctx, Math.min(i / fps, o.sc.duration), o)
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * usPerFrame), duration: Math.round(usPerFrame) })
    encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 })
    vf.close()
    // Sin saturar el codificador y dejando respirar a la pantalla (se ve la vista previa avanzar)
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4))
    if (i % 6 === 0) { onProgress?.(i / frames); await new Promise((r) => setTimeout(r, 0)) }
  }
  await encoder.flush(); encoder.close()
  if (failed) throw failed
  if (!avcC || !ordered || !samples.length) throw new Error('MUX')
  onProgress?.(1)
  return { blob: mux({ width: W, height: H, fps, samples, avcC }), mime: 'video/mp4', fps }
}
