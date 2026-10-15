import { t } from './i18n'

// Texto sin acentos y en minúsculas, para buscar "danao" = "Danao"
export const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Distancia en km entre dos puntos (fórmula del haversine)
export function distKm(a, b) {
  const r = Math.PI / 180
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(x))
}

export const kmLabel = (km) => t('a {km} km', { km: km < 10 ? km.toFixed(1) : Math.round(km) })

// Pide la ubicación actual. Devuelve { lat, lng } o lanza un error con el mensaje para el usuario.
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error(t('Tu navegador no permite obtener la ubicación')))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error(t('No se pudo obtener tu ubicación. Revisa los permisos del navegador.'))),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    )
  })
}

// Memoria de la sesión (filtros); si el navegador la bloquea, se ignora
export const ss = (k) => { try { return sessionStorage.getItem(k) } catch { return null } }
export const ssSet = (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k) } catch {} }
