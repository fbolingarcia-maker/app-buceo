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

// Zonas de puntos de buceo que pertenecen a otro destino (se bucean desde allí)
export const EXTRA_AREAS = {
  Panglao: ['Balicasag', 'Pamilacan'],
  Dauin: ['Apo Island'],
  'Puerto Galera': ['Verde Island'],
  'Sogod Bay': ['Southern Leyte'],
  'Puerto Princesa': ['Tubbataha'],
}

// Destino desde el que se bucea una zona de puntos de buceo
export function destForArea(area, dests = []) {
  if (dests.some((d) => d.name === area)) return area
  return Object.keys(EXTRA_AREAS).find((k) => EXTRA_AREAS[k].includes(area)) || null
}

// Puntos de buceo (nombre y zona), para buscar por punto o isla
let sitesCache = null
export function loadSiteAreas() {
  if (!sitesCache) {
    sitesCache = supabase.from('dive_sites').select('name, area').then(({ data }) => data || []).catch(() => [])
  }
  return sitesCache
}

// Sugerencias para el buscador: destinos, provincias, grupos de islas y puntos de buceo que encajan con el texto
export function suggestPlaces(q, dests, sites = []) {
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
  // Puntos de buceo e islas (Balicasag, Apo Island, Tubbataha…) llevan a su destino
  if (w.length >= 3) {
    for (const st of sites) {
      if (!norm(st.name).includes(w) && !norm(st.area || '').includes(w)) continue
      const dest = destForArea(st.area, dests)
      if (dest) add('dest', dest, '🤿 ' + (norm(st.area || '').includes(w) && st.area !== dest ? st.area : st.name))
    }
  }
  // Las coincidencias que empiezan por el texto, primero
  return out.sort((a, b) => (norm(b.name).startsWith(w) ? 1 : 0) - (norm(a.name).startsWith(w) ? 1 : 0)).slice(0, 8)
}

// Valoraciones públicas de los centros (media de la bitácora compartida): { [center_id]: { rating, reviews } }
let ratingsCache = null
export function loadRatings() {
  if (!ratingsCache) {
    ratingsCache = supabase.rpc('center_ratings')
      .then(({ data }) => Object.fromEntries((data || []).map((r) => [r.center_id, r])))
      .catch(() => ({}))
  }
  return ratingsCache
}

// Abre la lista de salidas filtrada por un lugar
export function openTripsIn(place) {
  try { sessionStorage.setItem('place', JSON.stringify(place)); sessionStorage.removeItem('q') } catch {}
  window.location.hash = '/'
}
