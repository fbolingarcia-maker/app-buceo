import { useEffect, useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Link, go } from '../lib/router'
import { levelName, levelRank, levelColor, dateTime, php } from '../lib/format'
import DepthBar from '../lib/DepthBar'
import { t, getLang } from '../lib/i18n'
import { Flags, langName } from '../lib/langs'
import Icon from '../lib/Icon'
import { ArrowLeft, Check, MapPin, MessageCircle, Waves, Users, GraduationCap, Clock, Plus, TriangleAlert } from 'lucide-react'
import { BuddyChip, BuddyBreakdown } from '../lib/buddy'
import { medicalValid, medicalUntil, medicalLabel, daysSinceDive } from '../lib/medical'
import { viaFor, unitPrice, PriceTag, LastMinuteTag, extrasTotal, extraKind, GreenFinsBadge, SeaCard, DanCard, hasInsurance } from '../lib/extras'
import { PayBox, holdEnd } from '../lib/pay'
import { TripChat, CenterReviews, expName, Approx } from '../lib/plus'
import { noCert, noMedical, activityName, Sightings, FollowButton } from '../lib/comunidad'
import { time, dayLabel, manilaDate } from '../lib/format'

const DRAFT = 'ds_book_draft'
const toProfile = (back) => { try { sessionStorage.setItem('afterCert', back) } catch (e) { /* sin almacenamiento */ } }

// Quién ha reservado ya esta salida (resumen del perfil de cada buceador)
function QuienVa({ tripId, loggedIn }) {
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    supabase.rpc('trip_divers', { p_trip: tripId }).then(({ data }) => setData(data || { divers: [], others: 0 }))
  }, [tripId, loggedIn])
  if (!data) return null
  const total = data.divers.reduce((n, d) => n + d.seats, 0) + data.others
  return (
    <details className="fold" open={total < 5}>
      <summary><h2 style={{ display: 'inline' }}>{t('¿Quién va?')} {total > 0 && <span className="muted small" style={{ fontWeight: 400 }}>· {total === 1 ? t('1 plaza reservada') : t('{n} plazas reservadas', { n: total })}</span>}</h2></summary>
      {total === 0 && <div className="card muted">{t('Aún no ha reservado nadie. ¡Sé el primero!')}</div>}
      {data.divers.map((d, i) => (
        <div key={i} className="card diver">
          <div className="avatar" aria-hidden>{(d.name || '?').charAt(0).toUpperCase()}</div>
          <div className="grow">
            <div className="row between wrap" style={{ gap: 6 }}>
              <b>{d.public_id && !d.is_me ? <Link to={'/buzo/' + d.public_id}>{d.name}</Link> : d.name}{d.is_me ? ' · ' + t('Tú') : ''}{d.seats > 1 ? ' ' + (d.seats === 2 ? t('+1 acompañante') : t('+{n} acompañantes', { n: d.seats - 1 })) : ''}</b>
              <span className="row" style={{ gap: 4 }}>
                {d.level
                  ? <span className="pill">{levelName(d.level)}{d.verified && <Icon icon={Check} size={14} aria-label={t('Verificada')} />}</span>
                  : <span className="pill warn">{t('Sin certificación')}</span>}
                {d.exp && <span className="pill small exp">{expName(d.exp)}</span>}
              </span>
            </div>
            <div className="small muted row wrap" style={{ marginTop: 2, gap: '2px 10px' }}>
              <span><Icon icon={Waves} size={14} /> {d.dives ? t('{n} inmersiones', { n: d.dives }) : t('Primeras inmersiones')}</span>
              {d.country && <span><Icon icon={MapPin} size={14} /> {d.country}</span>}
              {d.languages?.length > 0 && <span><Icon icon={MessageCircle} size={14} /> {d.languages.map(langName).join(', ')}</span>}
              <BuddyChip buddy={d.buddy} open={open === i} onClick={() => setOpen(open === i ? null : i)} />
            </div>
            {open === i && d.buddy && <div style={{ marginTop: 10 }}><BuddyBreakdown s={{ ...d.buddy, overall: d.buddy.score }} /></div>}
            {(d.fav_site || d.seeks_buddy) && (
              <div className="row wrap small" style={{ marginTop: 4, gap: 6 }}>
                {d.seeks_buddy && <span className="pill ok">{t('Busca buddy')}</span>}
                {d.seeks_buddy && !d.is_me && <button type="button" className="linkish small" onClick={() => document.getElementById('reservar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon icon={Users} size={14} /> {t('Bucear con {name}', { name: d.name.split(' ')[0] })}</button>}
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
    </details>
  )
}

export default function Salida({ id }) {
  const { session, diver, isCenter, refresh } = useAuth()
  const [trip, setTrip] = useState(null)
  const [center, setCenter] = useState(null)
  const [siteInfo, setSiteInfo] = useState([])
  const [shared, setShared] = useState('')
  const [certs, setCerts] = useState([])
  const [seats, setSeats] = useState(1)
  const [gear, setGear] = useState(false)
  const [extras, setExtras] = useState([])
  const [chosen, setChosen] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Reserva recién creada: el pago se hace aquí mismo, sin cambiar de pantalla (y se pueden sumar más días)
  const [booked, setBooked] = useState(null)
  const [mine, setMine] = useState(null) // reserva activa propia en esta salida (para el chat)
  const [wait, setWait] = useState(null) // { position } si está en la lista de espera
  const [pack, setPack] = useState(null)
  const openChat = /[?&]chat=1/.test(window.location.hash)
  const [mode, setMode] = useState('demo')
  const [, tick] = useState(0)
  useEffect(() => {
    supabase.from('app_config').select('value').eq('key', 'payments_mode').maybeSingle().then(({ data }) => data && setMode(data.value))
  }, [])
  useEffect(() => { if (!booked) return; const i = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(i) }, [booked])
  // Lo elegido antes de entrar (plazas, equipo, extras) se recupera al volver a la salida
  useEffect(() => {
    try {
      const d = JSON.parse(sessionStorage.getItem(DRAFT) || 'null')
      if (d?.trip === id && session) {
        sessionStorage.removeItem(DRAFT)
        setSeats(d.seats || 1); setGear(!!d.gear); setChosen(d.chosen || [])
        setTimeout(() => document.getElementById('reservar')?.scrollIntoView({ block: 'start' }), 300)
      }
    } catch (e) { /* sin almacenamiento */ }
  }, [id, session])

  useEffect(() => {
    supabase.from('published_trips').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error) setError(errMsg(error))
      setTrip(data || false)
      if (data) {
        supabase.from('centers').select('name, phone, locality, website, destination, province, languages, course_languages, green_fins, green_fins_verified').eq('id', data.center_id).maybeSingle().then(({ data }) => setCenter(data))
        supabase.from('center_extras').select('id, kind, name, description, price_php, per_seat').eq('center_id', data.center_id).eq('active', true).order('price_php').then(({ data }) => setExtras(data || []))
        if (data.sites?.length) supabase.from('dive_sites').select('name, min_depth_m, max_depth_m, highlight, highlight_es, recommended_min').in('name', data.sites).then(({ data }) => setSiteInfo(data || []))
      }
    })
  }, [id])

  useEffect(() => {
    if (diver) supabase.from('certifications').select('level, agency').eq('diver_id', diver.id).then(({ data }) => setCerts(data || []))
  }, [diver])
  useEffect(() => {
    if (!diver) return
    supabase.from('bookings').select('id, status').eq('trip_id', id).eq('diver_id', diver.id).in('status', ['confirmed', 'pending_payment']).then(({ data }) => setMine((data || [])[0] || null))
    supabase.rpc('my_waitlist').then(({ data }) => { const w = (data || []).find((x) => x.trip_id === id); setWait(w || null) })
  }, [diver, id, booked])
  useEffect(() => { supabase.rpc('pack_preview', { p_trip: id }).then(({ data }) => setPack(data || null)) }, [id, session])

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
  const course = trip.kind === 'course'
  // Esnórquel, apnea y bautismo: sin certificación; el esnórquel tampoco pide el cuestionario médico
  const need = noCert(trip) ? null : course ? trip.course_prereq : trip.min_level
  const levelOk = !need || best >= levelRank(need)
  const medicalReq = !noMedical(trip)
  const medical = !medicalReq || medicalValid(diver)
  const sinceDive = daysSinceDive(diver)
  const hasSizes = !!(diver?.wetsuit_size || diver?.bcd_size || diver?.fin_size)
  const unit = unitPrice(trip)
  const fees = trip.fees_php || 0
  const extrasAmt = extrasTotal(extras, chosen, seats)
  const total = seats * (unit + fees) + (gear ? seats * trip.gear_rental_php : 0) + extrasAmt

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
    const { data, error } = await supabase.rpc('book_trip', { p_trip: trip.id, p_seats: seats, p_with_gear: gear, p_medical_signed: medical, p_ref: viaFor(trip.center_id), p_extras: chosen })
    setBusy(false)
    if (error) return setError(errMsg(error))
    // Sin los importes en la respuesta (backend antiguo), el pago sigue en Reservas como antes
    if (!data?.id || data.amount_php == null) {
      try { sessionStorage.setItem('justBooked', '1') } catch (e) { /* sin almacenamiento */ }
      return go('/reservas')
    }
    setBooked(data)
    setTimeout(() => document.getElementById('reservar')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  function loginToBook() {
    try {
      sessionStorage.setItem('afterLogin', '/salida/' + trip.id)
      sessionStorage.setItem(DRAFT, JSON.stringify({ trip: trip.id, seats, gear, chosen }))
    } catch (e) { /* sin almacenamiento */ }
    go('/login')
  }

  return (
    <>
      <Link to="/" className="small"><Icon icon={ArrowLeft} size={16} /> {t('Salidas')}</Link>
      <h1 style={{ marginTop: 8 }}>{trip.center_name}</h1>
      {trip.available_seats > 0 && !isCenter && (
        <div className="row between" style={{ gap: 8, marginBottom: 12 }}>
          <span className="muted small">{t('{n} plazas', { n: trip.available_seats })} · <PriceTag trip={trip} /> <LastMinuteTag trip={trip} /></span>
          <button type="button" className="btn small" onClick={() => document.getElementById('reservar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t('Reservar')}</button>
        </div>
      )}
      <div className="card stack facts">
        <div className="row between"><span className="muted">{t('Salida')}</span><b>{dateTime(trip.departs_at)}</b></div>
        {trip.boat_name && <div className="row between"><span className="muted">{t('Barco')}</span><span>{trip.boat_name}</span></div>}
        {noCert(trip) && <div className="row between"><span className="muted">{t('Actividad')}</span><span className="pill act">{activityName(trip.activity)} · {t('sin certificación')}</span></div>}
        <div className="row between"><span className="muted">{trip.activity === 'snorkel' ? t('Paradas') : t('Inmersiones')}</span><span>{trip.num_dives}</span></div>
        {course && <div className="row between"><span className="muted">{t('Curso')}</span><span className="pill ok"><Icon icon={GraduationCap} size={14} /> {trip.course_name || t('Curso')}{trip.course_days ? ' · ' + (trip.course_days === 1 ? t('1 día') : t('{n} días', { n: trip.course_days })) : ''}</span></div>}
        {noCert(trip) ? null : course ? <div className="row between"><span className="muted">{t('Requisito')}</span><span>{trip.course_prereq ? levelName(trip.course_prereq) : t('Ninguno: es para empezar')}</span></div> :
        <div className="row between"><span className="muted">{t('Nivel mínimo')}</span><span className="pill lvl"><i style={{ background: levelColor(trip.min_level) }} />{levelName(trip.min_level)}</span></div>}
        <div className="row between"><span className="muted">{t('Precio por buceador')}</span><span><LastMinuteTag trip={trip} /> <PriceTag trip={trip} /></span></div>
        {fees > 0 && <div className="row between"><span className="muted">{t('Tasas de santuarios y parques marinos')}</span><span>{php(fees)} · {t('incluidas en el pago')}</span></div>}
        <div className="row between"><span className="muted">{t('Con tu equipo / alquilando')}</span><span>{trip.gear_rental_php ? <>{php(unit + fees)} / {php(unit + fees + trip.gear_rental_php)}</> : t('Equipo incluido o no disponible')}</span></div>
        <div className="row between"><span className="muted">{t('Plazas libres')}</span><b>{trip.available_seats}</b></div>
      </div>

      <SeaCard tripId={trip.id} />
      {trip.center_destination && <details className="fold"><summary><h2 style={{ display: 'inline' }}>{t('Avistamientos en {destino}', { destino: trip.center_destination })}</h2></summary><Sightings area={trip.center_destination} title={false} allowAdd={false} /></details>}

      {trip.sites?.length > 0 && (() => {
        // Regla de 0 a 40 m, o hasta el máximo de la salida redondeado a 10 si algún punto pasa de 40 m
        const deepest = Math.max(0, ...siteInfo.map((x) => x.max_depth_m || 0))
        const scale = deepest > 40 ? Math.ceil(deepest / 10) * 10 : 40
        return (
          <details className="card fold" open>
            <summary className="over" style={{ marginBottom: 12 }}>{t('Puntos de esta salida')} · {trip.sites.length}</summary>
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
          </details>
        )
      })()}

      <div className="card">
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <Link to={'/c/' + trip.center_id}><b>{trip.center_name}</b></Link> <Flags codes={center?.languages} /> <GreenFinsBadge level={center?.green_fins} verified={center?.green_fins_verified} small />
            <div className="small muted"><Icon icon={MapPin} size={14} /> {[center?.locality, center?.destination || trip.center_destination, center?.province || trip.center_province].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}
              {(center?.destination || trip.center_destination) && <> · <Link to={'/d/' + encodeURIComponent(center?.destination || trip.center_destination)}>{t('Guía del destino')}</Link></>}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {center?.phone && <a className="btn small ghost" href={'https://wa.me/' + center.phone.replace(/\D/g, '')} target="_blank" rel="noreferrer">WhatsApp</a>}
            <a className="btn small ghost" href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(trip.center_name + ' ' + (center?.destination || trip.center_destination || ''))} target="_blank" rel="noreferrer">{t('Mapa')}</a>
            <button type="button" className="btn small ghost" onClick={share}>{t('Compartir')}</button>
            {session && !isCenter && <FollowButton type="center" id={trip.center_id} />}
          </div>
        </div>
        {shared && <div className="msg ok" role="status">{shared}</div>}
        {trip.center_reviews > 0 && <details className="fold" style={{ marginTop: 10 }}><summary className="small"><b>{t('Reseñas del centro')}</b> · {trip.center_rating} ★ ({trip.center_reviews})</summary><div style={{ marginTop: 8 }}><CenterReviews centerId={trip.center_id} /></div></details>}
      </div>

      {(mine || isCenter) && session && <TripChat tripId={trip.id} open={openChat} />}

      <QuienVa tripId={trip.id} loggedIn={!!session} />

      {ctaVisible && trip.available_seats > 0 && !isCenter && !booked && (
        <div className="sticky-cta">
          <span><span className="small muted">{t('Total')}</span> <b>{php(total)}</b> <span className="small muted">· {seats > 1 ? t('{n} plazas', { n: seats }) : t('{n} plaza', { n: 1 })}</span></span>
          <button type="button" className="btn small" onClick={() => document.getElementById('reservar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t('Reservar')}</button>
        </div>
      )}
      <h2 id="reservar" style={{ scrollMarginTop: 12 }}>{t('Reservar')}</h2>
      {booked ? (
        <PagarAhora b={booked} trip={trip} seats={seats} gear={gear} mode={mode} onPaid={(id) => go('/reservas?pagado=' + id)} />
      ) : isCenter ? (
        <div className="card muted">{t('Estás con una cuenta de centro. Para reservar, usa una cuenta de buceador.')}</div>
      ) : trip.available_seats < 1 ? (
        <Espera trip={trip} diver={diver} session={session} wait={wait} setWait={setWait} medical={medical} levelOk={levelOk} refresh={refresh} />
      ) : (
        <div className="card book-steps">
          <Step n={1} title={t('Tu salida')}>
            {pack?.packs?.length > 0 && (
              <div className="msg ok small" role="status" style={{ marginTop: 0 }}>
                {pack.packs.map((p) => <div key={p.id}><b>{p.name}</b>: {t('con {n} salidas en {d} días, −{pct} % a partir de la {n}.ª', { n: p.trips, d: p.valid_days, pct: p.discount_pct })}{pack.booked_here + 1 >= p.trips ? ' · ' + t('aplicado a esta salida') : pack.booked_here > 0 ? ' · ' + t('llevas {n}', { n: pack.booked_here }) : ''}</div>)}
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
            {extras.length > 0 && (
              <fieldset className="field extras-pick">
                <legend>{t('Extras del centro')}</legend>
                {extras.map((e) => (
                  <label key={e.id} className="check">
                    <input type="checkbox" checked={chosen.includes(e.id)} onChange={() => setChosen((c) => (c.includes(e.id) ? c.filter((x) => x !== e.id) : [...c, e.id]))} />
                    <span><b>{e.name}</b> · {php(e.price_php)}{e.per_seat ? ' ' + t('por persona') : ''} <span className="muted small">({extraKind(e.kind)})</span>{e.description && <><br /><span className="small muted">{e.description}</span></>}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {session && gear && !hasSizes && (
              <p className="small muted" style={{ marginTop: -4 }}>{t('Añade tus tallas en el perfil para que el centro te prepare el equipo.')} <Link to="/perfil?ver=buceo" onClick={() => toProfile('/salida/' + trip.id)}>{t('Ir al perfil')}</Link></p>
            )}
          </Step>

          {session && (
            <Step n={2} title={t('Tus datos para el centro')}>
              <ProfileData trip={trip} diver={diver} certs={certs} need={need} course={course} levelOk={levelOk} medical={medical} medicalReq={medicalReq} sinceDive={sinceDive} />
              {diver && <DanCard diver={diver} compact />}
            </Step>
          )}

          <Step n={session ? 3 : 2} title={t('Pago')} last>
            {(fees > 0 || extrasAmt > 0 || unit < trip.price_php || gear) && (
              <div className="small muted stack" style={{ gap: 2 }}>
                <div className="row between"><span>{t('Salida')} × {seats}</span><span>{php(seats * unit)}</span></div>
                {gear && <div className="row between"><span>{t('Alquiler de equipo')} × {seats}</span><span>{php(seats * trip.gear_rental_php)}</span></div>}
                {fees > 0 && <div className="row between"><span>{t('Tasas de santuarios y parques marinos')} × {seats}</span><span>{php(seats * fees)}</span></div>}
                {extrasAmt > 0 && <div className="row between"><span>{t('Extras')}</span><span>{php(extrasAmt)}</span></div>}
                {unit < trip.price_php && <div className="row between"><span>{t('Descuento de última hora')}</span><span>−{php(seats * (trip.price_php - unit))}</span></div>}
              </div>
            )}
            <div className="row between" style={{ margin: '12px 0 4px' }}><span>{t('Total')}</span><span className="big">{php(total)}</span></div>
            <div className="row between small" style={{ marginBottom: 8 }}>
              <span className="muted">{t('Para reservar pagas como mínimo el 50 %')}</span><b>{php(Math.ceil(total / 2))}</b>
            </div>
            <details className="small how-pay">
              <summary>{t('¿Cómo funciona el pago?')}</summary>
              <ul>
                <li>{t('Ahora pagas la señal (50 %) con GCash o tarjeta. Tu plaza queda guardada 15 minutos mientras pagas.')}</li>
                <li>{t('El resto lo pagas en la app o en efectivo en el centro el día de la salida. Te mandamos el enlace de pago 24 h antes.')}</li>
                <li>{t('Si cancelas con 24 h o más, te devolvemos todo. Si el centro cancela por el mar, también.')}</li>
              </ul>
            </details>
            {error && <div className="msg err" role="alert">{error}</div>}
            {!session ? (
              <>
                <button type="button" className="btn block" onClick={loginToBook}>{t('Entrar y reservar')}</button>
                <p className="small muted" style={{ margin: '6px 0 0' }}>{t('Necesitas una cuenta para reservar. Al entrar vuelves aquí con lo que has elegido.')}</p>
              </>
            ) : (
              <>
                <button className="btn block" disabled={busy || !medical || !levelOk} onClick={book} aria-describedby="book-hint">
                  {busy ? t('Reservando…') : t('Continuar al pago')}
                </button>
                {(!levelOk || !medical) && <p id="book-hint" className="small muted" style={{ marginTop: 6 }}>{t('Completa en tu perfil lo que falta en el paso 2 para continuar.')}</p>}
              </>
            )}
          </Step>
        </div>
      )}
    </>
  )
}

// Paso numerado del formulario de reserva
function Step({ n, title, last, children }) {
  return (
    <section className={'book-step' + (last ? ' last' : '')} aria-label={title}>
      <h3 className="row" style={{ gap: 8 }}><span className="step-n" aria-hidden>{n}</span>{title}</h3>
      {children}
    </section>
  )
}

// Plaza retenida: se paga aquí mismo (señal o total). Se pueden sumar más días con el mismo centro y pagarlo todo junto.
function PagarAhora({ b, trip, seats, gear, mode, onPaid }) {
  const [list, setList] = useState([b])
  const [more, setMore] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 15000); return () => clearInterval(i) }, [])
  useEffect(() => {
    const from = new Date().toISOString(), to = new Date(Date.now() + 8 * 864e5).toISOString()
    supabase.from('published_trips').select('id, departs_at, price_php, last_minute_pct, early_pct, available_seats, num_dives, kind')
      .eq('center_id', trip.center_id).gte('departs_at', from).lt('departs_at', to).order('departs_at')
      .then(({ data }) => setMore((data || []).filter((x) => x.id !== trip.id && x.available_seats >= seats && x.kind !== 'course').slice(0, 8)))
  }, [trip.id, trip.center_id, seats])
  const mins = Math.min(...list.map((x) => Math.ceil((holdEnd(x) - Date.now()) / 60000)))
  if (mins <= 0) return (
    <div className="card">
      <div className="msg warn" role="status" style={{ marginTop: 0 }}>{t('Se acabó el tiempo para pagar y la plaza se ha liberado.')}</div>
      <Link to="/reservas" className="btn block ghost">{t('Ver mis reservas')}</Link>
    </div>
  )
  async function add(x) {
    setBusy(x.id); setErr('')
    const { data, error } = await supabase.rpc('book_trip', { p_trip: x.id, p_seats: seats, p_with_gear: gear, p_medical_signed: true, p_ref: viaFor(trip.center_id) })
    setBusy('')
    if (error) return setErr(errMsg(error))
    setList([...list, data]); setMore(more.filter((y) => y.id !== x.id))
  }
  const dep = list.reduce((n, x) => n + x.deposit_php, 0)
  return (
    <div className="card">
      <b className="row" style={{ gap: 6 }}><Icon icon={Check} className="ok-ink" /> {list.length > 1 ? t('{n} salidas retenidas {m} min', { n: list.length, m: mins }) : t('Plaza retenida {n} min', { n: mins })}</b>
      <p className="small muted" style={{ margin: '4px 0 0' }}>{t('Paga al menos la señal del 50 % ({amount}) para confirmarla.', { amount: php(dep) })}</p>
      {more?.length > 0 && (
        <details className="fold add-days" style={{ marginTop: 10 }}>
          <summary className="small"><b><Icon icon={Plus} size={14} /> {t('¿Buceas más días? Añade otra salida de este centro')}</b></summary>
          <div className="stack" style={{ marginTop: 8, gap: 6 }}>
            {more.map((x) => (
              <div key={x.id} className="row between small" style={{ gap: 8 }}>
                <span><b>{dayLabel(manilaDate(new Date(x.departs_at)), { weekday: 'short', day: 'numeric' })} · {time(x.departs_at)}</b> · {t('{n} inmersiones', { n: x.num_dives })} · {php(Math.floor(x.price_php * (100 - Math.max(x.last_minute_pct || 0, x.early_pct || 0)) / 100))}</span>
                <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => add(x)}>{busy === x.id ? t('Un momento…') : t('Añadir')}</button>
              </div>
            ))}
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>{t('Todas en un solo pago. Si el centro tiene bono, el descuento se aplica solo.')}</p>
        </details>
      )}
      {list.length > 1 && <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{list.map((x) => <li key={x.id}>{php(x.amount_php)}{x.discount_php > 0 ? ' · ' + t('ahorras {amount}', { amount: php(x.discount_php) }) : ''}</li>)}</ul>}
      {err && <div className="msg err" role="alert">{err}</div>}
      <PayBox bs={list} mode={mode} onDone={(m, paidId) => onPaid(paidId || b.id)} />
      <p className="small muted" style={{ margin: '8px 0 0' }}>{t('También puedes pagarla más tarde en')} <Link to="/reservas">{t('Reservas')}</Link>.</p>
    </div>
  )
}

// Salida completa: lista de espera (como Playtomic). Al quedar plaza se reserva sola 30 min para el primero y se le avisa.
function Espera({ trip, diver, session, wait, setWait, medical, levelOk, refresh }) {
  const [seats, setSeats] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!session) return <div className="card"><p style={{ marginTop: 0 }}>{t('Salida completa.')} {t('Entra para apuntarte a la lista de espera.')}</p><Link to="/login" className="btn small" onClick={() => { try { sessionStorage.setItem('afterLogin', '/salida/' + trip.id) } catch (e) { /* sin almacenamiento */ } }}>{t('Entrar')}</Link></div>
  if (wait) return (
    <div className="card">
      <b className="row" style={{ gap: 6 }}><Icon icon={Clock} size={18} /> {wait.status === 'offered' ? t('Tienes una plaza retenida: págala en Reservas') : t('Estás en la lista de espera (puesto {n})', { n: wait.position })}</b>
      <p className="small muted">{t('Si alguien cancela, la plaza se reserva sola para ti 30 minutos y te avisamos por email y en el móvil.')}</p>
      {wait.status === 'offered' ? <Link to="/reservas" className="btn block">{t('Pagar ahora')}</Link>
        : <button type="button" className="btn small ghost" onClick={async () => { await supabase.rpc('leave_waitlist', { p_trip: trip.id }); setWait(null) }}>{t('Salir de la lista')}</button>}
    </div>
  )
  return (
    <div className="card">
      <p style={{ marginTop: 0 }}><b>{t('Salida completa.')}</b> {trip.waitlist > 0 ? t('{n} personas en la lista de espera.', { n: trip.waitlist }) : t('Nadie en la lista de espera todavía.')}</p>
      <p className="small muted">{t('Si alguien cancela, la plaza se reserva sola para ti 30 minutos y te avisamos por email y en el móvil.')}</p>
      {!levelOk && <div className="msg warn" role="status">{t('Esta salida requiere {nivel}.', { nivel: levelName(trip.kind === 'course' ? trip.course_prereq : trip.min_level) })}</div>}
      {diver && !medical && <div className="msg warn" role="status">{t('Falta el cuestionario médico')} · <Link to="/perfil?ver=buceo" onClick={() => toProfile('/salida/' + trip.id)}>{t('Completar en el perfil')}</Link></div>}
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}><label htmlFor="w-seats">{t('Plazas')}</label>
          <select id="w-seats" value={seats} onChange={(e) => setSeats(+e.target.value)} style={{ width: 'auto' }}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></div>
        <button type="button" className="btn grow" disabled={busy || !medical || !levelOk} onClick={async () => {
          setBusy(true); setErr('')
          const { data, error } = await supabase.rpc('join_waitlist', { p_trip: trip.id, p_seats: seats, p_medical_signed: medical })
          setBusy(false)
          if (error) return setErr(errMsg(error))
          setWait({ status: 'waiting', position: data.position })
        }}>{t('Apuntarme a la lista de espera')}</button>
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
    </div>
  )
}

// Paso 2 de la reserva: lo que el centro recibe con la reserva. Se rellena en el Perfil (certificación, cuestionario médico,
// tallas, seguro, alergias); aquí solo se muestra y, si falta algo obligatorio, se enlaza al Perfil para completarlo.
function PdRow({ ok, warn, label, children }) {
  return (
    <li className="pd-row">
      <Icon icon={ok ? Check : TriangleAlert} size={16} className={ok ? 'ok-ink' : warn ? 'warn-ink' : 'muted'} />
      <span><b>{label}</b><br /><span className="small">{children}</span></span>
    </li>
  )
}

function ProfileData({ trip, diver, certs, need, course, levelOk, medical, medicalReq, sinceDive }) {
  if (!diver) return null
  const fix = <Link to="/perfil?ver=buceo" onClick={() => toProfile('/salida/' + trip.id)}>{t('Completar en el perfil')}</Link>
  const best = certs.reduce((m, c) => (!m || levelRank(c.level) > levelRank(m.level) ? c : m), null)
  const until = medicalUntil(diver)
  const day = (d) => dayLabel(d, { day: 'numeric', month: 'short', year: 'numeric' })
  const sizes = [diver.wetsuit_size && t('Traje') + ' ' + diver.wetsuit_size, diver.bcd_size && t('Chaleco') + ' ' + diver.bcd_size, diver.fin_size && t('Aletas') + ' ' + diver.fin_size].filter(Boolean).join(' · ')
  const ins = hasInsurance(diver)
  return (
    <>
      <p className="small muted" style={{ margin: '0 0 8px' }}>{t('Se envía al centro con tu reserva. Se cambia en tu perfil.')}</p>
      <ul className="pd-list">
        <PdRow ok={levelOk} warn label={t('Certificación')}>
          {noCert(trip) ? t('No hace falta para esta actividad') : best ? (best.agency ? best.agency + ' ' : '') + levelName(best.level) : (course && !need ? t('Este curso no pide certificación previa') : t('Sin certificación'))}
          {!levelOk && <>{' · '}{best && need ? t('Esta salida requiere {nivel}.', { nivel: levelName(need) }) + ' ' : ''}{fix}</>}
        </PdRow>
        <PdRow ok={medical} warn label={t('Cuestionario médico')}>
          {!medicalReq ? t('No hace falta para el esnórquel') : medical ? <>{medicalLabel(diver)} · {t('hasta el {fecha}', { fecha: day(until) })}</>
            : <>{until ? t('Tu cuestionario médico caducó') : t('Falta el cuestionario médico')} · {fix}</>}
        </PdRow>
        <PdRow ok={sinceDive != null && sinceDive <= 365} label={t('Última inmersión')}>
          {sinceDive == null ? <>{t('Sin indicar')} · {fix}</> : sinceDive > 365 ? t('Tu última inmersión fue hace más de 12 meses: el centro puede pedirte un repaso antes de salir.') : day(diver.last_dive_date)}
        </PdRow>
        <PdRow ok={!!sizes} label={t('Tallas de equipo')}>{sizes || <>{t('Sin indicar')} · {fix}</>}{diver.nitrox ? ' · Nitrox' : ''}</PdRow>
        <PdRow ok={ins} label={t('Seguro de buceo')}>{ins ? diver.insurance_provider + (diver.insurance_expiry ? ' · ' + t('hasta el {fecha}', { fecha: day(diver.insurance_expiry) }) : '') : <>{t('Sin indicar')} · {fix}</>}</PdRow>
        {diver.allergies && <PdRow ok label={t('Alergias')}>{diver.allergies}</PdRow>}
      </ul>
    </>
  )
}
