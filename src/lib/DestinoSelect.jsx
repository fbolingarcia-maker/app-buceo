import { useEffect, useState } from 'react'
import { t } from './i18n'
import { loadDestinations, GROUPS } from './places'

// Selector de destino de buceo (agrupado por islas). value = nombre del destino
export default function DestinoSelect({ value, onChange, required }) {
  const [dests, setDests] = useState([])
  useEffect(() => { loadDestinations().then(setDests) }, [])
  return (
    <select value={value || ''} required={required} onChange={(e) => onChange(e.target.value, dests.find((d) => d.name === e.target.value))}>
      <option value="">{t('Elige el destino…')}</option>
      {GROUPS.map((g) => {
        const ds = dests.filter((d) => d.island_group === g)
        return ds.length ? (
          <optgroup key={g} label={g}>
            {ds.map((d) => <option key={d.name} value={d.name}>{d.name} ({d.province})</option>)}
          </optgroup>
        ) : null
      })}
    </select>
  )
}
