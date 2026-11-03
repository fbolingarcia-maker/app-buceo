import { t } from './i18n'
import { setFav, useFavs } from './favs'
import Icon from './Icon'
import { Heart } from 'lucide-react'

// Botón para guardar un centro en favoritos. compact: solo el icono (tarjetas de Salidas)
export default function FavButton({ id, name, compact }) {
  const favs = useFavs()
  const on = favs.includes(id)
  const label = on ? t('Quitar {centro} de mis centros', { centro: name }) : t('Guardar {centro} en mis centros', { centro: name })
  return (
    <button type="button" className={'fav-btn' + (on ? ' on' : '') + (compact ? '' : ' btn small ghost')} aria-pressed={on} aria-label={label} title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFav(id, !on) }}>
      <Icon icon={Heart} size={compact ? 20 : 16} fill={on ? 'currentColor' : 'none'} />
      {!compact && (on ? t('En mis centros') : t('Guardar centro'))}
    </button>
  )
}
