import { useEffect, useState } from 'react'

// Centros favoritos del buceador (como «Mis clubs» de Playtomic o el centro favorito de PADI Adventures).
// Se guardan en este navegador (localStorage), sin cuenta: así también sirven antes de registrarse.
// Salen primero en Salidas y se pueden filtrar con «Mis centros».
const KEY = 'favCenters'
const EVENT = 'ds-favs'

export function getFavs() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch (e) { return [] }
}

export function setFav(id, on) {
  const cur = getFavs().filter((x) => x !== id)
  const next = on ? [id, ...cur].slice(0, 50) : cur
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch (e) { /* sin almacenamiento */ }
  window.dispatchEvent(new Event(EVENT))
  return next
}

// Lista de favoritos que se actualiza si cambia en otra pantalla o en otra pestaña
export function useFavs() {
  const [favs, setFavs] = useState(getFavs)
  useEffect(() => {
    const upd = () => setFavs(getFavs())
    window.addEventListener(EVENT, upd)
    window.addEventListener('storage', upd)
    return () => { window.removeEventListener(EVENT, upd); window.removeEventListener('storage', upd) }
  }, [])
  return favs
}
