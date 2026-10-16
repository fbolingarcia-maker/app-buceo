import { getLang } from './i18n'

// Idiomas que un centro puede marcar (códigos ISO 639-1) con su bandera
export const CENTER_LANGS = [
  { code: 'en', cc: 'gb', es: 'Inglés', en: 'English' },
  { code: 'es', cc: 'es', es: 'Español', en: 'Spanish' },
  { code: 'tl', cc: 'ph', es: 'Filipino', en: 'Filipino' },
  { code: 'de', cc: 'de', es: 'Alemán', en: 'German' },
  { code: 'fr', cc: 'fr', es: 'Francés', en: 'French' },
  { code: 'it', cc: 'it', es: 'Italiano', en: 'Italian' },
  { code: 'nl', cc: 'nl', es: 'Neerlandés', en: 'Dutch' },
  { code: 'pt', cc: 'pt', es: 'Portugués', en: 'Portuguese' },
  { code: 'ru', cc: 'ru', es: 'Ruso', en: 'Russian' },
  { code: 'zh', cc: 'cn', es: 'Chino', en: 'Chinese' },
  { code: 'ja', cc: 'jp', es: 'Japonés', en: 'Japanese' },
  { code: 'ko', cc: 'kr', es: 'Coreano', en: 'Korean' },
]

const byCode = Object.fromEntries(CENTER_LANGS.map((l) => [l.code, l]))
export const langName = (code) => byCode[code]?.[getLang() === 'es' ? 'es' : 'en'] || code

// Bandera como imagen (los emojis de bandera no se ven en Windows)
export function FlagImg({ code, size = 16 }) {
  const l = byCode[code]
  if (!l) return null
  const h = Math.round(size * 0.75)
  return <img className="flag" src={'https://flagcdn.com/w40/' + l.cc + '.png'} width={Math.round(h * 4 / 3)} height={h} alt={langName(code)} title={langName(code)} loading="lazy" />
}

// Banderas de una lista de idiomas, con el nombre como texto alternativo
export function Flags({ codes, size = 16 }) {
  if (!codes?.length) return null
  return (
    <span className="flags">
      {codes.filter((c) => byCode[c]).map((c) => <FlagImg key={c} code={c} size={size} />)}
    </span>
  )
}
