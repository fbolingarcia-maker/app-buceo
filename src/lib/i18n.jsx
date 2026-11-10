import { createContext, useContext, useEffect, useState } from 'react'
import EN from './i18n-en'
import DE from './lang-de'
import KO from './lang-ko'
import JA from './lang-ja'
import ZH from './lang-zh'

// Idiomas extra (9 nov 2026): solo las pantallas del buceador (buscar, reservar, pagar, entrar). Lo que falta sale en inglés.
const EXTRA = { de: DE, ko: KO, ja: JA, zh: ZH }

// Idiomas disponibles. El texto base del código está en español; EN traduce cada frase.
export const LANGS = [
  ['en', 'English'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['ko', '한국어'],
  ['ja', '日本語'],
  ['zh', '中文'],
]

function initialLang() {
  try {
    const s = localStorage.getItem('lang')
    if (LANGS.some(([k]) => k === s)) return s
  } catch {}
  const nav = (navigator.language || '').toLowerCase().slice(0, 2)
  return LANGS.some(([k]) => k === nav) ? nav : 'en'
}

let current = initialLang()
export const getLang = () => current
// Locale para Intl (fechas y horas)
const LOCALES = { es: 'es-ES', de: 'de-DE', ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN' }
export const locale = () => LOCALES[current] || 'en-GB'

// Ejemplo: t con 'Quedan {n} plazas' y { n: 3 } -> "3 seats left" en inglés
export function t(s, vars) {
  let r = current === 'es' ? s : EXTRA[current]?.[s] ?? EN[s] ?? s
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m))
  return r
}

const LangCtx = createContext({ lang: current, setLang: () => {} })

export function LangProvider({ children }) {
  const [lang, setState] = useState(current)
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t('DivingSlot · Salidas de buceo en Filipinas')
  }, [lang])
  const setLang = (l) => {
    current = l
    try { localStorage.setItem('lang', l) } catch {}
    setState(l)
    // Con sesión, el Worker guarda el idioma nuevo en el perfil (los emails llegan solo en ese idioma)
    if (import.meta.env.VITE_BACKEND === 'cloudflare') fetch('/api/auth/session', { credentials: 'same-origin', headers: { 'X-DivingSlot': '1', 'X-Lang': l } }).catch(() => {})
  }
  // key={lang}: al cambiar de idioma se vuelve a pintar toda la app con el idioma nuevo
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <div key={lang} style={{ display: 'contents' }}>{children}</div>
    </LangCtx.Provider>
  )
}

export const useLang = () => useContext(LangCtx)

// Selector de idioma como control segmentado (Perfil → Ajustes). Cada idioma se nombra en su propio idioma.
export function LangSwitch() {
  const { lang, setLang } = useLang()
  // Seis idiomas: un desplegable (cada idioma con su propio nombre)
  return (
    <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language / Idioma" style={{ width: 'auto' }}>
      {LANGS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
    </select>
  )
}
