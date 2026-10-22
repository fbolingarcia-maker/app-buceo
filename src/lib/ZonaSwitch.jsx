import { Link } from './router'
import { t } from './i18n'

// Cambia entre el directorio de centros y el de puntos de buceo (los dos por zonas)
export default function ZonaSwitch({ on }) {
  return (
    <nav className="seg" aria-label={t('Ver por zonas')}>
      <Link to="/centros" className={on === 'centros' ? 'on' : ''} aria-current={on === 'centros' ? 'page' : undefined}>{t('Centros')}</Link>
      <Link to="/puntos" className={on === 'puntos' ? 'on' : ''} aria-current={on === 'puntos' ? 'page' : undefined}>{t('Puntos de buceo')}</Link>
    </nav>
  )
}
