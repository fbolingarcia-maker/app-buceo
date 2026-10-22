// Visitas anónimas (sin cookies): cada pantalla vista se avisa al Worker en /api/hit, que cuenta visitas por día,
// página, país, dispositivo y de dónde llegan. Los identificadores de las rutas se quitan (#/salida/<id> → /salida/:id).
// Los administradores no cuentan: el panel marca el navegador con «ds_notrack».
import { getLang } from './i18n'

let first = true
export function trackView(route) {
  try {
    if (localStorage.getItem('ds_notrack') === '1') return
  } catch { /* sin almacenamiento: se cuenta igual */ }
  if (location.protocol !== 'https:' || /github\.io$/.test(location.host) || !navigator.sendBeacon) return
  const p = '/app' + (route === '/' ? '' : route.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/(t\d+-\d+|mt\d+)/g, '/:id'))
  let r = ''
  if (first) {
    try { const h = document.referrer && new URL(document.referrer).host; if (h && h !== location.host) r = h } catch { /* nada */ }
    first = false
  }
  try { navigator.sendBeacon('/api/hit', new Blob([JSON.stringify({ p, r, l: getLang() })], { type: 'text/plain' })) } catch { /* nada */ }
}
