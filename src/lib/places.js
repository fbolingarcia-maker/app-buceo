import { supabase } from './supabase'
import { norm } from './geo'

// Destinos de buceo de Filipinas (tabla `destinations`), cargados una vez por sesión
let cache = null
export function loadDestinations() {
  if (!cache) {
    cache = supabase.from('destinations').select('*').order('name')
      .then(({ data }) => data || [])
      .catch(() => [])
  }
  return cache
}

// Orden en que se muestran los grupos de islas
export const GROUPS = ['Luzon', 'Mindoro', 'Visayas', 'Palawan', 'Romblon', 'Mindanao']

// Lugar elegido: { kind: 'dest' | 'prov' | 'group', name }
export const placeLabel = (p, dests = []) => {
  if (!p) return ''
  if (p.kind === 'dest') {
    const d = dests.find((x) => x.name === p.name)
    return d ? `${d.name}, ${d.province}` : p.name
  }
  return p.name
}

// ¿Este centro / salida está en el lugar elegido?
// obj: { destination, province, area, locality }
export function inPlace(obj, place, dests = []) {
  if (!place) return true
  const dest = obj.destination || obj.area
  if (place.kind === 'dest') return dest === place.name
  if (place.kind === 'prov') return (obj.province || dests.find((d) => d.name === dest)?.province) === place.name
  const group = dests.find((d) => d.name === dest)?.island_group
  return group === place.name
}

// Sugerencias para el buscador: destinos, provincias y grupos de islas que encajan con el texto
export function suggestPlaces(q, dests) {
  const w = norm(q).trim()
  if (!w) return []
  const out = []
  const seen = new Set()
  const add = (kind, name, sub) => {
    const k = kind + ':' + name
    if (!seen.has(k)) { seen.add(k); out.push({ kind, name, sub }) }
  }
  for (const d of dests) if (norm(d.name).includes(w)) add('dest', d.name, d.province)
  for (const d of dests) if (norm(d.province).includes(w)) add('prov', d.province, d.island_group)
  for (const d of dests) if (norm(d.island_group).includes(w)) add('group', d.island_group, null)
  // Las coincidencias que empiezan por el texto, primero
  return out.sort((a, b) => (norm(b.name).startsWith(w) ? 1 : 0) - (norm(a.name).startsWith(w) ? 1 : 0)).slice(0, 8)
}
