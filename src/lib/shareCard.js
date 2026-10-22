// Tarjeta vertical (1080×1920) de una inmersión para compartir en stories, con el aspecto del sistema de diseño:
// fondo abisal (o la foto con una capa oscura), el punto en mayúsculas grandes, tres cifras y el medidor de profundidad.
// Todo se dibuja en el móvil: no se sube nada a ningún servidor.
import { t, locale } from './i18n'
import { TZ } from './format'

const W = 1080, H = 1920, X = 64
const BANDS = [[0, 5, '#7fd6d0'], [5, 18, '#2fb3b8'], [18, 30, '#1a7fa8'], [30, 40, '#134f7a']]
const CORAL = '#f0604d'
const DATA = '"Barlow Condensed", "Arial Narrow", sans-serif'
const UI = 'Figtree, -apple-system, "Segoe UI", Roboto, sans-serif'

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

// Texto con espaciado entre letras (canvas no siempre soporta letterSpacing)
function spaced(ctx, text, x, y, spacing) {
  if ('letterSpacing' in ctx) { ctx.letterSpacing = spacing + 'px'; ctx.fillText(text, x, y); ctx.letterSpacing = '0px'; return }
  let cx = x
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing }
}

// Parte el nombre del punto en un máximo de dos líneas; si no cabe, termina en «…»
function twoLines(ctx, text, max) {
  const words = text.split(/\s+/)
  const lines = ['']
  for (const w of words) {
    const tryLine = (lines[lines.length - 1] + ' ' + w).trim()
    if (ctx.measureText(tryLine).width <= max || !lines[lines.length - 1]) lines[lines.length - 1] = tryLine
    else lines.push(w)
  }
  if (lines.length > 2) { lines.length = 2; lines[1] += '…' }
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i]
    while (ctx.measureText(l).width > max && l.length > 1) l = l.slice(0, -2) + '…'
    lines[i] = l
  }
  return lines
}

async function draw({ log, photoUrl, centerName, isRecord }) {
  await Promise.all([document.fonts.load('600 160px "Barlow Condensed"'), document.fonts.load('800 40px Figtree'), document.fonts.load('700 30px Figtree'), document.fonts.load('500 38px Figtree')]).catch(() => {})
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.textBaseline = 'alphabetic'

  // Fondo: abisal liso o la foto cubriendo todo con una capa oscura
  ctx.fillStyle = '#0b1f2c'; ctx.fillRect(0, 0, W, H)
  if (photoUrl) {
    try {
      const img = await loadImage(photoUrl)
      const k = Math.max(W / img.width, H / img.height)
      const w = img.width * k, h = img.height * k
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
      ctx.fillStyle = 'rgba(11,31,44,.55)'; ctx.fillRect(0, 0, W, H)
    } catch { /* si la foto falla, se queda el fondo liso */ }
  }

  // Marca: bandera de buceo y «DivingSlot»
  ctx.fillStyle = '#d62828'; ctx.fillRect(X, 96, 54, 36)
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(X, 96); ctx.lineTo(X + 11, 96); ctx.lineTo(X + 54, 125); ctx.lineTo(X + 54, 132); ctx.lineTo(X + 43, 132); ctx.lineTo(X, 103); ctx.closePath(); ctx.fill()
  ctx.font = '800 40px ' + UI; ctx.fillText('DivingSlot', X + 72, 128)

  const max = +log.max_depth_m || 0, avg = +log.avg_depth_m || 0

  // Récord: etiqueta coral arriba a la derecha
  if (isRecord && max) {
    ctx.font = '700 34px ' + UI
    const txt = t('Nuevo récord · {n} m', { n: max })
    const w = ctx.measureText(txt).width + 48
    ctx.fillStyle = CORAL; roundRect(ctx, W - X - w, 82, w, 64, 20); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.fillText(txt, W - X - w + 24, 126)
  }

  // Medidor de profundidad (0–40 m) a la derecha
  if (max) {
    const top = 260, bottom = 1160, tx = 900, tw = 36, scale = 40
    const yOf = (m) => top + (Math.min(m, scale) / scale) * (bottom - top)
    ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(ctx, tx, top, tw, bottom - top, 18); ctx.fill()
    ctx.save(); roundRect(ctx, tx, top, tw, yOf(max) - top, 18); ctx.clip()
    for (const [a, b, col] of BANDS) { if (a >= max) break; ctx.fillStyle = col; ctx.fillRect(tx, yOf(a), tw, yOf(Math.min(b, max)) - yOf(a)) }
    ctx.restore()
    ctx.font = '600 34px ' + DATA; ctx.fillStyle = 'rgba(255,255,255,.55)'
    for (let m = 0; m <= scale; m += 10) ctx.fillText(String(m), tx + tw + 14, yOf(m) + 12)
    ctx.textAlign = 'right'; ctx.font = '600 38px ' + DATA
    ctx.fillStyle = '#fff'; ctx.fillText(t('Máx. {n} m', { n: max }).toUpperCase(), tx - 22, yOf(max) + 13)
    if (avg) {
      ctx.fillStyle = CORAL; ctx.fillRect(tx - 6, yOf(avg) - 4, tw + 12, 8)
      ctx.fillText(t('Media {n} m', { n: avg }).toUpperCase(), tx - 22, Math.abs(yOf(avg) - yOf(max)) < 50 ? yOf(avg) - 40 : yOf(avg) + 13)
    }
    ctx.textAlign = 'left'
  }

  // Abajo, de abajo arriba: cifras, línea, centro, nombre del punto y fecha
  const stats = [
    [t('Prof. máx.'), max || null, 'm'],
    [t('Tiempo'), log.duration_min || null, 'min'],
    [t('Agua'), +log.water_temp_c || null, '°C'],
  ].filter(([, v]) => v != null)
  let x = X
  for (const [label, v, unit] of stats) {
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '700 26px ' + UI; spaced(ctx, label.toUpperCase(), x, 1690, 3)
    ctx.fillStyle = '#fff'; ctx.font = '600 110px ' + DATA; ctx.fillText(String(v), x, 1800)
    const vw = ctx.measureText(String(v)).width
    ctx.font = '600 40px ' + DATA; ctx.fillText(unit, x + vw + 6, 1800)
    x += Math.max(vw + ctx.measureText(unit).width + 70, 280)
  }
  let y = stats.length ? 1630 : 1800
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(X, y, W - 2 * X, 2)
  y -= 44
  if (centerName) { ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.font = '500 38px ' + UI; ctx.fillText(centerName, X, y); y -= 64 }
  ctx.font = '600 190px ' + DATA; ctx.fillStyle = '#fff'
  const lines = twoLines(ctx, (log.site_name || t('Inmersión')).toUpperCase(), W - 2 * X)
  for (let i = lines.length - 1; i >= 0; i--) { ctx.fillText(lines[i], X, y); y -= 168 }
  if (log.dive_date) {
    const date = new Intl.DateTimeFormat(locale(), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
      .format(new Date(log.dive_date + 'T12:00:00+08:00')).replace(/,/g, '').replace(/\./g, '').replace(/ de /gi, ' ').toUpperCase()
    // y está ahora una línea por encima del nombre: la fecha va justo encima de las mayúsculas de la primera línea
    ctx.fillStyle = '#fff'; ctx.font = '700 30px ' + UI; spaced(ctx, date, X, y - 4, 4)
  }

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'))
}

// Devuelve un Blob PNG. Si la foto impide exportar el lienzo (CORS), se repite sin foto.
export async function drawShareCard(log, { photoUrl, centerName, isRecord } = {}) {
  try { return await draw({ log, photoUrl, centerName, isRecord }) } catch (e) {
    if (photoUrl) return draw({ log, photoUrl: null, centerName, isRecord })
    throw e
  }
}
