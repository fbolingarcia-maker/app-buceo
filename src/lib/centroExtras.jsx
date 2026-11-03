// Ajustes del centro: enlace de reservas propio (0 % de comisión), extras que vende y Green Fins
import { useCallback, useEffect, useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t } from './i18n'
import { php } from './format'
import Icon from './Icon'
import { Check, Copy } from 'lucide-react'
import { bookingLink, EXTRA_KINDS, extraKind, GREEN_FINS, ECO } from './extras'

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="btn small ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) })}>
      <Icon icon={done ? Check : Copy} size={14} /> {done ? t('Copiado') : label}
    </button>
  )
}

// Enlace propio: las reservas que llegan por él no pagan comisión
export function CanalPropio({ center }) {
  const link = bookingLink(center.id)
  const html = `<a href="${link}" target="_blank" rel="noopener" style="display:inline-block;background:#0b5e8a;color:#fff;padding:12px 20px;border-radius:10px;font:600 16px sans-serif;text-decoration:none">${t('Reserva tu inmersión')}</a>`
  return (
    <div className="card stack">
      <p style={{ margin: 0 }}>{t('Las reservas que entran por tu enlace no pagan comisión. Solo pagas ₱250 por buceador cuando el cliente te llega a través de DivingSlot.')}</p>
      <div className="code-box" aria-label={t('Tu enlace de reservas')}>{link}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        <CopyBtn text={link} label={t('Copiar enlace')} />
        <CopyBtn text={html} label={t('Copiar botón para tu web')} />
        <a className="btn small ghost" href={link} target="_blank" rel="noreferrer">{t('Probar')}</a>
      </div>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li><b>{t('Web')}</b>: {t('pega el botón en tu página (WordPress, Wix, Squarespace: bloque «HTML personalizado»).')}</li>
        <li><b>Instagram / Facebook</b>: {t('pon el enlace en la bio y en el botón «Reservar» del perfil; úsalo también en las historias con la pegatina de enlace.')}</li>
        <li><b>Google</b>: {t('en tu Perfil de Empresa de Google → Editar perfil → Reservas, añade el enlace como «enlace de reserva».')}</li>
        <li><b>WhatsApp</b>: {t('mándalo como respuesta rápida a quien te pregunte por plazas.')}</li>
      </ul>
      <p className="small muted" style={{ margin: 0 }}>{t('Cuenta como tuyo si el buceador reserva en tu centro en los 7 días siguientes a abrir el enlace.')}</p>
    </div>
  )
}

// Extras que se ofrecen al reservar: seguro, cursos, fotos o vídeo de la salida…
export function Extras({ center, readOnly }) {
  const [list, setList] = useState(null)
  const [nx, setNx] = useState({ kind: 'insurance', name: '', price_php: '', per_seat: true, description: '' })
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => supabase.from('center_extras').select('*').eq('center_id', center.id).order('created_at').then(({ data }) => setList(data || [])), [center.id])
  useEffect(() => { load() }, [load])
  async function run(p, ok) { const { error } = await p; setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: ok }); load(); return error }
  const PRESET = { insurance: t('Seguro de buceo (1 día)'), course: t('Curso Advanced Open Water'), photo: t('Fotos de la salida'), video: t('Vídeo de la salida'), nitrox: t('Nitrox (por inmersión)'), other: '' }
  return (
    <div className="card">
      {list === null ? <p className="muted">{t('Cargando…')}</p> : list.length === 0 && <p className="small muted" style={{ marginTop: 0 }}>{t('Aún no ofreces extras. Los buceadores los ven al reservar y se suman al pago.')}</p>}
      {list?.map((e) => (
        <div key={e.id} className="doc-row row between" style={{ gap: 8 }}>
          <span className={e.active ? '' : 'muted'}><b>{e.name}</b> · {php(e.price_php)}{e.per_seat ? ' ' + t('por persona') : ' ' + t('por reserva')} <span className="small muted">({extraKind(e.kind)})</span></span>
          {!readOnly && <span className="row" style={{ gap: 4 }}>
            <button type="button" className="btn small ghost" onClick={() => run(supabase.from('center_extras').update({ active: !e.active }).eq('id', e.id), t('Extra actualizado'))}>{e.active ? t('Ocultar') : t('Mostrar')}</button>
          </span>}
        </div>
      ))}
      {!readOnly && (
        <form style={{ marginTop: 10 }} onSubmit={async (ev) => {
          ev.preventDefault()
          const err = await run(supabase.from('center_extras').insert({ center_id: center.id, kind: nx.kind, name: nx.name.trim(), price_php: +nx.price_php, per_seat: nx.per_seat, description: nx.description.trim() || null }), t('Extra añadido'))
          if (!err) setNx({ ...nx, name: '', price_php: '', description: '' })
        }}>
          <b className="small">{t('Añadir extra')}</b>
          <div className="grid2" style={{ marginTop: 6 }}>
            <select aria-label={t('Tipo')} value={nx.kind} onChange={(e) => setNx({ ...nx, kind: e.target.value, name: nx.name || PRESET[e.target.value] })}>{EXTRA_KINDS.map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}</select>
            <input aria-label={t('Nombre')} placeholder={t('Nombre')} required maxLength={80} value={nx.name} onChange={(e) => setNx({ ...nx, name: e.target.value })} />
            <input aria-label={t('Precio (₱)')} placeholder={t('Precio (₱)')} type="number" inputMode="numeric" min="0" required value={nx.price_php} onChange={(e) => setNx({ ...nx, price_php: e.target.value })} />
            <label className="check small"><input type="checkbox" checked={nx.per_seat} onChange={(e) => setNx({ ...nx, per_seat: e.target.checked })} /> {t('Precio por persona')}</label>
          </div>
          <input aria-label={t('Descripción (opcional)')} placeholder={t('Descripción (opcional)')} maxLength={200} value={nx.description} onChange={(e) => setNx({ ...nx, description: e.target.value })} style={{ marginTop: 6 }} />
          <button className="btn small" style={{ marginTop: 8 }}>{t('Añadir')}</button>
          {nx.kind === 'insurance' && <p className="small muted" style={{ margin: '6px 0 0' }}>{t('Ofrece solo seguros que vendas tú o tu aseguradora: DivingSlot cobra el importe y te lo paga con la reserva.')}</p>}
        </form>
      )}
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <p className="small muted" style={{ margin: '8px 0 0' }}>{t('El alquiler de equipo se pone en cada salida: el buceador ve el precio con su equipo y alquilando.')}</p>
    </div>
  )
}

// Sello Green Fins (declarado; la plataforma lo marca como comprobado) y prácticas ecológicas
export function GreenFins({ center, refresh, readOnly }) {
  const [gf, setGf] = useState(center.green_fins || '')
  const [eco, setEco] = useState(center.eco || {})
  const [msg, setMsg] = useState(null)
  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('centers').update({ green_fins: gf || null, eco }).eq('id', center.id)
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: t('Datos guardados') })
    if (!error) refresh()
  }
  return (
    <form className="card" onSubmit={save}>
      <div className="field">
        <label htmlFor="gf">{t('Green Fins')}</label>
        <select id="gf" value={gf} onChange={(e) => setGf(e.target.value)} disabled={readOnly}>
          <option value="">{t('No participamos')}</option>
          {GREEN_FINS.map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}
        </select>
        {gf && <p className="small muted" style={{ margin: '6px 0 0' }}>{center.green_fins_verified ? t('Comprobado por DivingSlot.') : t('Lo revisamos con la lista pública de Green Fins; mientras, se muestra como declarado por el centro.')}</p>}
      </div>
      <b className="small">{t('Prácticas ecológicas')}</b>
      <div className="stack" style={{ marginTop: 6 }}>
        {ECO.map(([k, n]) => (
          <label key={k} className="check small"><input type="checkbox" disabled={readOnly} checked={!!eco[k]} onChange={(e) => setEco({ ...eco, [k]: e.target.checked })} /> {t(n)}</label>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {!readOnly && <button className="btn" style={{ marginTop: 10 }}>{t('Guardar')}</button>}
    </form>
  )
}
