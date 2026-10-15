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
    document.title = t('DiveSlot · Salidas de buceo en Panglao')
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

// Selector compacto (cabecera) o en forma de botones (perfil / login)
export function LangSwitch({ full }) {
  const { lang, setLang } = useLang()
  if (full) {
    return (
      <div className="row" style={{ gap: 8 }}>
        {LANGS.map(([k, n]) => (
          <button key={k} type="button" className={lang === k ? 'btn small' : 'btn small ghost'} onClick={() => setLang(k)}>{n}</button>
        ))}
      </div>
    )
  }
  return (
    <select aria-label="Language / Idioma" value={lang} onChange={(e) => setLang(e.target.value)} className="lang-select">
      {LANGS.map(([k]) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
    </select>
  )
}
