// Web comercial (landing) de DivingSlot en la raíz del dominio. La app vive en /app/.
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/600.css'
import '@fontsource/figtree/700.css'
import '@fontsource/figtree/800.css'
import '@fontsource/barlow-condensed/600.css'
import './landing.css'

const APP = import.meta.env.BASE_URL + 'app/'

// 1. Enlaces antiguos: la app estaba en la raíz con rutas por hash (#/salida/…, #access_token=… de los emails,
//    vuelta de PayMongo…). Todo lo que traiga hash o parámetros de sesión sigue a la app con lo mismo.
//    También la app instalada en el móvil (pantalla completa) abre directamente la app.
{
  const { hash, search } = window.location
  const authQuery = /[?&](code|token|token_hash|type|error|error_description)=/.test(search)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone
  if ((hash && hash !== '#') || authQuery || standalone) window.location.replace(APP + search + hash)
}

// 2. Idioma: el mismo que la app (localStorage «lang»), si no el del navegador
const ES = {
  nav_sites: 'Puntos de buceo',
  nav_centres: 'Centros de buceo',
  open_app: 'Abrir la app',
  eyebrow: 'Salidas de buceo en Filipinas',
  h1: 'Reserva tu plaza y a bucear',
  lead: 'Mira las salidas en barco que tienen los centros de buceo en los próximos 8 días, cuántas plazas quedan y reserva en un minuto con una señal del 50 %.',
  cta_trips: 'Buscar salida',
  cta_sites: 'Ver puntos de buceo',
  fine: 'Paga con tarjeta o GCash. El resto, en la app o en efectivo en el centro.',
  mock_today: 'Hoy',
  mock_tue: 'Mar',
  mock_wed: 'Mié',
  mock_thu: 'Jue',
  mock_from: 'desde',
  mock_site: '5–30 m · Bola de sardinas',
  mock_3: '3 plazas',
  mock_6: '6 plazas',
  mock_last: 'Última plaza',
  st_sites: 'puntos de buceo',
  st_areas: 'zonas de buceo',
  st_centres: 'centros de buceo',
  st_deposit: 'de señal para reservar',
  how_title: 'Cómo funciona',
  s1_t: 'Elige día y zona',
  s1_p: 'Panglao, Moalboal, Anilao, Coron… Todas las salidas en barco de los próximos 8 días, agrupadas por centro.',
  s2_t: 'Mira las plazas y quién va',
  s2_p: 'Nivel mínimo, puntos de buceo, precio con o sin equipo y los buceadores que ya van en el barco.',
  s3_t: 'Reserva con el 50 % de señal',
  s3_p: 'Paga con tarjeta o GCash. El resto, en la app o en efectivo en el centro.',
  feat_title: 'Todo para tu día de buceo',
  f1_t: 'Guía de puntos de buceo',
  f1_p: 'Profundidad, nivel y qué se ve en más de 150 puntos de toda Filipinas, agrupados por zona.',
  f2_t: 'Tu bitácora',
  f2_p: 'Guarda cada inmersión con profundidad, tiempo, fauna y fotos, y compártela con tu buddy.',
  f3_t: 'Mira quién va',
  f3_p: 'Antes de reservar, sabes quién va en el barco: nivel, número de inmersiones e idiomas.',
  f4_t: 'Directorio de centros',
  f4_p: 'Más de 190 centros con sus agencias, idiomas y contacto, de Batangas a Mindanao.',
  dest_title: 'Dónde bucear',
  dest_all: 'Todas las zonas',
  c_title: '¿Tienes un centro de buceo?',
  c_p: 'Publica tus salidas, llena tus barcos y cobra la señal online. Reservas, el manifiesto del día y los cobros en un solo sitio.',
  c_cta: 'Dar de alta mi centro',
  faq_title: 'Preguntas',
  q1: '¿Dónde puedo reservar?',
  a1: 'Panglao (Bohol) es la primera zona con reservas online. En el resto de Filipinas ya puedes consultar los puntos de buceo y contactar directamente con los centros.',
  q2: '¿Cómo se paga?',
  a2: 'Pagas una señal de al menos el 50 % con tarjeta o GCash para confirmar tu plaza. El resto, en la app o en efectivo en el centro.',
  q3: '¿Y si el mar está mal?',
  a3: 'Si el centro cancela la salida por el estado del mar, se te devuelve todo lo pagado.',
  q4: '¿Necesito una cuenta?',
  a4: 'Puedes ver salidas, puntos de buceo y centros sin cuenta. Para reservar o llevar tu bitácora, crea una cuenta gratis.',
  privacy: 'Privacidad',
  terms: 'Términos',
  contact: 'Contacto',
  privacy: 'Privacidad',
  terms: 'Términos',
  contact: 'Contacto',
  final_t: 'Tu próxima inmersión, a un toque',
}
const TITLE = { en: 'DivingSlot · Book dive trips in the Philippines', es: 'DivingSlot · Reserva salidas de buceo en Filipinas' }
const EN = {}
document.querySelectorAll('[data-i18n]').forEach((el) => { EN[el.dataset.i18n] = el.textContent })

function initialLang() {
  try {
    const s = localStorage.getItem('lang')
    if (s === 'es' || s === 'en') return s
  } catch { /* sin almacenamiento */ }
  return (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en'
}
function setLang(l, save) {
  const dict = l === 'es' ? ES : EN
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = dict[el.dataset.i18n]; if (v) el.textContent = v })
  document.documentElement.lang = l
  document.title = TITLE[l]
  const btn = document.getElementById('lang')
  btn.textContent = l === 'es' ? 'EN' : 'ES'
  btn.setAttribute('aria-label', l === 'es' ? 'English' : 'Español')
  btn.onclick = () => setLang(l === 'es' ? 'en' : 'es', true)
  if (save) try { localStorage.setItem('lang', l) } catch { /* sin almacenamiento */ }
}

function start() {
  setLang(initialLang(), false)
  document.getElementById('year').textContent = String(new Date().getFullYear())
  // 3. Visitas: un aviso anónimo por página vista (sin cookies). Lo cuenta el Worker en /api/hit.
  try {
    const ref = document.referrer && new URL(document.referrer).host !== location.host ? new URL(document.referrer).host : ''
    const body = JSON.stringify({ p: '/', r: ref, l: document.documentElement.lang })
    let mine = false
    try { mine = localStorage.getItem('ds_notrack') === '1' } catch { /* nada */ }
    if (!mine && location.protocol === 'https:' && !/github\.io$/.test(location.host)) navigator.sendBeacon?.('/api/hit', new Blob([body], { type: 'text/plain' }))
  } catch { /* nada */ }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
