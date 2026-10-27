// Páginas legales (privacidad, términos y cancelaciones): mismo estilo que la landing, en inglés y español.
// Cada página lleva los dos idiomas en <article lang="en"> y <article lang="es">; se muestra el de la app.
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/600.css'
import '@fontsource/figtree/700.css'
import '@fontsource/figtree/800.css'
import '../landing/landing.css'
import './legal.css'

function initialLang() {
  try { const s = localStorage.getItem('lang'); if (s === 'es' || s === 'en') return s } catch { /* sin almacenamiento */ }
  return (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en'
}
function setLang(l, save) {
  document.documentElement.lang = l
  document.querySelectorAll('[data-lang]').forEach((el) => { el.hidden = el.dataset.lang !== l })
  const title = document.querySelector(`h1[data-lang="${l}"]`)
  if (title) document.title = title.textContent + ' · DivingSlot'
  const btn = document.getElementById('lang')
  btn.textContent = l === 'es' ? 'EN' : 'ES'
  btn.setAttribute('aria-label', l === 'es' ? 'English' : 'Español')
  btn.onclick = () => setLang(l === 'es' ? 'en' : 'es', true)
  if (save) try { localStorage.setItem('lang', l) } catch { /* sin almacenamiento */ }
}
const start = () => setLang(initialLang(), false)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
