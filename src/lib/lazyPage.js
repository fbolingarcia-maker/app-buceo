import { lazy } from 'react'

// Pantallas que se cargan al abrirlas (o en segundo plano, con prefetch), para que la primera carga sea más ligera.
// Si el fichero ya no existe porque se ha publicado una versión nueva mientras la app estaba abierta, recarga una vez.
const FLAG = 'chunkReload'
export function lazyPage(load) {
  const get = () => load()
    .then((m) => { try { sessionStorage.removeItem(FLAG) } catch (e) { /* sin almacenamiento */ } return m })
    .catch((err) => {
      let first = false
      try { first = !sessionStorage.getItem(FLAG); if (first) sessionStorage.setItem(FLAG, '1') } catch (e) { /* sin almacenamiento */ }
      if (first) { window.location.reload(); return new Promise(() => {}) }
      throw err
    })
  const C = lazy(get)
  C.prefetch = () => { load().catch(() => {}) }
  return C
}

// Descarga en segundo plano, cuando el navegador está libre, las pantallas que probablemente se abrirán después
export function prefetchWhenIdle(pages) {
  const run = () => pages.forEach((p) => p.prefetch?.())
  if (typeof window === 'undefined') return () => {}
  if ('requestIdleCallback' in window) { const id = window.requestIdleCallback(run, { timeout: 4000 }); return () => window.cancelIdleCallback(id) }
  const id = setTimeout(run, 2500)
  return () => clearTimeout(id)
}
