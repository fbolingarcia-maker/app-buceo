import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { levelName, levelRank, dateTime, php } from '../lib/format'
import { t } from '../lib/i18n'

export default function Salida({ id }) {
  const { session, diver, isCenter } = useAuth()
  const [trip, setTrip] = useState(null)
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
      setTrip(data || false)
      if (data) supabase.from('centers').select('name, phone, locality, website').eq('id', data.center_id).maybeSingle().then(({ data }) => setCenter(data))
    })
  }, [id])

  useEffect(() => {
    if (diver) supabase.from('certifications').select('level').eq('diver_id', diver.id).then(({ data }) => setCerts(data || []))
  }, [diver])

  if (trip === null) return <p className="muted">{t('Cargando…')}</p>
  if (trip === false) return <div className="card">{t('Esta salida ya no está disponible.')} <Link to="/">{t('Ver salidas')}</Link></div>

  const best = certs.reduce((m, c) => Math.max(m, levelRank(c.level)), -1)
  const levelOk = best >= levelRank(trip.min_level)
  const total = seats * trip.price_php + (gear ? seats * trip.gear_rental_php : 0)

  async function book() {
    setBusy(true); setError('')
    const { error } = await supabase.rpc('book_trip', { p_trip: trip.id, p_seats: seats, p_with_gear: gear, p_medical_signed: medical })
    setBusy(false)
    if (error) return setError(errMsg(error))
    go('/reservas')
  }

  return (
    <>
      <Link to="/" className="small">{t('← Salidas')}</Link>
      <h1 style={{ marginTop: 8 }}>{trip.center_name}</h1>
      <div className="card stack">
        <div className="row between"><span className="muted">{t('Salida')}</span><b>{dateTime(trip.departs_at)}</b></div>
        <div className="row between"><span className="muted">{t('Barco')}</span><span>{trip.boat_name}</span></div>
        <div className="row between"><span className="muted">{t('Inmersiones')}</span><span>{trip.num_dives}</span></div>
        <div className="row between"><span className="muted">{t('Nivel mínimo')}</span><span className="pill">{levelName(trip.min_level)}</span></div>
        <div className="row between"><span className="muted">{t('Precio por buceador')}</span><b>{php(trip.price_php)}</b></div>
        <div className="row between"><span className="muted">{t('Alquiler de equipo')}</span><span>{trip.gear_rental_php ? php(trip.gear_rental_php) : '—'}</span></div>
        <div className="row between"><span className="muted">{t('Plazas libres')}</span><b>{trip.available_seats}</b></div>
        {trip.sites?.length > 0 && (
          <div><div className="muted">{t('Puntos de buceo')}</div><ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>{trip.sites.map((s) => <li key={s}>{s}</li>)}</ol></div>
        )}
        {center?.phone && <div className="small muted">{t('Contacto del centro: {tel}', { tel: center.phone })}</div>}
      </div>

      <h2>{t('Reservar')}</h2>
      {!session ? (
        <div className="card">
          <p>{t('Para reservar necesitas una cuenta.')}</p>
          <Link to="/login" className="btn block">{t('Entrar o crear cuenta')}</Link>
        </div>
      ) : isCenter ? (
        <div className="card muted">{t('Estás con una cuenta de centro. Para reservar, usa una cuenta de buceador.')}</div>
      ) : trip.available_seats < 1 ? (
        <div className="card muted">{t('Salida completa.')}</div>
      ) : (
        <div className="card">
          {!levelOk && (
            <div className="msg err">
              {certs.length === 0 ? t('Añade tu certificación en el perfil para poder reservar.') : t('Esta salida requiere {nivel}.', { nivel: levelName(trip.min_level) })}{' '}
              <Link to="/perfil">{t('Ir al perfil')}</Link>
            </div>
          )}
          <div className="field">
            <label>{t('Plazas')}</label>
            <select value={seats} onChange={(e) => setSeats(+e.target.value)}>
              {Array.from({ length: Math.min(trip.available_seats, 6) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
            </select>
          </div>
          {trip.gear_rental_php > 0 && (
            <label className="check field"><input type="checkbox" checked={gear} onChange={(e) => setGear(e.target.checked)} /> {t('Alquilar equipo completo (+{precio} por persona)', { precio: php(trip.gear_rental_php) })}</label>
          )}
          <label className="check field">
            <input type="checkbox" checked={medical} onChange={(e) => setMedical(e.target.checked)} />
            <span>{t('Declaro que estoy en condiciones médicas para bucear y que he respondido "no" a todas las preguntas del cuestionario médico RSTC (o tengo autorización médica).')}</span>
          </label>
          <div className="row between" style={{ margin: '12px 0 4px' }}><span>{t('Total')}</span><span className="big">{php(total)}</span></div>
          <div className="row between small" style={{ marginBottom: 12 }}>
            <span className="muted">{t('Para reservar pagas como mínimo el 50 %')}</span><b>{php(Math.ceil(total / 2))}</b>
          </div>
          {error && <div className="msg err">{error}</div>}
          <button className="btn block" disabled={busy || !medical || !levelOk} onClick={book}>
            {busy ? t('Reservando…') : t('Reservar plaza')}
          </button>
          <p className="muted small">{t('Pagas con GCash o tarjeta: al menos el 50 % para confirmar la plaza (retenida 15 min) y el resto en la app o en efectivo en el centro. Cancelación con devolución total hasta 24 h antes; después el centro se queda el 50 % del precio. Si se cancela por meteo, se devuelve todo lo pagado.')}</p>
        </div>
      )}
    </>
  )
}
