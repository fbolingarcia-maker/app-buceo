import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { LEVELS, manilaDate, addDays, manilaToIso, php } from '../lib/format'
import { t } from '../lib/i18n'

export default function NuevaSalida({ id }) {
  const { center, verified } = useAuth()
  const [boats, setBoats] = useState(null)
  const [sites, setSites] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    boat_id: '', date: addDays(manilaDate(), 1), hour: '07:30', num_dives: 3, min_level: 'open_water',
    price_php: 5500, gear_rental_php: 800, guides: 2, divers_per_guide: center?.default_divers_per_guide || 4,
    seat_override: '', blocked_seats: 0, sites: ['', '', ''], publish: true, include_fees: false, fees_per_diver: '',
    early_pct: 0, early_days: 14, kind: 'fun', activity: 'scuba', course_name: '', course_days: '', course_prereq: '', repeat: 0,
  })

  useEffect(() => {
    if (!center) return
    supabase.from('boats').select('*').eq('center_id', center.id).eq('active', true).order('name')
      .then(({ data, error }) => { if (error) setError(errMsg(error)); setBoats(data || []); if (data?.[0]) setF((x) => ({ ...x, boat_id: x.boat_id || data[0].id })) })
    supabase.from('dive_sites').select('*').order('area').order('name').then(({ data }) => setSites(data || []))
  }, [center])

  // Modo edición: cargar la salida
  const [loaded, setLoaded] = useState(!id)
  const [hasBookings, setHasBookings] = useState(false)
  useEffect(() => {
    if (!id) return
    supabase.from('trips').select('*, trip_sites(site_id, position), bookings(id, status)').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error || !data) { setError(error ? errMsg(error) : t('Salida no encontrada')); return }
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }).format(new Date(data.departs_at))
      const ts = (data.trip_sites || []).sort((a, b) => a.position - b.position)
      setF({
        boat_id: data.boat_id, date: manilaDate(new Date(data.departs_at)), hour: hm, num_dives: data.num_dives, min_level: data.min_level,
        price_php: data.price_php, gear_rental_php: data.gear_rental_php, guides: data.guides, divers_per_guide: data.divers_per_guide,
        seat_override: data.seat_override ?? '', blocked_seats: data.blocked_seats,
        sites: Array.from({ length: data.num_dives }, (_, i) => ts.find((x) => x.position === i + 1)?.site_id || ''),
        publish: data.status !== 'draft', status: data.status,
        include_fees: !!data.include_fees, fees_per_diver: data.fees_per_diver ?? '',
        early_pct: data.early_pct || 0, early_days: data.early_days || 14, kind: data.kind || 'fun', activity: data.activity || 'scuba', course_name: data.course_name || '', course_days: data.course_days ?? '', course_prereq: data.course_prereq || '', repeat: 0,
      })
      setHasBookings((data.bookings || []).some((b) => ['pending_payment', 'confirmed'].includes(b.status)))
      setLoaded(true)
    })
  }, [id])

  if (!center) return null

  // Puntos agrupados por zona: primero los de la provincia del centro
  const siteGroups = Object.entries(sites.reduce((m, s) => {
    const k = s.province === center.province || !center.province ? s.area : (s.province || t('Otras zonas'))
    ;(m[k] = m[k] || []).push(s); return m
  }, {})).sort(([a, la], [b, lb]) => {
    const mine = (l) => (center.province && l[0].province === center.province ? 0 : 1)
    return mine(la) - mine(lb) || (a === center.destination ? -1 : b === center.destination ? 1 : a.localeCompare(b))
  })
  const set = (k, num) => (e) => setF({ ...f, [k]: num ? (e.target.value === '' ? '' : +e.target.value) : e.target.value })
  const boat = (boats || []).find((b) => b.id === f.boat_id)
  const operative = boat ? Math.min(boat.capacity, f.guides * f.divers_per_guide, f.seat_override === '' ? 999 : f.seat_override) : 0

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const departs_at = manilaToIso(f.date, f.hour)
    if (new Date(departs_at) < new Date() && !id) { setBusy(false); return setError(t('La fecha ya ha pasado')) }
    const fields = {
      boat_id: f.boat_id, departs_at, num_dives: f.num_dives, min_level: f.min_level,
      price_php: f.price_php, gear_rental_php: f.gear_rental_php || 0, guides: f.guides, divers_per_guide: f.divers_per_guide,
      seat_override: f.seat_override === '' ? null : f.seat_override, blocked_seats: f.blocked_seats || 0,
      include_fees: !!f.include_fees, fees_per_diver: f.include_fees && f.fees_per_diver !== '' ? +f.fees_per_diver : null,
      early_pct: +f.early_pct || 0, early_days: +f.early_days || 14, kind: f.kind, activity: f.kind === 'course' ? 'scuba' : f.activity,
      course_name: f.kind === 'course' ? f.course_name.trim() || null : null, course_days: f.kind === 'course' && f.course_days !== '' ? +f.course_days : null,
      course_prereq: f.kind === 'course' ? f.course_prereq || null : null,
    }
    if (!id || ['draft', 'published'].includes(f.status)) fields.status = f.publish && verified ? 'published' : 'draft'
    const { data: trip, error } = id
      ? await supabase.from('trips').update(fields).eq('id', id).select().single()
      : await supabase.from('trips').insert({ ...fields, center_id: center.id }).select().single()
    if (error) { setBusy(false); return setError(errMsg(error)) }
    if (id) await supabase.from('trip_sites').delete().eq('trip_id', id)
    const ts = f.sites.slice(0, f.num_dives).map((site_id, i) => ({ trip_id: trip.id, site_id, position: i + 1 })).filter((x) => x.site_id)
    if (ts.length) {
      const { error: e2 } = await supabase.from('trip_sites').insert(ts)
      if (e2) { setBusy(false); return setError(t('Salida creada, pero falló guardar los puntos: {error}', { error: errMsg(e2) })) }
    }
    // Repetir: la misma salida los N días siguientes a la misma hora (como las clases fijas de un club)
    if (!id && f.repeat > 0) {
      const dates = Array.from({ length: f.repeat }, (_, i) => addDays(f.date, i + 1))
      const { error: e3 } = await supabase.rpc('repeat_trip', { p_trip: trip.id, p_dates: dates })
      if (e3) { setBusy(false); return setError(t('Salida creada, pero falló repetirla: {error}', { error: errMsg(e3) })) }
    }
    setBusy(false)
    go(id ? '/centro/salidas' : '/centro/agenda?dia=' + f.date)
  }

  return (
    <>
      <Link to="/centro/salidas" className="small">← {t('Salidas')}</Link>
      <h1 style={{ marginTop: 8 }}>{id ? t('Editar salida') : t('Nueva salida')}</h1>
      {id && hasBookings && <div className="msg warn" role="status">{t('Esta salida ya tiene reservas: los cambios de precio no afectan a las reservas hechas, pero avisa a los buceadores si cambias la hora o el barco.')}</div>}
      {!loaded || boats === null ? <p className="muted">{error || t('Cargando…')}</p> : boats.length === 0 ? (
        <div className="card stack">
          <p style={{ margin: 0 }}>{t('Antes de crear salidas, añade al menos un barco con su capacidad.')}</p>
          <Link to="/centro/ajustes" className="btn">{t('Añadir un barco')}</Link>
        </div>
      ) : (
        <form className="card" onSubmit={save}>
          <div className="seg" role="group" aria-label={t('Tipo')}>
            <button type="button" className={f.kind === 'fun' && f.activity === 'scuba' ? 'on' : ''} aria-pressed={f.kind === 'fun' && f.activity === 'scuba'} onClick={() => setF({ ...f, kind: 'fun', activity: 'scuba' })}>{t('Salida de buceo')}</button>
            <button type="button" className={f.kind === 'course' ? 'on' : ''} aria-pressed={f.kind === 'course'} onClick={() => setF({ ...f, kind: 'course', activity: 'scuba', num_dives: Math.min(f.num_dives, 2) })}>{t('Curso')}</button>
            {[['snorkel', 'Esnórquel'], ['freedive', 'Apnea'], ['try_dive', 'Bautismo']].map(([k, n]) => (
              <button key={k} type="button" className={f.kind === 'fun' && f.activity === k ? 'on' : ''} aria-pressed={f.kind === 'fun' && f.activity === k} onClick={() => setF({ ...f, kind: 'fun', activity: k, num_dives: k === 'try_dive' ? 1 : f.num_dives })}>{t(n)}</button>
            ))}
          </div>
          {f.kind === 'fun' && f.activity !== 'scuba' && <p className="small muted">{f.activity === 'snorkel' ? t('Esnórquel: no pide certificación ni cuestionario médico. Ideal para acompañantes.') : f.activity === 'freedive' ? t('Apnea: no pide certificación de buceo; sí el cuestionario médico.') : t('Bautismo (Discover Scuba Diving): para quien no tiene certificación. Pide el cuestionario médico.')}</p>}
          {f.kind === 'course' && (
            <div className="grid3">
              <div className="field"><label htmlFor="ns-cn">{t('Nombre del curso')}</label><input id="ns-cn" required maxLength={80} placeholder={t('p. ej. Open Water, Advanced, Nitrox')} value={f.course_name} onChange={set('course_name')} /></div>
              <div className="field"><label htmlFor="ns-cd">{t('Días')}</label><input id="ns-cd" type="number" inputMode="numeric" min="1" max="14" value={f.course_days} onChange={set('course_days', true)} /></div>
              <div className="field"><label htmlFor="ns-cp">{t('Requisito')}</label><select id="ns-cp" value={f.course_prereq} onChange={set('course_prereq')}><option value="">{t('Ninguno (para empezar)')}</option>{LEVELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
            </div>
          )}
          <div className="grid2">
            <div className="field"><label htmlFor="nuevasalida-1">{t('Día')}</label><input id="nuevasalida-1" type="date" required value={f.date} min={id ? undefined : manilaDate()} onChange={set('date')} /></div>
            <div className="field"><label htmlFor="nuevasalida-2">{t('Hora (Manila)')}</label><input id="nuevasalida-2" type="time" required value={f.hour} onChange={set('hour')} /></div>
            <div className="field"><label htmlFor="nuevasalida-3">{t('Barco')}</label><select id="nuevasalida-3" value={f.boat_id} onChange={set('boat_id')}>{boats.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.capacity})</option>)}</select></div>
            <div className="field"><label htmlFor="nuevasalida-4">{f.activity === 'snorkel' ? t('Paradas') : t('Inmersiones')}</label><select id="nuevasalida-4" value={f.num_dives} onChange={(e) => {
              const n = +e.target.value; setF({ ...f, num_dives: n, sites: Array.from({ length: n }, (_, i) => f.sites[i] || '') })
            }}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></div>
            {f.activity === 'scuba' && <div className="field"><label htmlFor="nuevasalida-5">{t('Nivel mínimo')}</label><select id="nuevasalida-5" value={f.min_level} onChange={set('min_level')}>{LEVELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>}
            <div className="field"><label htmlFor="nuevasalida-6">{t('Precio (₱/buceador)')}</label><input id="nuevasalida-6" type="number" inputMode="numeric" min="1" required value={f.price_php} onChange={set('price_php', true)} /></div>
            <div className="field"><label htmlFor="nuevasalida-7">{t('Alquiler equipo (₱)')}</label><input id="nuevasalida-7" type="number" inputMode="numeric" min="0" value={f.gear_rental_php} onChange={set('gear_rental_php', true)} /></div>
            <div className="field"><label htmlFor="nuevasalida-8">{t('Guías')}</label><input id="nuevasalida-8" type="number" inputMode="numeric" min="1" max="15" required value={f.guides} onChange={set('guides', true)} /></div>
            <div className="field"><label htmlFor="nuevasalida-9">{t('Buceadores por guía')}</label><input id="nuevasalida-9" type="number" inputMode="numeric" min="1" max="10" required value={f.divers_per_guide} onChange={set('divers_per_guide', true)} /></div>
            <div className="field"><label htmlFor="nuevasalida-10">{t('Límite manual de plazas')}</label><input id="nuevasalida-10" type="number" inputMode="numeric" min="0" placeholder={t('(opcional)')} value={f.seat_override} onChange={set('seat_override', true)} /></div>
            <div className="field"><label htmlFor="nuevasalida-11">{t('Plazas reservadas fuera de la app')}</label><input id="nuevasalida-11" type="number" inputMode="numeric" min="0" value={f.blocked_seats} onChange={set('blocked_seats', true)} /></div>
          </div>

          <b>{t('Puntos de buceo')}</b>
          {f.sites.map((v, i) => (
            <div className="field" key={i} style={{ marginTop: 6 }}>
              <select value={v} onChange={(e) => { const s = [...f.sites]; s[i] = e.target.value; setF({ ...f, sites: s }) }}>
                <option value="">{t('Inmersión {n}: por decidir', { n: i + 1 })}</option>
                {siteGroups.map(([label, list]) => (
                  <optgroup key={label} label={label}>
                    {list.map((s) => <option key={s.id} value={s.id}>{s.name.replace(s.area + ' – ', '')}{s.max_depth_m ? ' · ' + s.max_depth_m + ' m' : ''}{s.recommended_min === 'advanced' ? ' · AOW' : ''}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}

          <div className="field" style={{ marginTop: 10 }}>
            <label className="check"><input type="checkbox" checked={f.include_fees} onChange={(e) => setF({ ...f, include_fees: e.target.checked })} /> {t('Incluir en el pago las tasas de santuarios y parques marinos')}</label>
            {f.include_fees && (() => {
              const auto = f.sites.slice(0, f.num_dives).reduce((n, sid) => n + (sites.find((x) => x.id === sid)?.sanctuary_fee_php || 0), 0)
              return (
                <div className="row wrap" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
                  <label className="small" htmlFor="nuevasalida-fees">{t('Tasas por buceador (₱)')}</label>
                  <input id="nuevasalida-fees" type="number" inputMode="numeric" min="0" max="20000" style={{ width: 110 }} placeholder={String(auto)} value={f.fees_per_diver} onChange={set('fees_per_diver', true)} />
                  <span className="small muted">{t('El buceador las paga con la reserva y se le muestran aparte (p. ej. Balicasag, Pescador, Apo Island).')}</span>
                </div>
              )
            })()}
          </div>

          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="field"><label htmlFor="ns-early">{t('Descuento por reserva anticipada (%)')}</label>
              <input id="ns-early" type="number" inputMode="numeric" min="0" max="30" value={f.early_pct} onChange={set('early_pct', true)} /></div>
            <div className="field"><label htmlFor="ns-early-d">{t('Días de antelación')}</label><input id="ns-early-d" type="number" inputMode="numeric" min="2" max="90" value={f.early_days} onChange={set('early_days', true)} /></div>
          </div>
          <p className="small muted" style={{ marginTop: -4 }}>{t('Para llenar el barco antes: se aplica si reservan con más de {n} días.', { n: f.early_days || 14 })}</p>
          {!id && (
            <div className="field"><label htmlFor="ns-rep">{t('Repetir los días siguientes')}</label>
              <select id="ns-rep" value={f.repeat} onChange={set('repeat', true)}>
                <option value={0}>{t('No repetir')}</option>
                {[6, 13, 29].map((n) => <option key={n} value={n}>{t('Cada día, {n} días más', { n })}</option>)}
              </select></div>
          )}
          <p className="small muted">{t('Plazas operativas:')} <b>{operative}</b> · {t('en la app:')} <b>{Math.max(0, operative - (f.blocked_seats || 0))}</b> · {t('precio {price}', { price: php(f.price_php) })}</p>
          {verified
            ? <label className="check field"><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> {t('Publicar ya (si no, queda como borrador)')}</label>
            : <p className="small muted">{t('Se guardará como borrador: podrás publicarla cuando tu centro esté verificado.')} <Link to="/centro/verificacion">{t('Verificar centro')}</Link></p>}
          {error && <div className="msg err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy}>{busy ? t('Guardando…') : id ? t('Guardar cambios') : t('Crear salida')}</button>
        </form>
      )}
    </>
  )
}
