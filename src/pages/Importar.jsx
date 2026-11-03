import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { dayLabel } from '../lib/format'
import { t } from '../lib/i18n'
import Icon from '../lib/Icon'
import { ArrowLeft, Upload } from 'lucide-react'
import { parseDiveFile } from '../lib/diveImport'

// Importar inmersiones del ordenador de buceo (Garmin, Shearwater, Suunto…) a la bitácora.
// El fichero se lee en el navegador: solo se guardan los datos de cada inmersión.
export default function Importar() {
  const { diver } = useAuth()
  const [existing, setExisting] = useState(null)
  const [dives, setDives] = useState([])
  const [pick, setPick] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (diver) supabase.from('dive_logs').select('dive_date, entry_time').eq('diver_id', diver.id)
      .then(({ data }) => setExisting(new Set((data || []).map((l) => l.dive_date + ' ' + (l.entry_time || '').slice(0, 5)))))
  }, [diver])

  const key = (d) => d.dive_date + ' ' + (d.entry_time || '')
  async function onFiles(files) {
    setMsg(null)
    const all = []
    const bad = []
    for (const f of files) {
      try { all.push(...(await parseDiveFile(f.name, new Uint8Array(await f.arrayBuffer())))) } catch (e) { bad.push(f.name) }
    }
    const seen = new Set()
    const list = all.filter((d) => !seen.has(key(d)) && seen.add(key(d))).sort((a, b) => key(b).localeCompare(key(a)))
    setDives(list)
    setPick(Object.fromEntries(list.map((d, i) => [i, !existing?.has(key(d))])))
    if (bad.length) setMsg({ ok: false, text: t('No pudimos leer: {f}. Prueba a exportarlo en UDDF, FIT o CSV.', { f: bad.join(', ') }) })
    else if (!list.length) setMsg({ ok: false, text: t('No hemos encontrado inmersiones en el fichero.') })
  }

  async function save() {
    const rows = dives.filter((_, i) => pick[i]).map((d) => ({ ...d, diver_id: diver.id, notes: t('Importada del ordenador de buceo') }))
    if (!rows.length) return
    setBusy(true)
    let done = 0
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from('dive_logs').insert(rows.slice(i, i + 50))
      if (error) { setBusy(false); return setMsg({ ok: false, text: errMsg(error) + (done ? ' · ' + t('{n} importadas', { n: done }) : '') }) }
      done += rows.slice(i, i + 50).length
    }
    setBusy(false)
    try { sessionStorage.setItem('flash', t('{n} inmersiones importadas a tu bitácora', { n: done })) } catch (e) { /* sin almacenamiento */ }
    go('/bitacora')
  }

  const n = Object.values(pick).filter(Boolean).length
  return (
    <>
      <Link to="/bitacora" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Bitácora')}</Link>
      <h1 style={{ marginTop: 8 }}>{t('Importar del ordenador de buceo')}</h1>
      <div className="card">
        <label className="btn block" style={{ cursor: 'pointer' }}>
          <Icon icon={Upload} /> {t('Elegir ficheros')}
          <input type="file" multiple accept=".fit,.zip,.uddf,.xml,.ssrf,.csv,.txt" style={{ display: 'none' }} onChange={(e) => onFiles([...e.target.files])} />
        </label>
        <p className="small muted" style={{ marginBottom: 0 }}>{t('El fichero se lee en tu móvil u ordenador; solo guardamos fecha, hora, profundidad, tiempo, temperatura y gas de cada inmersión.')}</p>
      </div>
      <details className="card small how-pay">
        <summary>{t('¿Cómo saco el fichero?')}</summary>
        <ul>
          <li><b>Garmin Descent</b>: {t('Garmin Connect (web) → la inmersión → ⚙ → «Exportar original» (.zip con el .fit). También vale el .fit de la carpeta GARMIN/Activity del reloj.')}</li>
          <li><b>Shearwater</b>: {t('Shearwater Cloud → selecciona las inmersiones → Exportar → UDDF.')}</li>
          <li><b>Suunto</b>: {t('app de Suunto → la inmersión → ⋯ → Exportar (.fit). Desde Suunto DM5 o Subsurface, exporta en UDDF.')}</li>
          <li><b>Subsurface</b> {t('(casi cualquier ordenador)')}: {t('Archivo → Exportar → UDDF, XML de Subsurface o CSV.')}</li>
        </ul>
      </details>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {dives.length > 0 && (
        <>
          <div className="row between" style={{ margin: '12px 0 6px' }}>
            <b>{dives.length === 1 ? t('1 inmersión encontrada') : t('{n} inmersiones encontradas', { n: dives.length })}</b>
            <button type="button" className="linkish small" onClick={() => setPick(Object.fromEntries(dives.map((_, i) => [i, !n])))}>{n ? t('Ninguna') : t('Todas')}</button>
          </div>
          <div className="list">
            {dives.map((d, i) => {
              const dup = existing?.has(key(d))
              return (
                <label key={i} className="li check" style={{ alignItems: 'center' }}>
                  <input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick({ ...pick, [i]: e.target.checked })} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <b>{dayLabel(d.dive_date)}{d.entry_time ? ' · ' + d.entry_time : ''}</b>
                    <small>{[d.site_name, d.max_depth_m != null && d.max_depth_m + ' m', d.duration_min && d.duration_min + ' min', d.water_temp_c != null && d.water_temp_c + ' °C', d.gas === 'nitrox' && 'EAN' + d.o2_pct].filter(Boolean).join(' · ')}</small>
                    {dup && <small className="muted">{t('Ya está en tu bitácora')}</small>}
                  </span>
                </label>
              )
            })}
          </div>
          <button className="btn block" style={{ marginTop: 12 }} disabled={busy || !n} onClick={save}>
            {busy ? t('Importando…') : n === 1 ? t('Importar 1 inmersión') : t('Importar {n} inmersiones', { n })}
          </button>
        </>
      )}
    </>
  )
}
