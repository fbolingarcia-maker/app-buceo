import { createContext, useContext, useEffect, useState } from 'react'
import EN from './i18n-en'

// Idiomas disponibles. El texto base del código está en español; EN traduce cada frase.
export const LANGS = [
  ['en', 'English'],
  ['es', 'Español'],
]

function initialLang() {
  try {
    const s = localStorage.getItem('lang')
    if (LANGS.some(([k]) => k === s)) return s
  } catch {}
  return (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en'
}

let current = initialLang()
export const getLang = () => current
// Locale para Intl (fechas y horas)
export const locale = () => (current === 'es' ? 'es-ES' : 'en-GB')

// Ejemplo: t con 'Quedan {n} plazas' y { n: 3 } -> "3 seats left" en inglés
export function t(s, vars) {
  let r = current === 'es' ? s : EN[s] ?? s
  if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m))
  return r
}

const LangCtx = createContext({ lang: current, setLang: () => {} })

export function LangProvider({ children }) {
  const [lang, setState] = useState(current)
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t('DiveSlot · Salidas de buceo en Filipinas')
  }, [lang])
  const setLang = (l) => {
    current = l
    try { localStorage.setItem('lang', l) } catch {}
    setState(l)
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
  return (
    <div className="seg" role="group" aria-label="Language / Idioma" style={{ margin: 0, flexWrap: 'nowrap' }}>
      {LANGS.map(([k, n]) => (
        <button key={k} type="button" className={lang === k ? 'on' : ''} aria-pressed={lang === k} onClick={() => setLang(k)}>{n}</button>
      ))}
    </div>
  )
}
