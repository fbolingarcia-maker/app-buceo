import { useEffect, useState } from 'react'

// Router mínimo por hash (#/ruta) — funciona en GitHub Pages sin configuración.
export function useRoute() {
  const get = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0]
  const [path, setPath] = useState(get)
  useEffect(() => {
    const on = () => { setPath(get()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return path
}

export const go = (to) => { window.location.hash = to }

export function Link({ to, children, ...rest }) {
  return <a href={'#' + to} {...rest}>{children}</a>
}
