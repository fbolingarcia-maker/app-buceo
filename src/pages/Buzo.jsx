// Perfil público de un buceador (11 nov): rango, inmersiones compartidas y botón de seguir
import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { t } from '../lib/i18n'
import { levelName, dayLabel } from '../lib/format'
import { FollowButton, rankName } from '../lib/comunidad'
import { langName } from '../lib/langs'
import Icon from '../lib/Icon'
import { Trophy, Check } from 'lucide-react'

export default function Buzo({ id }) {
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { supabase.rpc('public_diver', { p_id: id }).then(({ data, error }) => (error ? setErr(errMsg(error)) : setP(data))) }, [id])
  if (err) return <div className="card">{err}</div>
  if (!p) return <p className="muted">{t('Cargando…')}</p>
  return (
    <>
      <div className="row between wrap" style={{ gap: 8 }}>
        <h1 style={{ margin: 0 }}>{p.name}</h1>
        {!p.me && <FollowButton type="diver" id={p.id} />}
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        {[p.level ? levelName(p.level) : null, p.country, p.languages?.length ? p.languages.map(langName).join(', ') : null].filter(Boolean).join(' · ')}
      </p>
      {p.bio && <p>“{p.bio}”</p>}
      <div className="card row" style={{ gap: 10 }}>
        <Icon icon={Trophy} size={22} />
        <span><b>{rankName(p.rank.key)}</b><br /><span className="small muted">{t('{n} inmersiones', { n: p.dives })} · {p.followers === 1 ? t('1 seguidor') : t('{n} seguidores', { n: p.followers })}</span></span>
      </div>
      <h2>{t('Inmersiones compartidas')}</h2>
      {p.logs.length === 0 && <div className="card muted">{t('Aún no ha compartido ninguna inmersión.')}</div>}
      {p.logs.map((l) => (
        <div key={l.id} className="card feed-item" style={{ marginBottom: 8 }}>
          <span className="row between"><b>{l.site || t('Inmersión')}</b><span className="small muted">{dayLabel(l.dive_date, { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>
          <span className="small muted">{[l.area, l.max_depth_m != null ? l.max_depth_m + ' m' : null, l.duration_min ? l.duration_min + ' min' : null, l.center_name].filter(Boolean).join(' · ')}{l.signed && <> · <Icon icon={Check} size={12} /> {t('firmada por el centro')}</>}</span>
          {l.marine_life && <span className="small">{l.marine_life}</span>}
        </div>
      ))}
    </>
  )
}
