import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { LEVELS, manilaDate, addDays, manilaToIso, php } from '../lib/format'

export default function NuevaSalida() {
  const { center } = useAuth()
  const [boats, setBoats] = useState([])
  const [sites, setSites] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    boat_id: '', date: addDays(manilaDate(), 1), hour: '07:30', num_dives: 3, min_level: 'open_water',
    price_php: 5500, gear_rental_php: 800, guides: 2, divers_per_guide: center?.default_divers_per_guide || 4,
    seat_override: '', blocked_seats: 0, sites: ['', '', ''], publish: true,
  })

  useEffect(() => {
    if (!center) return
    supabase.from('boats').select('*').eq('center_id', center.id).eq('active', true).order('name')
      .then(({ data }) => { setBoats(data || []); if (data?.[0]) setF((x) => ({ ...x, boat_id: x.boat_id || data[0].id })) })
    supabase.from('dive_sites').select('*').order('area').order('name').then(({ data }) => setSites(data || []))
  }, [center])

  if (!center) return <div className="card">Primero registra tu centro en el <Link to="/perfil">perfil</Link>.</div>

  const set = (k, num) => (e) => setF({ ...f, [k]: num ? (e.target.value === '' ? '' : +e.target.value) : e.target.value })
  const boat = boats.find((b) => b.id === f.boat_id)
  const operative = boat ? Math.min(boat.capacity, f.guides * f.divers_per_guide, f.seat_override === '' ? 999 : f.seat_override) : 0

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const departs_at = manilaToIso(f.date, f.hour)
    if (new Date(departs_at) < new Date()) { setBusy(false); return setError('La fecha ya ha pasado') }
    const { data: trip, error } = await supabase.from('trips').insert({
      center_id: center.id, boat_id: f.boat_id, departs_at, num_dives: f.num_dives, min_level: f.min_level,
      price_php: f.price_php, gear_rental_php: f.gear_rental_php || 0, guides: f.guides, divers_per_guide: f.divers_per_guide,
      seat_override: f.seat_override === '' ? null : f.seat_override, blocked_seats: f.blocked_seats || 0,
      status: f.publish ? 'published' : 'draft',
    }).select().single()
    if (error) { setBusy(false); return setError(errMsg(error)) }
    const ts = f.sites.slice(0, f.num_dives).map((site_id, i) => ({ trip_id: trip.id, site_id, position: i + 1 })).filter((x) => x.site_id)
    if (ts.length) {
      const { error: e2 } = await supabase.from('trip_sites').insert(ts)
      if (e2) { setBusy(false); return setError('Salida creada, pero falló guardar los puntos: ' + errMsg(e2)) }
    }
    setBusy(false)
    go('/centro')
  }

  return (
    <>
      <Link to="/centro" className="small">← Panel del centro</Link>
      <h1 style={{ marginTop: 8 }}>Nueva salida</h1>
      {boats.length === 0 ? (
        <div className="card">Antes necesitas un barco. Ve a <Link to="/centro">Panel → Barcos y plazas</Link>.</div>
      ) : (
        <form className="card" onSubmit={save}>
          <div className="grid2">
            <div className="field"><label>Día</label><input type="date" required value={f.date} min={manilaDate()} onChange={set('date')} /></div>
            <div className="field"><label>Hora (Manila)</label><input type="time" required value={f.hour} onChange={set('hour')} /></div>
            <div className="field"><label>Barco</label><select value={f.boat_id} onChange={set('boat_id')}>{boats.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.capacity})</option>)}</select></div>
            <div className="field"><label>Inmersiones</label><select value={f.num_dives} onChange={(e) => {
              const n = +e.target.value; setF({ ...f, num_dives: n, sites: Array.from({ length: n }, (_, i) => f.sites[i] || '') })
            }}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></div>
            <div className="field"><label>Nivel mínimo</label><select value={f.min_level} onChange={set('min_level')}>{LEVELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
            <div className="field"><label>Precio (₱/buceador)</label><input type="number" min="1" required value={f.price_php} onChange={set('price_php', true)} /></div>
            <div className="field"><label>Alquiler equipo (₱)</label><input type="number" min="0" value={f.gear_rental_php} onChange={set('gear_rental_php', true)} /></div>
            <div className="field"><label>Guías</label><input type="number" min="1" max="15" required value={f.guides} onChange={set('guides', true)} /></div>
            <div className="field"><label>Buceadores por guía</label><input type="number" min="1" max="10" required value={f.divers_per_guide} onChange={set('divers_per_guide', true)} /></div>
            <div className="field"><label>Límite manual de plazas</label><input type="number" min="0" placeholder="(opcional)" value={f.seat_override} onChange={set('seat_override', true)} /></div>
            <div className="field"><label>Plazas reservadas fuera de la app</label><input type="number" min="0" value={f.blocked_seats} onChange={set('blocked_seats', true)} /></div>
          </div>

          <b>Puntos de buceo</b>
          {f.sites.map((v, i) => (
            <div className="field" key={i} style={{ marginTop: 6 }}>
              <select value={v} onChange={(e) => { const s = [...f.sites]; s[i] = e.target.value; setF({ ...f, sites: s }) }}>
                <option value="">Inmersión {i + 1}: por decidir</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.area} · {s.name.replace(s.area + ' – ', '')}</option>)}
              </select>
            </div>
          ))}

          <p className="small muted">Plazas operativas: <b>{operative}</b> · en la app: <b>{Math.max(0, operative - (f.blocked_seats || 0))}</b> · precio {php(f.price_php)}</p>
          <label className="check field"><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> Publicar ya (si no, queda como borrador)</label>
          {error && <div className="msg err">{error}</div>}
          <button className="btn block" disabled={busy}>{busy ? 'Guardando…' : 'Crear salida'}</button>
        </form>
      )}
    </>
  )
}
