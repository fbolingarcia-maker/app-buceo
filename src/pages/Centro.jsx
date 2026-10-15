import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { SOURCES, sourceName, levelName, TRIP_STATUS, BOOKING_STATUS, manilaDate, addDays, dayRange, dateTime, dayLabel, time, php } from '../lib/format'

const HOLD_MS = 15 * 60000
const holds = (b) => b.status === 'confirmed' || (b.status === 'pending_payment' && Date.now() - new Date(b.created_at) < HOLD_MS)

export function seatsSummary(t) {
  const operative = Math.max(0, Math.min(t.boats?.capacity ?? 99, t.guides * t.divers_per_guide, t.seat_override ?? 32767))
  const live = (t.bookings || []).filter(holds)
  const manual = live.filter((b) => b.source !== 'app').reduce((s, b) => s + b.seats, 0)
  const app = live.filter((b) => b.source === 'app').reduce((s, b) => s + b.seats, 0)
  const appFree = t.status === 'published' ? Math.max(0, operative - Math.max(t.blocked_seats, manual) - app) : 0
  return { operative, manual, app, appFree, boatFree: Math.max(0, operative - manual - app) }
}

export default function Centro() {
  const { center, refresh } = useAuth()
  const [tab, setTab] = useState('agenda')
  if (!center) return (
    <div className="card">No gestionas ningún centro todavía. <Link to="/perfil">Regístralo desde tu perfil</Link>.</div>
  )
  return (
    <>
      <div className="row between">
        <h1>{center.name}</h1>
        <Link to="/centro/nueva" className="btn small">+ Salida</Link>
      </div>
      <div className="seg">
        {[['agenda', 'Agenda'], ['barcos', 'Barcos y plazas'], ['datos', 'Datos del centro']].map(([k, n]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>
        ))}
      </div>
      {tab === 'agenda' && <Agenda center={center} />}
      {tab === 'barcos' && <Barcos center={center} />}
      {tab === 'datos' && <Datos center={center} refresh={refresh} />}
    </>
  )
}

function Agenda({ center }) {
  const today = manilaDate()
  const [day, setDay] = useState(today)
  const [trips, setTrips] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const [from, to] = dayRange(day)
    const { data, error } = await supabase.from('trips')
      .select('*, boats(name, capacity), trip_sites(position, dive_sites(name)), bookings(*, divers(full_name, logged_dives, certifications(id, agency, level, verified_at)))')
      .eq('center_id', center.id).gte('departs_at', from).lt('departs_at', to).order('departs_at')
    if (error) setMsg({ ok: false, text: errMsg(error) })
    setTrips(data || [])
  }, [center.id, day])
  useEffect(() => { setTrips(null); load() }, [load])

  async function run(promise, okText) {
    const { error } = await promise
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: okText })
    load()
  }

  return (
    <>
      <div className="days">
        {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d, i) => (
          <button key={d} className={d === day ? 'day on' : 'day'} onClick={() => setDay(d)}>
            <small>{i === 0 ? 'Hoy' : dayLabel(d, { weekday: 'short' })}</small><b>{dayLabel(d, { day: 'numeric' })}</b>
          </button>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      {trips === null && <p className="muted">Cargando…</p>}
      {trips?.length === 0 && <div className="card muted center">No hay salidas este día. <Link to="/centro/nueva">Crear una</Link></div>}
      {trips?.map((t) => <TripCard key={t.id} t={t} center={center} run={run} />)}
    </>
  )
}

function TripCard({ t, center, run }) {
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState({ guest: '', seats: 1, gear: false, source: 'whatsapp' })
  const s = seatsSummary(t)
  const sites = (t.trip_sites || []).sort((a, b) => a.position - b.position).map((x) => x.dive_sites?.name)
  const active = (t.bookings || []).filter((b) => b.status === 'confirmed' || b.status === 'pending_payment')
  const statusCls = t.status === 'published' ? 'pill ok' : t.status === 'draft' ? 'pill warn' : 'pill bad'

  return (
    <div className="card">
      <div className="row between" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <div>
          <div className="big">{time(t.departs_at)} · {t.boats?.name}</div>
          <div className="small muted">{t.num_dives} inm. · mín. {levelName(t.min_level)} · {php(t.price_php)} · {sites.join(', ') || 'sin puntos'}</div>
        </div>
        <span className={statusCls}>{TRIP_STATUS[t.status]}</span>
      </div>
      <div className="row wrap small" style={{ marginTop: 8, gap: 14 }}>
        <span>Operativas <b>{s.operative}</b></span>
        <span>App <b>{s.app}</b></span>
        <span>Manual <b>{s.manual}</b></span>
        <span>Bloqueadas <b>{t.blocked_seats}</b></span>
        <span>Libres en app <b>{s.appFree}</b></span>
      </div>

      {open && (
        <>
          <hr />
          <b>Reservas</b>
          {active.length === 0 && <p className="muted small">Sin reservas.</p>}
          <table><tbody>
            {active.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.divers?.full_name || b.guest_name}
                  <div className="small muted">{sourceName(b.source)} · {BOOKING_STATUS[b.status]}{b.with_gear ? ' · equipo' : ''}</div>
                  {b.divers?.certifications?.map((c) => (
                    <div key={c.id} className="small">
                      {c.agency} {levelName(c.level)} {c.verified_at ? '✅' : (
                        <button className="btn small ghost" style={{ padding: '2px 8px' }}
                          onClick={() => run(supabase.rpc('verify_certification', { p_cert: c.id, p_center: center.id }), 'Certificación verificada')}>Verificar</button>
                      )}
                    </div>
                  ))}
                </td>
                <td>{b.seats}</td>
                <td>{php(b.amount_php)}</td>
              </tr>
            ))}
          </tbody></table>

          {t.status === 'published' && (
            <form style={{ marginTop: 12 }} onSubmit={(e) => {
              e.preventDefault()
              run(supabase.rpc('add_manual_booking', { p_trip: t.id, p_guest: manual.guest, p_seats: manual.seats, p_with_gear: manual.gear, p_source: manual.source }), 'Reserva manual añadida')
              setManual({ ...manual, guest: '', seats: 1 })
            }}>
              <b>Añadir reserva manual</b>
              <div className="grid2" style={{ marginTop: 6 }}>
                <input placeholder="Nombre del cliente" required value={manual.guest} onChange={(e) => setManual({ ...manual, guest: e.target.value })} />
                <select value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })}>{SOURCES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                <input type="number" min="1" max={Math.max(1, s.boatFree)} value={manual.seats} onChange={(e) => setManual({ ...manual, seats: +e.target.value })} />
                <label className="check"><input type="checkbox" checked={manual.gear} onChange={(e) => setManual({ ...manual, gear: e.target.checked })} /> Con equipo</label>
              </div>
              <button className="btn small" style={{ marginTop: 8 }}>Añadir</button>
            </form>
          )}

          <hr />
          <div className="row wrap">
            {t.status === 'draft' && (
              <button className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'published' }).eq('id', t.id), 'Salida publicada')}>Publicar</button>
            )}
            {t.status === 'published' && (
              <>
                <label className="small row">Bloquear plazas para WhatsApp/mostrador:
                  <input type="number" min="0" style={{ width: 70 }} defaultValue={t.blocked_seats}
                    onBlur={(e) => +e.target.value !== t.blocked_seats && run(supabase.from('trips').update({ blocked_seats: +e.target.value }).eq('id', t.id), 'Plazas bloqueadas actualizadas')} />
                </label>
                <button className="btn small danger" onClick={() => {
                  if (window.confirm('¿Cancelar por meteo? Se cancelan todas las reservas y se reembolsa el 100 % de lo pagado.'))
                    run(supabase.rpc('cancel_trip_weather', { p_trip: t.id }), 'Salida cancelada por meteo. Reembolsos generados.')
                }}>Cancelar por meteo</button>
              </>
            )}
          </div>
          <p className="small muted">Salida: {dateTime(t.departs_at)} · {t.guides} guía(s) × {t.divers_per_guide} buceadores</p>
        </>
      )}
    </div>
  )
}

function Barcos({ center }) {
  const [boats, setBoats] = useState([])
  const [nb, setNb] = useState({ name: '', capacity: 10 })
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => supabase.from('boats').select('*').eq('center_id', center.id).order('name').then(({ data }) => setBoats(data || [])), [center.id])
  useEffect(() => { load() }, [load])

  async function run(p, ok) { const { error } = await p; setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: ok }); load() }

  return (
    <div className="card">
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      {boats.length === 0 && <p className="muted">Añade tu primer barco para poder crear salidas.</p>}
      {boats.map((b) => (
        <div key={b.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <div><b>{b.name}</b> <span className="muted small">· {b.capacity} plazas</span> {!b.active && <span className="pill bad">Inactivo</span>}</div>
          <div className="row">
            <input type="number" min="1" max="60" defaultValue={b.capacity} style={{ width: 70 }}
              onBlur={(e) => +e.target.value !== b.capacity && run(supabase.from('boats').update({ capacity: +e.target.value }).eq('id', b.id), 'Capacidad actualizada')} />
            <button className="btn small ghost" onClick={() => run(supabase.from('boats').update({ active: !b.active }).eq('id', b.id), 'Barco actualizado')}>{b.active ? 'Desactivar' : 'Activar'}</button>
          </div>
        </div>
      ))}
      <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => {
        e.preventDefault()
        run(supabase.from('boats').insert({ center_id: center.id, name: nb.name.trim(), capacity: +nb.capacity }), 'Barco añadido')
        setNb({ name: '', capacity: 10 })
      }}>
        <input className="grow" placeholder="Nombre del barco" required value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
        <input type="number" min="1" max="60" style={{ width: 80 }} value={nb.capacity} onChange={(e) => setNb({ ...nb, capacity: e.target.value })} />
        <button className="btn small">Añadir</button>
      </form>
    </div>
  )
}

function Datos({ center, refresh }) {
  const [f, setF] = useState({
    name: center.name || '', phone: center.phone || '', gcash_number: center.gcash_number || '',
    default_divers_per_guide: center.default_divers_per_guide || 4, locality: center.locality || '', website: center.website || '',
  })
  const [msg, setMsg] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('centers').update({ ...f, default_divers_per_guide: +f.default_divers_per_guide }).eq('id', center.id)
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: 'Datos guardados' })
    if (!error) refresh()
  }
  return (
    <form className="card" onSubmit={save}>
      <div className="field"><label>Nombre</label><input required value={f.name} onChange={set('name')} /></div>
      <div className="grid2">
        <div className="field"><label>Teléfono / WhatsApp</label><input value={f.phone} onChange={set('phone')} /></div>
        <div className="field"><label>Nº GCash</label><input value={f.gcash_number} onChange={set('gcash_number')} /></div>
        <div className="field"><label>Zona (Alona, Danao…)</label><input value={f.locality} onChange={set('locality')} /></div>
        <div className="field"><label>Buceadores por guía</label><input type="number" min="1" max="10" value={f.default_divers_per_guide} onChange={set('default_divers_per_guide')} /></div>
      </div>
      <div className="field"><label>Web</label><input type="url" placeholder="https://" value={f.website} onChange={set('website')} /></div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      <button className="btn">Guardar</button>
    </form>
  )
}
