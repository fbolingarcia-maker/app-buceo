import { useEffect, useState, useCallback } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link } from '../lib/router'
import { TRIP_STATUS, levelName, manilaDate, addDays, dayLabel, time, php, manilaToIso } from '../lib/format'
import { seatsSummary, TRIP_SELECT } from '../lib/centro'
import { t, getLang, locale } from '../lib/i18n'

const WEEKDAYS = [['1', 'L'], ['2', 'M'], ['3', 'X'], ['4', 'J'], ['5', 'V'], ['6', 'S'], ['0', 'D']]
// Inicial en español; en inglés, nombre corto vía Intl (7 ene 2024 fue domingo)
const wdName = (k, n) => (getLang() === 'es' ? n : new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + +k))))
const dayOf = (iso) => manilaDate(new Date(iso))
const hhmm = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export default function CentroSalidas() {
  const { center, verified } = useAuth()
  const today = manilaDate()
  const [filter, setFilter] = useState('next')
  const [trips, setTrips] = useState(null)
  const [msg, setMsg] = useState(null)
  const [dup, setDup] = useState(null) // id de la salida que se está duplicando

  const load = useCallback(async () => {
    let q = supabase.from('trips').select(TRIP_SELECT).eq('center_id', center.id)
    if (filter === 'past') q = q.lt('departs_at', new Date().toISOString()).gte('departs_at', new Date(Date.now() - 30 * 864e5).toISOString()).order('departs_at', { ascending: false })
    else q = q.gte('departs_at', new Date().toISOString()).order('departs_at')
    if (filter === 'drafts') q = q.eq('status', 'draft')
    const { data, error } = await q.limit(200)
    if (error) setMsg({ ok: false, text: errMsg(error) })
    setTrips(data || [])
  }, [center.id, filter])
  useEffect(() => { setTrips(null); load() }, [load])

  async function run(promise, okText) {
    const { error } = await promise
    setMsg(error ? { ok: false, text: errMsg(error) } : { ok: true, text: okText })
    load()
  }

  async function duplicate(tr, dates) {
    const hm = hhmm(tr.departs_at)
    const rows = dates.map((d) => ({
      center_id: tr.center_id, boat_id: tr.boat_id, departs_at: manilaToIso(d, hm), num_dives: tr.num_dives, min_level: tr.min_level,
      price_php: tr.price_php, gear_rental_php: tr.gear_rental_php, guides: tr.guides, divers_per_guide: tr.divers_per_guide,
      seat_override: tr.seat_override, blocked_seats: tr.blocked_seats, status: verified ? 'published' : 'draft',
    }))
    const { data, error } = await supabase.from('trips').insert(rows).select('id')
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    const sites = (tr.trip_sites || [])
    if (sites.length) {
      const { data: full } = await supabase.from('trip_sites').select('site_id, position').eq('trip_id', tr.id)
      const ts = data.flatMap((n) => (full || []).map((x) => ({ trip_id: n.id, site_id: x.site_id, position: x.position })))
      if (ts.length) await supabase.from('trip_sites').insert(ts)
    }
    setDup(null)
    setMsg({ ok: true, text: data.length === 1 ? t('{n} salida creada', { n: 1 }) : t('{n} salidas creadas', { n: data.length }) })
    load()
  }

  // Agrupar por día
  const groups = {}
  for (const tr of trips || []) (groups[dayOf(tr.departs_at)] = groups[dayOf(tr.departs_at)] || []).push(tr)

  return (
    <>
      <div className="row between">
        <h1>{t('Salidas')}</h1>
        <Link to="/centro/nueva" className="btn small">{t('+ Nueva salida')}</Link>
      </div>
      <div className="seg">
        {[['next', t('Próximas')], ['drafts', t('Borradores')], ['past', t('Pasadas (30 días)')]].map(([k, n]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{n}</button>
        ))}
      </div>
      {msg && <div className={msg.ok ? 'msg ok' : 'msg err'}>{msg.text}</div>}
      {trips === null && <p className="muted">{t('Cargando…')}</p>}
      {trips?.length === 0 && <div className="card muted center">{t('No hay salidas aquí.')} <Link to="/centro/nueva">{t('Crear una')}</Link></div>}
      {Object.entries(groups).map(([d, ts]) => (
        <div key={d}>
          <h2>{d === today ? t('Hoy') : dayLabel(d, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
          {ts.map((tr) => {
            const s = seatsSummary(tr)
            const nBookings = (tr.bookings || []).length
            const statusCls = tr.status === 'published' ? 'pill ok' : tr.status === 'draft' ? 'pill warn' : tr.status === 'completed' ? 'pill' : 'pill bad'
            return (
              <div key={tr.id} className="card">
                <div className="row between">
                  <div>
                    <b>{time(tr.departs_at)} · {tr.boats?.name}</b>
                    <div className="small muted">{t('{n} inm.', { n: tr.num_dives })} · {t('mín. {level}', { level: levelName(tr.min_level) })} · {php(tr.price_php)} · {t('{booked}/{op} plazas', { booked: s.booked, op: s.operative })}</div>
                  </div>
                  <span className={statusCls}>{TRIP_STATUS[tr.status]}</span>
                </div>
                <div className="row wrap" style={{ marginTop: 10 }}>
                  <Link to={'/centro/salida/' + tr.id} className="btn small ghost">{t('Editar')}</Link>
                  <button className="btn small ghost" onClick={() => setDup(dup === tr.id ? null : tr.id)}>{t('Duplicar')}</button>
                  <Link to={`/centro/agenda?dia=${d}`} className="btn small ghost">{t('Manifiesto')}</Link>
                  {tr.status === 'draft' && verified && <button className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'published' }).eq('id', tr.id), t('Publicada'))}>{t('Publicar')}</button>}
                  {tr.status === 'published' && nBookings === 0 && new Date(tr.departs_at) > new Date() && (
                    <button className="btn small ghost" onClick={() => run(supabase.from('trips').update({ status: 'draft' }).eq('id', tr.id), t('Pasada a borrador'))}>{t('Despublicar')}</button>
                  )}
                  {tr.status === 'published' && new Date(tr.departs_at) < new Date() && (
                    <button className="btn small" onClick={() => run(supabase.from('trips').update({ status: 'completed' }).eq('id', tr.id), t('Marcada como completada'))}>{t('Completada')}</button>
                  )}
                  {nBookings === 0 && (
                    <button className="btn small danger" onClick={() => window.confirm(t('¿Eliminar esta salida?')) && run(supabase.from('trips').delete().eq('id', tr.id), t('Salida eliminada'))}>{t('Eliminar')}</button>
                  )}
                </div>
                {dup === tr.id && <DuplicateForm from={d} onSubmit={(dates) => duplicate(tr, dates)} />}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

// Repetir una salida: N días hacia delante, solo los días de la semana marcados
function DuplicateForm({ from, onSubmit }) {
  const [days, setDays] = useState(7)
  const [wd, setWd] = useState(['0', '1', '2', '3', '4', '5', '6'])
  const start = from > manilaDate() ? from : manilaDate()
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i + 1))
    .filter((d) => wd.includes(String(new Date(d + 'T12:00:00+08:00').getUTCDay())))
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <div className="row wrap small">
        {t('Repetir durante los próximos')}
        <input type="number" min="1" max="60" value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, +e.target.value || 1)))} style={{ width: 70 }} />
        {t('días, los:')}
      </div>
      <div className="seg" style={{ marginTop: 6 }}>
        {WEEKDAYS.map(([k, n]) => (
          <button key={k} className={wd.includes(k) ? 'on' : ''} onClick={() => setWd(wd.includes(k) ? wd.filter((x) => x !== k) : [...wd, k])}>{wdName(k, n)}</button>
        ))}
      </div>
      <button className="btn small" disabled={!dates.length} onClick={() => onSubmit(dates)}>{dates.length === 1 ? t('Crear {n} salida', { n: 1 }) : t('Crear {n} salidas', { n: dates.length })}</button>
    </div>
  )
}
