import { useEffect, useState } from 'react'
import { useAuth } from './lib/auth'
import { useRoute, Link, go } from './lib/router'
import { t, LangSwitch } from './lib/i18n'
import Explorar from './pages/Explorar'
import Salida from './pages/Salida'
import Reservas from './pages/Reservas'
import Perfil from './pages/Perfil'
import Login from './pages/Login'
import NuevaSalida from './pages/NuevaSalida'
import Centros from './pages/Centros'
import NuevaClave from './pages/NuevaClave'
import Bitacora from './pages/Bitacora'
import Inmersion from './pages/Inmersion'
import CentroPanel from './pages/CentroPanel'
import CentroAgenda from './pages/CentroAgenda'
import CentroSalidas from './pages/CentroSalidas'
import CentroInformes from './pages/CentroInformes'
import CentroAjustes from './pages/CentroAjustes'
import RegistrarCentro from './pages/RegistrarCentro'
import CentroInfo from './pages/CentroInfo'
import Destino from './pages/Destino'
import CentroVerificacion from './pages/CentroVerificacion'
import Admin from './pages/Admin'
import ErrorBoundary from './lib/ErrorBoundary'

function NeedLogin({ children }) {
  const { session } = useAuth()
  if (session === undefined) return <p className="muted center">{t('Cargando…')}</p>
  if (!session) return <Login />
  return children
}

// Tras iniciar sesión vuelve a donde estaba el usuario (p. ej. la salida que quería reservar)
function AfterLogin() {
  useEffect(() => {
    let to = '/perfil'
    try { to = sessionStorage.getItem('afterLogin') || to; sessionStorage.removeItem('afterLogin') } catch (e) { /* sin almacenamiento */ }
    go(to)
  }, [])
  return <p className="muted center">{t('Cargando…')}</p>
}

// Páginas del centro: hace falta sesión y tener el centro dado de alta
function NeedCenter({ children }) {
  const { session, center, diver } = useAuth()
  if (session === undefined || (session && !diver)) return <p className="muted center">{t('Cargando…')}</p>
  if (!session) return <Login />
  if (!center) return <RegistrarCentro />
  return <><VerifyBanner />{children}</>
}

// Aviso permanente mientras el centro no está verificado por la plataforma
function VerifyBanner() {
  const { center } = useAuth()
  const path = useRoute()
  const st = center?.verification_status
  if (!st || st === 'verified' || path.startsWith('/centro/verificacion')) return null
  const text = {
    unverified: t('Tu centro aún no es visible: completa la verificación para publicar salidas.'),
    pending: t('Verificación en revisión. Puedes preparar salidas como borrador; se publicarán cuando te validemos.'),
    rejected: t('Tu verificación fue rechazada. Revisa el motivo y vuelve a enviarla.'),
    suspended: t('Tu centro está suspendido y no es visible para los buceadores.'),
  }[st]
  return (
    <div className={st === 'rejected' || st === 'suspended' ? 'banner bad' : 'banner'} role="status">
      <span>{text}</span>
      <Link to="/centro/verificacion" className="btn small">{st === 'pending' ? t('Ver estado') : t('Verificar centro')}</Link>
    </div>
  )
}

// Aviso de una sola vez guardado antes de cambiar de pantalla (p. ej. tras eliminar la cuenta)
function Flash() {
  const [text, setText] = useState(() => {
    try { const v = sessionStorage.getItem('flash'); sessionStorage.removeItem('flash'); return v } catch (e) { return null }
  })
  useEffect(() => { if (text) { const id = setTimeout(() => setText(null), 6000); return () => clearTimeout(id) } }, [text])
  if (!text) return null
  return <div className="toast" role="status"><span>{text}</span> <button type="button" onClick={() => setText(null)}>{t('Cerrar')}</button></div>
}

// Icono de buceador para la pestaña de salidas
function DiverIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', margin: '0 auto' }}>
      <circle cx="21" cy="6.5" r="1" fill="#7cc4f2" />
      <circle cx="19.6" cy="3.6" r="0.7" fill="#7cc4f2" />
      <rect x="8.2" y="8.2" width="7.4" height="3" rx="1.5" fill="#f4b400" />
      <path d="M5 12.6 L16.2 11.6" stroke="#1f6fb2" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M6.2 12.2 L2.4 9.6 M6.2 13.2 L2.4 15.6" stroke="#1f6fb2" strokeWidth="2" strokeLinecap="round" />
      <path d="M2.8 9.8 L0.8 7.6 M2.8 15.4 L0.8 17.6" stroke="#f4b400" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M15 12.6 L18.6 15.8" stroke="#1f6fb2" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18.7" cy="11.2" r="2.6" fill="#1f6fb2" />
      <rect x="19.2" y="9.9" width="2.9" height="1.9" rx="0.8" fill="#bfe6ff" stroke="#0d3b66" strokeWidth="0.5" />
    </svg>
  )
}

function Flag() {
  return (
    <svg width="27" height="18" viewBox="0 0 30 20" aria-hidden="true" style={{ borderRadius: 2 }}>
      <rect width="30" height="20" fill="#d62828" />
      <polygon points="0,0 6,0 30,16 30,20 24,20 0,4" fill="#fff" />
    </svg>
  )
}

export default function App() {
  const path = useRoute()
  const { session, isCenter, isAdmin, pendingCenters, recovering, signOut } = useAuth()
  const seg = path.split('/').filter(Boolean)

  let page
  if (recovering) page = <NuevaClave />
  else if (seg[0] === 'salida' && seg[1]) page = <Salida id={seg[1]} />
  else if (seg[0] === 'reservas') page = <NeedLogin><Reservas /></NeedLogin>
  else if (seg[0] === 'bitacora' && seg[1]) page = <NeedLogin><Inmersion id={seg[1]} /></NeedLogin>
  else if (seg[0] === 'bitacora') page = <NeedLogin><Bitacora /></NeedLogin>
  else if (seg[0] === 'perfil') page = <NeedLogin><Perfil /></NeedLogin>
  else if (seg[0] === 'login') page = session ? <AfterLogin /> : <Login />
  else if (seg[0] === 'centro' && seg[1] === 'nueva') page = <NeedCenter><NuevaSalida /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'salida' && seg[2]) page = <NeedCenter><NuevaSalida id={seg[2]} /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'agenda') page = <NeedCenter><CentroAgenda /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'salidas') page = <NeedCenter><CentroSalidas /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'informes') page = <NeedCenter><CentroInformes /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'verificacion') page = <NeedCenter><CentroVerificacion /></NeedCenter>
  else if (seg[0] === 'admin') page = <NeedLogin><Admin /></NeedLogin>
  else if (seg[0] === 'centro' && seg[1] === 'ajustes') page = <NeedCenter><CentroAjustes /></NeedCenter>
  else if (seg[0] === 'centro') page = <NeedCenter><CentroPanel /></NeedCenter>
  else if (seg[0] === 'centros') page = <Centros />
  else if (seg[0] === 'c' && seg[1]) page = <CentroInfo id={seg[1]} />
  else if (seg[0] === 'd' && seg[1]) page = <Destino name={decodeURIComponent(seg[1])} />
  else page = session && isCenter ? <NeedCenter><CentroPanel /></NeedCenter> : <Explorar />

  const tab = (to, icon, label, match) => (
    <Link to={to} className={match ? 'tab on' : 'tab'} aria-current={match ? 'page' : undefined}>
      <span aria-hidden>{icon}</span>{t(label)}
    </Link>
  )
  const home = !seg[0]

  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Flag />
          DiveSlot
          {session && isCenter && <span className="pill" style={{ fontSize: 11 }}>{t('Centro')}</span>}
        </Link>
        <div className="row" style={{ gap: 8 }}>
          {isAdmin && <Link to="/admin" className="btn small ghost" title={t('Validación de centros')} aria-label={t('Validación de centros')}>🛡️{pendingCenters > 0 && <span className="badge">{pendingCenters}</span>}</Link>}
          <LangSwitch />
          {session === null && <Link to="/login" className="btn small ghost">{t('Entrar')}</Link>}
          {session && (
            <button type="button" className="btn small ghost" onClick={async () => { await signOut(); go('/') }}>{t('Salir')}</button>
          )}
        </div>
      </header>
      <main><ErrorBoundary resetKey={path}>{page}</ErrorBoundary></main>
      <Flash key={session ? 'in' : 'out'} />
      <nav className="tabs" aria-label={t('Navegación principal')}>
        {session && isCenter ? (
          <>
            {tab('/centro', '📊', 'Panel', home || (seg[0] === 'centro' && !seg[1]))}
            {tab('/centro/agenda', '📅', 'Agenda', seg[1] === 'agenda')}
            {tab('/centro/salidas', <DiverIcon />, 'Salidas', ['salidas', 'nueva', 'salida'].includes(seg[1]))}
            {tab('/centro/informes', '📈', 'Informes', seg[1] === 'informes')}
            {tab('/centro/ajustes', '⚙️', 'Centro', seg[1] === 'ajustes')}
            {tab('/perfil', '👤', 'Perfil', seg[0] === 'perfil')}
          </>
        ) : (
          <>
            {tab('/', <DiverIcon />, 'Salidas', home || seg[0] === 'salida')}
            {tab('/centros', '📍', 'Centros', seg[0] === 'centros' || seg[0] === 'c' || seg[0] === 'd')}
            {tab('/reservas', '🎟️', 'Reservas', seg[0] === 'reservas')}
            {tab('/bitacora', '📖', 'Bitácora', seg[0] === 'bitacora')}
            {tab('/perfil', '👤', 'Perfil', seg[0] === 'perfil' || seg[0] === 'login')}
          </>
        )}
      </nav>
    </div>
  )
}
