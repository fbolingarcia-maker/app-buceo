import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import { go } from './router'
import { t } from './i18n'
import Icon from './Icon'
import { Anchor, ShieldCheck, Waves } from 'lucide-react'

export const VIEWS = [['admin', ShieldCheck, 'Admin'], ['diver', Waves, 'Buceador'], ['center', Anchor, 'Centro']]
const HOME = { admin: '/admin', diver: '/', center: '/centro' }

// Centros que el administrador puede mirar (los dados de alta en la app, no las fichas del directorio)
let cache = null
export function useAdminCenters() {
  const [list, setList] = useState(cache)
  useEffect(() => {
    if (cache) return
    supabase.from('centers').select('id, name, destination, verification_status').neq('listing_status', 'directorio').order('name').limit(500)
      .then(({ data }) => { cache = data || []; setList(cache) })
  }, [])
  return list
}

// Barra «Ver como» bajo la cabecera, solo para administradores
export default function AdminBar() {
  const { adminView, setViewAs, viewCenterId, setViewCenterId, center, ownCenter } = useAuth()
  const centers = useAdminCenters()
  const pick = (v) => { setViewAs(v); go(HOME[v]) }
  return (
    <div className="adminbar" role="group" aria-label={t('Ver como')}>
      <span className="small">{t('Ver como')}</span>
      <div className="seg">
        {VIEWS.map(([k, icon, label]) => (
          <button key={k} type="button" aria-pressed={adminView === k} className={adminView === k ? 'on' : ''} onClick={() => pick(k)}>
            <Icon icon={icon} size={16} /> {t(label)}
          </button>
        ))}
      </div>
      {adminView === 'center' && (
        <select aria-label={t('Centro')} value={center?.id || viewCenterId || ''} onChange={(e) => { setViewCenterId(e.target.value); go('/centro') }}>
          <option value="">{t('Elige un centro…')}</option>
          {ownCenter && <option value={ownCenter.id}>{ownCenter.name} · {t('tu centro')}</option>}
          {(centers || []).filter((c) => c.id !== ownCenter?.id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.destination ? ' · ' + c.destination : ''}</option>)}
        </select>
      )}
    </div>
  )
}

// Pantalla de «Ver como centro» sin centro elegido
export function AdminCenterPicker() {
  const { setViewCenterId } = useAuth()
  const centers = useAdminCenters()
  const [q, setQ] = useState('')
  const list = (centers || []).filter((c) => !q || (c.name + ' ' + (c.destination || '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <h1><Icon icon={Anchor} size={26} /> {t('Ver como centro')}</h1>
      <p className="muted">{t('Elige un centro para ver su panel, agenda, salidas e informes tal como los ve el centro. Es solo lectura: no puedes cambiar nada en su nombre.')}</p>
      <input type="search" placeholder={t('Buscar centro')} aria-label={t('Buscar centro')} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {centers === null && <p className="muted">{t('Cargando…')}</p>}
      {centers && list.length === 0 && <div className="card muted center">{t('Ningún centro coincide.')}</div>}
      {list.map((c) => (
        <button key={c.id} type="button" className="card row between pick" onClick={() => setViewCenterId(c.id)}>
          <span><b>{c.name}</b> <span className="small muted">{c.destination ? '· ' + c.destination : ''}</span></span>
          <span className={c.verification_status === 'verified' ? 'pill ok' : c.verification_status === 'pending' ? 'pill warn' : 'pill'}>{t(STATUS[c.verification_status] || 'Sin verificar')}</span>
        </button>
      ))}
    </>
  )
}

const STATUS = { verified: 'Verificado', pending: 'En revisión', rejected: 'Rechazado', suspended: 'Suspendido', unverified: 'Sin verificar' }
