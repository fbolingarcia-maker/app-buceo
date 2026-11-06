// Condiciones del mar para una salida: GET /api/sea?trip=<id>
// Previsión de olas y mar de fondo (Open-Meteo Marine) y de viento y lluvia (Open-Meteo Forecast) en la ubicación del
// centro (o del destino) durante las horas de la salida, con un aviso de posible cancelación, y la visibilidad que han
// anotado los buceadores en la bitácora en esos puntos (últimos 45 días). Sin claves; se guarda en caché 30 min.
import { json, first, all } from './lib/util.js'
import { rateLimit } from './auth.js'

const MARINE = 'https://marine-api.open-meteo.com/v1/marine'
const WEATHER = 'https://api.open-meteo.com/v1/forecast'

// Umbrales orientativos para barcos de buceo (bangka): a partir de «rough» muchos centros cancelan
export function seaLevel({ wave_m, wind_kmh, gust_kmh }) {
  const w = wave_m ?? 0, v = wind_kmh ?? 0, g = gust_kmh ?? 0
  if (w >= 1.5 || v >= 30 || g >= 45) return 'rough'
  if (w >= 1 || v >= 20 || g >= 35) return 'moderate'
  return 'good'
}

async function getJson(url) {
  const r = await fetch(url, { cf: { cacheTtl: 1800, cacheEverything: true } })
  if (!r.ok) throw new Error('open-meteo ' + r.status)
  return r.json()
}

// Valores por hora (UTC) → máximo/media en la ventana [desde, hasta)
function windowStats(h, keys, from, to) {
  const out = {}
  if (!h?.time) return out
  const idx = h.time.map((x, i) => [Date.parse(x + 'Z'), i]).filter(([ms]) => ms >= from && ms < to).map(([, i]) => i)
  for (const [k, mode] of keys) {
    const v = idx.map((i) => h[k]?.[i]).filter((x) => typeof x === 'number')
    out[k] = v.length ? (mode === 'avg' ? v.reduce((a, b) => a + b, 0) / v.length : Math.max(...v)) : null
  }
  return out
}
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10)

export async function handleSea(req, env, url) {
  const id = url.searchParams.get('trip') || ''
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'salida no válida' }, 400)
  await rateLimit(env, 'sea:' + (req.headers.get('CF-Connecting-IP') || ''), 60, 60)
  const out = await tripSea(env, id)
  if (!out) return json({ error: 'salida no encontrada' }, 404)
  return json(out, 200, { 'Cache-Control': 'public, max-age=1800' })
}

// Previsión y visibilidad de una salida (también la usa el recordatorio del día antes, en cron.js)
export async function tripSea(env, id) {
  const t = await first(env.DB, `SELECT t.departs_at, t.num_dives, t.status, c.lat, c.lng, d.lat AS dlat, d.lng AS dlng
    FROM trips t JOIN centers c ON c.id = t.center_id LEFT JOIN destinations d ON d.name = c.destination WHERE t.id = ?`, id)
  if (!t || t.status === 'draft') return null
  const sites = await all(env.DB, 'SELECT ds.id, ds.name FROM trip_sites ts JOIN dive_sites ds ON ds.id = ts.site_id WHERE ts.trip_id = ?', id)

  // Visibilidad anotada en la bitácora (solo la media y cuántas, con 2 o más inmersiones)
  let visibility = null
  if (sites.length) {
    const ph = sites.map(() => '?').join(',')
    const v = await first(env.DB, `SELECT round(avg(visibility_m)) AS avg_m, count(*) AS n, max(dive_date) AS last FROM dive_logs
      WHERE visibility_m IS NOT NULL AND dive_date >= date('now', '-45 days') AND (site_id IN (${ph}) OR site_name IN (${ph}))`,
    ...sites.map((s) => s.id), ...sites.map((s) => s.name))
    if (v?.n >= 2) visibility = { avg_m: v.avg_m, n: v.n, last: v.last }
  }

  const lat = t.lat ?? t.dlat, lng = t.lng ?? t.dlng
  const dep = Date.parse(t.departs_at)
  const ahead = (dep - Date.now()) / 36e5
  let forecast = null, reason = null
  if (lat == null || lng == null) reason = 'no_location'
  else if (ahead < -6) reason = 'past'
  else if (ahead > 7 * 24) reason = 'too_far'
  else {
    const q = `latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&timezone=GMT&forecast_days=8`
    const [m, w] = await Promise.allSettled([
      getJson(`${MARINE}?${q}&hourly=wave_height,swell_wave_height,wave_period`),
      getJson(`${WEATHER}?${q}&hourly=wind_speed_10m,wind_gusts_10m,precipitation_probability&wind_speed_unit=kmh`),
    ])
    const from = Math.floor(dep / 36e5) * 36e5, to = dep + Math.min(6, Math.max(2, (t.num_dives || 2) * 1.5)) * 36e5
    const ms = m.status === 'fulfilled' ? windowStats(m.value.hourly, [['wave_height'], ['swell_wave_height'], ['wave_period', 'avg']], from, to) : {}
    const ws = w.status === 'fulfilled' ? windowStats(w.value.hourly, [['wind_speed_10m'], ['wind_gusts_10m'], ['precipitation_probability']], from, to) : {}
    if (m.status === 'rejected' && w.status === 'rejected') reason = 'unavailable'
    else {
      forecast = {
        wave_m: r1(ms.wave_height), swell_m: r1(ms.swell_wave_height), period_s: r1(ms.wave_period),
        wind_kmh: ws.wind_speed_10m == null ? null : Math.round(ws.wind_speed_10m),
        gust_kmh: ws.wind_gusts_10m == null ? null : Math.round(ws.wind_gusts_10m),
        rain_pct: ws.precipitation_probability ?? null,
      }
      forecast.level = seaLevel(forecast)
    }
  }
  const at = lat != null && lng != null ? { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 } : null
  return { forecast, reason, visibility, at, source: 'Open-Meteo' }
}
