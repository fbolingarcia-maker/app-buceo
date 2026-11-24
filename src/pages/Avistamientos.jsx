// Mapa de avistamientos de toda Filipinas: qué se ha visto y dónde en los últimos días (público)
import { t } from '../lib/i18n'
import { Link } from '../lib/router'
import Icon from '../lib/Icon'
import { ArrowLeft } from 'lucide-react'
import { SightingsMap, Sightings } from '../lib/comunidad'

export default function Avistamientos() {
  return (
    <>
      <Link to="/puntos" className="linkish small row" style={{ gap: 4 }}><Icon icon={ArrowLeft} size={16} /> {t('Puntos de buceo')}</Link>
      <h1 style={{ marginTop: 8 }}>{t('Mapa de avistamientos')}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{t('Lo que buceadores y centros han visto en cada punto. Toca un número para ver qué y cuándo, y cuenta tú lo que veas.')}</p>
      <SightingsMap height={440} />
      <h2>{t('Últimos avistamientos')}</h2>
      <Sightings days={14} title={false} allowAdd={false} />
    </>
  )
}
