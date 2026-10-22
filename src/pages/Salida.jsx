import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { levelName, levelRank, levelColor, dateTime, php } from '../lib/format'
import DepthBar from '../lib/DepthBar'
import { t, getLang } from '../lib/i18n'
import { Flags } from '../lib/langs'
import Icon from '../lib/Icon'
import { ArrowLeft, Check, MapPin, MessageCircle, Waves } from 'lucide-react'

// Quién ha reservado ya esta salida (resumen del perfil de cada buceador)
function QuienVa({ tripId, loggedIn }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    supabase.rpc('trip_divers', { p_trip: tripId }).then(({ data }) => setData(data || { divers: [], others: 0 }))
  }, [tripId, loggedIn])
  if (!data) return null
  const total = data.divers.reduce((n, d) => n + d.seats, 0) + data.others
  return (
    <>
      <h2>{t('¿Quién va?')} {total > 0 && <span className="muted small" style={{ fontWeight: 400 }}>· {total === 1 ? t('1 plaza reservada') : t('{n} plazas reservadas', { n: total })}</span>}</h2>
      {total === 0 && <div className="card muted">{t('Aún no ha reservado nadie. ¡Sé el primero!')}</div>}
      {data.divers.map((d, i) => (
        <div key={i} className="card diver">
          <div className="avatar" aria-hidden>{(d.name || '?').charAt(0).toUpperCase()}</div>
          <div className="grow">
            <div className="row between wrap" style={{ gap: 6 }}>
              <b>{d.name}{d.is_me ? ' · ' + t('Tú') : ''}{d.seats > 1 ? ' ' + (d.seats === 2 ? t('+1 acompañante') : t('+{n} acompañantes', { n: d.seats - 1 })) : ''}</b>
              {d.level
                ? <span className="pill">{levelName(d.level)}{d.verified && <Icon icon={Check} size={14} aria-label={t('Verificada')} />}</span>
                : <span className="pill warn">{t('Sin certificación')}</span>}
            </div>
            <div className="small muted row wrap" style={{ marginTop: 2, gap: '2px 10px' }}>
              <span><Icon icon={Waves} size={14} /> {d.dives ? t('{n} inmersiones', { n: d.dives }) : t('Primeras inmersiones')}</span>
              {d.country && <span><Icon icon={MapPin} size={14} /> {d.country}</span>}
              {d.languages?.length > 0 && <span><Icon icon={MessageCircle} size={14} /> {d.languages.join(', ')}</span>}
            </div>
            {(d.fav_site || d.seeks_buddy) && (
              <div className="row wrap small" style={{ marginTop: 4, gap: 6 }}>
                {d.seeks_buddy && <span className="pill ok">{t('Busca buddy')}</span>}
                {d.fav_site && <span className="muted">{t('Punto favorito: {site}', { site: d.fav_site })}</span>}
              </div>
            )}
            {d.bio && <div className="small" style={{ marginTop: 4, fontStyle: 'italic' }}>“{d.bio}”</div>}
          </div>
        </div>
      ))}
      {data.others > 0 && (
        <p className="small muted" style={{ marginTop: -4 }}>
          {!loggedIn
            ? (data.others === 1 ? t('1 buceador ya ha reservado. Entra para ver quién va.') : t('{n} plazas ya reservadas. Entra para ver quién va.', { n: data.others }))
            : data.divers.length
              ? (data.others === 1 ? t('Y 1 plaza más reservada por otra persona.') : t('Y {n} plazas más reservadas por otras personas.', { n: data.others }))
              : (data.others === 1 ? t('1 plaza reservada por alguien que prefiere no mostrar su perfil.') : t('{n} plazas reservadas por gente que prefiere no mostrar su perfil.', { n: data.others }))}
        </p>
      )}
    </>
  )
}

export default function Salida({ id }) {
  const { session, diver, isCenter } = useAuth()
  const [trip, setTrip] = useState(null)
  const [center, setCenter] = useState(null)
  const [siteInfo, setSiteInfo] = useState([])
  const [shared, setShared] = useState('')
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
      if (data) {
        supabase.from('centers').select('name, phone, locality, website, destination, province, languages, course_languages').eq('id', data.center_id).maybeSingle().then(({ data }) => setCenter(data))
        if (data.sites?.length) supabase.from('dive_sites').select('name, min_depth_m, max_depth_m, highlight, highlight_es, recommended_min').in('name', data.sites).then(({ data }) => setSiteInfo(data || []))
      }
    })
  }, [id])

  useEffect(() => {
    if (diver) supabase.from('certifications').select('level').eq('diver_id', diver.id).then(({ data }) => setCerts(data || []))
  }, [diver])

  // Barra fija de reserva mientras la sección «Reservar» no está a la vista
  const [ctaVisible, setCtaVisible] = useState(false)
  useEffect(() => {
    const el = document.getElementById('reservar')
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setCtaVisible(!e.isIntersecting && e.boundingClientRect.top > 0), { rootMargin: '0px 0px -140px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [trip])

  if (trip === null) return <p className="muted">{t('Cargando…')}</p>
  if (trip === false) return <div className="card">{t('Esta salida ya no está disponible.')} <Link to="/">{t('Ver salidas')}</Link></div>

  const best = certs.reduce((m, c) => Math.max(m, levelRank(c.level)), -1)
  const levelOk = best >= levelRank(trip.min_level)
  const total = seats * trip.price_php + (gear ? seats * trip.gear_rental_php : 0)

  async function share() {
    const url = window.location.href
    const text = t('Salida de buceo con {centro} el {fecha}', { centro: trip.center_name, fecha: dateTime(trip.departs_at) })
    try {
      if (navigator.share) await navigator.share({ title: 'DivingSlot', text, url })
      else { await navigator.clipboard.writeText(text + ' ' + url); setShared(t('Enlace copiado')) }
    } catch {}
  }

  async function book() {
    setBusy(true); setError('')
    const { error } = await supabase.rpc('book_trip', { p_trip: trip.id, p_seats: seats, p_with_gear: gear, p_medical_signed: medical })
    setBusy(false)
    if (error) return setError(errMsg(error))
    try { sessionStorage.setItem('justBooked', '1') } catch (e) { /* sin almacenamiento */ }
    go('/reservas')
  }

  return (
    <>
      <Link to="/" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Salidas')}</Link>
      <h1 style={{ marginTop: 8 }}>{trip.center_name}</h1>
      {trip.available_seats > 0 && !isCenter && (
        <div className="row between" style={{ gap: 8, marginBottom: 12 }}>
          <span className="muted small">{t('{n} plazas', { n: trip.available_seats })} · <b>{php(trip.price_php)}</b></span>
          <button type="button" className="btn small" onClick={() => document.getElementById('reservar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t('Reservar')}</button>
        </div>
      )}
      <div className="card stack">
        <div className="row between"><span className="muted">{t('Salida')}</span><b>{dateTime(trip.departs_at)}</b></div>
        {trip.boat_name && <div className="row between"><span className="muted">{t('Barco')}</span><span>{trip.boat_name}</span></div>}
        <div className="row between"><span className="muted">{t('Inmersiones')}</span><span>{trip.num_dives}</span></div>
        <div className="row between"><span className="muted">{t('Nivel mínimo')}</span><span className="pill lvl"><i style={{ background: levelColor(trip.min_level) }} />{levelName(trip.min_level)}</span></div>
        <div className="row between"><span className="muted">{t('Precio por buceador')}</span><b>{php(trip.price_php)}</b></div>
        <div className="row between"><span className="muted">{t('Alquiler de equipo')}</span><span>{trip.gear_rental_php ? php(trip.gear_rental_php) : '—'}</span></div>
        <div className="row between"><span className="muted">{t('Plazas libres')}</span><b>{trip.available_seats}</b></div>
      </div>

      {trip.sites?.length > 0 && (() => {
        // Regla de 0 a 40 m, o hasta el máximo de la salida redondeado a 10 si algún punto pasa de 40 m
        const deepest = Math.max(0, ...siteInfo.map((x) => x.max_depth_m || 0))
        const scale = deepest > 40 ? Math.ceil(deepest / 10) * 10 : 40
        return (
          <div className="card">
            <div className="over" style={{ marginBottom: 12 }}>{t('Puntos de esta salida')}</div>
            <div className="sites">
              {trip.sites.map((s) => {
                const info = siteInfo.find((x) => x.name === s)
                const desc = info && (getLang() === 'es' ? (info.highlight_es || info.highlight) : info.highlight)
                return (
                  <div key={s} className="site-row">
                    <div style={{ minWidth: 0 }}><b>{s}</b>{desc && <small className="muted">{desc}</small>}</div>
                    <DepthBar min={info?.min_depth_m} max={info?.max_depth_m} scale={scale} />
                  </div>
                )
              })}
            </div>
            <div className="depth-axis" aria-hidden="true"><span /><div><span>0</span><span>{scale / 2}</span><span>{scale} m</span></div></div>
          </div>
        )
      })()}

      <div className="card">
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <Link to={'/c/' + trip.center_id}><b>{trip.center_name}</b></Link> <Flags codes={center?.languages} />
            <div className="small muted"><Icon icon={MapPin} size={14} /> {[center?.locality, center?.destination || trip.center_destination, center?.province || trip.center_province].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}
              {(center?.destination || trip.center_destination) && <> · <Link to={'/d/' + encodeURIComponent(center?.destination || trip.center_destination)}>{t('Guía del destino')}</Link></>}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {center?.phone && <a className="btn small ghost" href={'https://wa.me/' + center.phone.replace(/\D/g, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
            <a className="btn small ghost" href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(trip.center_name + ' ' + (center?.destination || trip.center_destination || ''))} target="_blank" rel="noreferrer">{t('Mapa')}</a>
            <button type="button" className="btn small ghost" onClick={share}>{t('Compartir')}</button>
          </div>
        </div>
        {shared && <div className="msg ok" role="status">{shared}</div>}
      </div>

      <QuienVa tripId={trip.id} loggedIn={!!session} />

      {ctaVisible && trip.available_seats > 0 && !isCenter && (
        <div className="sticky-cta">
          <span><b>{php(trip.price_php)}</b> <span className="small muted">· {t('{n} plazas', { n: trip.available_seats })}</span></span>
          <button type="button" className="btn small" onClick={() => document.getElementById('reservar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t('Reservar')}</button>
        </div>
      )}
      <h2 id="reservar" style={{ scrollMarginTop: 12 }}>{t('Reservar')}</h2>
      {!session ? (
        <div className="card">
          <p>{t('Para reservar necesitas una cuenta.')}</p>
          <Link to="/login" className="btn block" onClick={() => { try { sessionStorage.setItem('afterLogin', '/salida/' + trip.id) } catch (e) { /* sin almacenamiento */ } }}>{t('Entrar o crear cuenta')}</Link>
          <p className="small muted" style={{ marginBottom: 0 }}>{t('Después de entrar volverás a esta salida.')}</p>
        </div>
      ) : isCenter ? (
        <div className="card muted">{t('Estás con una cuenta de centro. Para reservar, usa una cuenta de buceador.')}</div>
      ) : trip.available_seats < 1 ? (
        <div className="card muted">{t('Salida completa.')}</div>
      ) : (
        <div className="card">
          {!levelOk && (
            <div className="msg warn" role="status">
              {certs.length === 0 ? t('Añade tu certificación en el perfil para poder reservar.') : t('Esta salida requiere {nivel}.', { nivel: levelName(trip.min_level) })}{' '}
              <Link to="/perfil" onClick={() => { try { sessionStorage.setItem('afterCert', '/salida/' + trip.id) } catch (e) { /* sin almacenamiento */ } }}>{t('Ir al perfil')}</Link>
            </div>
          )}
          <div className="field">
            <label htmlFor="seats">{t('Plazas')}</label>
            <select id="seats" value={seats} onChange={(e) => setSeats(+e.target.value)}>
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
          <div className="row between small" style={{ marginBottom: 8 }}>
            <span className="muted">{t('Para reservar pagas como mínimo el 50 %')}</span><b>{php(Math.ceil(total / 2))}</b>
          </div>
          <details className="small how-pay">
            <summary>{t('¿Cómo funciona el pago?')}</summary>
            <ul>
              <li>{t('Ahora pagas la señal (50 %) con GCash o tarjeta. Tu plaza queda guardada 15 minutos mientras pagas.')}</li>
              <li>{t('El resto lo pagas en la app o en efectivo en el centro el día de la salida.')}</li>
              <li>{t('Si cancelas con 24 h o más, te devolvemos todo. Si el centro cancela por el mar, también.')}</li>
            </ul>
          </details>
          {error && <div className="msg err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy || !medical || !levelOk} onClick={book} aria-describedby="book-hint">
            {busy ? t('Reservando…') : t('Reservar plaza')}
          </button>
          {levelOk && !medical && <p id="book-hint" className="small muted" style={{ marginTop: 6 }}>{t('Marca la declaración médica para continuar.')}</p>}
        </div>
      )}
    </>
  )
}
