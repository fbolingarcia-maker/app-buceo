import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { levelName, levelRank, dateTime, php } from '../lib/format'

export default function Salida({ id }) {
  const { session, diver, isCenter } = useAuth()
  const [t, setT] = useState(null)
  const [center, setCenter] = useState(null)
  const [certs, setCerts] = useState([])
  const [seats, setSeats] = useState(1)
  const [gear, setGear] = useState(false)
  const [medical, setMedical] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('published_trips').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error) setError(errMsg(error))
      setT(data || false)
      if (data) supabase.from('centers').select('name, phone, locality, website').eq('id', data.center_id).maybeSingle().then(({ data }) => setCenter(data))
    })
  }, [id])

  useEffect(() => {
    if (diver) supabase.from('certifications').select('level').eq('diver_id', diver.id).then(({ data }) => setCerts(data || []))
  }, [diver])

  if (t === null) return <p className="muted">Cargando…</p>
  if (t === false) return <div className="card">Esta salida ya no está disponible. <Link to="/">Ver salidas</Link></div>

  const best = certs.reduce((m, c) => Math.max(m, levelRank(c.level)), -1)
  const levelOk = best >= levelRank(t.min_level)
  const total = seats * t.price_php + (gear ? seats * t.gear_rental_php : 0)

  async function book() {
    setBusy(true); setError('')
    const { error } = await supabase.rpc('book_trip', { p_trip: t.id, p_seats: seats, p_with_gear: gear, p_medical_signed: medical })
    setBusy(false)
    if (error) return setError(errMsg(error))
    go('/reservas')
  }

  return (
    <>
      <Link to="/" className="small">← Salidas</Link>
      <h1 style={{ marginTop: 8 }}>{t.center_name}</h1>
      <div className="card stack">
        <div className="row between"><span className="muted">Salida</span><b>{dateTime(t.departs_at)}</b></div>
        <div className="row between"><span className="muted">Barco</span><span>{t.boat_name}</span></div>
        <div className="row between"><span className="muted">Inmersiones</span><span>{t.num_dives}</span></div>
        <div className="row between"><span className="muted">Nivel mínimo</span><span className="pill">{levelName(t.min_level)}</span></div>
        <div className="row between"><span className="muted">Precio por buceador</span><b>{php(t.price_php)}</b></div>
        <div className="row between"><span className="muted">Alquiler de equipo</span><span>{t.gear_rental_php ? php(t.gear_rental_php) : '—'}</span></div>
        <div className="row between"><span className="muted">Plazas libres</span><b>{t.available_seats}</b></div>
        {t.sites?.length > 0 && (
          <div><div className="muted">Puntos de buceo</div><ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>{t.sites.map((s) => <li key={s}>{s}</li>)}</ol></div>
        )}
        {center?.phone && <div className="small muted">Contacto del centro: {center.phone}</div>}
      </div>

      <h2>Reservar</h2>
      {!session ? (
        <div className="card">
          <p>Para reservar necesitas una cuenta.</p>
          <Link to="/login" className="btn block">Entrar o crear cuenta</Link>
        </div>
      ) : isCenter ? (
        <div className="card muted">Estás con una cuenta de centro. Para reservar, usa una cuenta de buceador.</div>
      ) : t.available_seats < 1 ? (
        <div className="card muted">Salida completa.</div>
      ) : (
        <div className="card">
          {!levelOk && (
            <div className="msg err">
              {certs.length === 0 ? 'Añade tu certificación en el perfil para poder reservar.' : `Esta salida requiere ${levelName(t.min_level)}.`}{' '}
              <Link to="/perfil">Ir al perfil</Link>
            </div>
          )}
          <div className="field">
            <label>Plazas</label>
            <select value={seats} onChange={(e) => setSeats(+e.target.value)}>
              {Array.from({ length: Math.min(t.available_seats, 6) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
            </select>
          </div>
          {t.gear_rental_php > 0 && (
            <label className="check field"><input type="checkbox" checked={gear} onChange={(e) => setGear(e.target.checked)} /> Alquilar equipo completo (+{php(t.gear_rental_php)} por persona)</label>
          )}
          <label className="check field">
            <input type="checkbox" checked={medical} onChange={(e) => setMedical(e.target.checked)} />
            <span>Declaro que estoy en condiciones médicas para bucear y que he respondido "no" a todas las preguntas del cuestionario médico RSTC (o tengo autorización médica).</span>
          </label>
          <div className="row between" style={{ margin: '12px 0 4px' }}><span>Total</span><span className="big">{php(total)}</span></div>
          <div className="row between small" style={{ marginBottom: 12 }}>
            <span className="muted">Para reservar pagas como mínimo el 50 %</span><b>{php(Math.ceil(total / 2))}</b>
          </div>
          {error && <div className="msg err">{error}</div>}
          <button className="btn block" disabled={busy || !medical || !levelOk} onClick={book}>
            {busy ? 'Reservando…' : 'Reservar plaza'}
          </button>
          <p className="muted small">Pagas con GCash o tarjeta: al menos el 50 % para confirmar la plaza (retenida 15 min) y el resto en la app o en efectivo en el centro. Cancelación con devolución total hasta 24 h antes; después el centro se queda el 50 % del precio. Si se cancela por meteo, se devuelve todo lo pagado.</p>
        </div>
      )}
    </>
  )
}
