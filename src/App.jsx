import { useEffect, useState } from 'react'
import { useAuth } from './lib/auth'
import { trackView } from './lib/track'
import { useRoute, Link, go } from './lib/router'
import { t } from './lib/i18n'
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
import Puntos from './pages/Puntos'
import CentroVerificacion from './pages/CentroVerificacion'
import Admin from './pages/Admin'
import { DosPasosReto } from './pages/DosPasos'
import AdminBar, { AdminCenterPicker } from './lib/AdminBar'
import ErrorBoundary from './lib/ErrorBoundary'
import Icon from './lib/Icon'
import { Compass, MapPin, Ticket, BookOpen, User, ShieldCheck, Eye, LayoutDashboard, CalendarDays, Ship, ChartLine, Settings, Users, UserCog, ScrollText } from 'lucide-react'

// Pantallas privadas. Sin sesión: título y frase de lo que hay detrás, y el login debajo.
// back: ruta a la que volver después de entrar (también la usa el email de confirmación)
function NeedLogin({ children, title, intro, back }) {
  const { session } = useAuth()
  useEffect(() => {
    if (session === null && back) { try { sessionStorage.setItem('afterLogin', back) } catch (e) { /* sin almacenamiento */ } }
  }, [session, back])
  if (session === undefined) return <p className="muted center">{t('Cargando…')}</p>
  if (!session) {
    if (!title) return <Login />
    return <><h1>{title}</h1><p className="muted">{intro}</p><Login embedded /></>
  }
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
  const { session, center, diver, isAdmin, readOnly } = useAuth()
  if (session === undefined || (session && !diver)) return <p className="muted center">{t('Cargando…')}</p>
  if (!session) return <Login />
  if (!center) return isAdmin ? <AdminCenterPicker /> : <RegistrarCentro />
  return <>{readOnly && <ReadOnlyBanner />}<VerifyBanner />{children}</>
}

// El administrador mira un centro ajeno: puede verlo todo, pero no cambiar nada
function ReadOnlyBanner() {
  const { center, setViewCenterId } = useAuth()
  return (
    <div className="banner admin" role="status">
      <span><Icon icon={Eye} /> {t('Vista de administrador de {centro}: solo lectura.', { centro: center.name })}</span>
      <button type="button" className="btn small ghost" onClick={() => setViewCenterId('')}>{t('Cambiar')}</button>
    </div>
  )
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
  const { session, isCenter, isAdmin, adminView, pendingCenters, recovering, needsMfa, signOut } = useAuth()
  const seg = path.split('/').filter(Boolean)
  useEffect(() => { trackView(path) }, [path])

  let page
  if (session && needsMfa) page = <DosPasosReto />
  else if (recovering) page = <NuevaClave />
  else if (seg[0] === 'salida' && seg[1]) page = <Salida id={seg[1]} />
  else if (seg[0] === 'reservas') page = <NeedLogin title={t('Reservas')} intro={t('Aquí verás tus salidas reservadas y los pagos pendientes. Entra o crea una cuenta para verlas.')} back="/reservas"><Reservas /></NeedLogin>
  else if (seg[0] === 'bitacora' && seg[1]) page = <NeedLogin><Inmersion id={seg[1]} /></NeedLogin>
  else if (seg[0] === 'bitacora') page = <NeedLogin title={t('Bitácora')} intro={t('Guarda cada inmersión con profundidad, tiempo, fauna y fotos. Entra o crea una cuenta para empezar.')} back="/bitacora"><Bitacora /></NeedLogin>
  else if (seg[0] === 'perfil') page = <NeedLogin><Perfil /></NeedLogin>
  else if (seg[0] === 'login') page = session ? <AfterLogin /> : <Login />
  else if (seg[0] === 'centro' && seg[1] === 'nueva') page = <NeedCenter><NuevaSalida /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'salida' && seg[2]) page = <NeedCenter><NuevaSalida id={seg[2]} /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'agenda') page = <NeedCenter><CentroAgenda /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'salidas') page = <NeedCenter><CentroSalidas /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'informes') page = <NeedCenter><CentroInformes /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'verificacion') page = <NeedCenter><CentroVerificacion /></NeedCenter>
  // El panel de administración no existe para nadie más: sin sesión de administrador se ve la portada normal
  else if (seg[0] === 'admin' && isAdmin) page = <Admin section={seg[1]} />
  else if (seg[0] === 'centro' && seg[1] === 'ajustes') page = <NeedCenter><CentroAjustes /></NeedCenter>
  else if (seg[0] === 'centro') page = <NeedCenter><CentroPanel /></NeedCenter>
  else if (seg[0] === 'centros') page = <Centros />
  else if (seg[0] === 'puntos') page = <Puntos />
  else if (seg[0] === 'c' && seg[1]) page = <CentroInfo id={seg[1]} />
  else if (seg[0] === 'd' && seg[1]) page = <Destino name={decodeURIComponent(seg[1])} />
  else if (session && adminView === 'admin') page = <Admin />
  else page = session && isCenter ? <NeedCenter><CentroPanel /></NeedCenter> : <Explorar />

  // icon: componente de Lucide; extra: algo que va junto al icono (p. ej. el contador de centros pendientes)
  const tab = (to, icon, label, match, extra) => (
    <Link to={to} className={match ? 'tab on' : 'tab'} aria-current={match ? 'page' : undefined}>
      <span><Icon icon={icon} size={22} />{extra}</span>{t(label)}
    </Link>
  )
  const home = !seg[0]

  return (
    <div className={isAdmin ? 'app is-admin' : 'app'}>
      <header className={isAdmin ? 'top admin' : 'top'}>
        <Link to="/" className="brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Flag />
          <span className="brand-name">Get your slot and dive</span>
          {isAdmin ? <span className="pill admin-pill" style={{ fontSize: 11 }}>{t('Admin')}</span>
            : session && isCenter && <span className="pill" style={{ fontSize: 11 }}>{t('Centro')}</span>}
        </Link>
        <div className="row" style={{ gap: 8 }}>
          {isAdmin && adminView !== 'admin' && <Link to="/admin" className="btn small ghost" title={t('Administración')} aria-label={t('Administración')}><Icon icon={ShieldCheck} />{pendingCenters > 0 && <span className="badge">{pendingCenters}</span>}</Link>}
          {session === null && <Link to="/login" className="btn small ghost">{t('Entrar')}</Link>}
          {session && (
            <button type="button" className="btn small ghost" onClick={async () => { await signOut(); go('/') }}>{t('Salir')}</button>
          )}
        </div>
      </header>
      {isAdmin && !needsMfa && <AdminBar />}
      <main><ErrorBoundary resetKey={path}>{page}</ErrorBoundary></main>
      <Flash key={session ? 'in' : 'out'} />
      <nav className="tabs" aria-label={t('Navegación principal')}>
        {session && adminView === 'admin' ? (
          <>
            {tab('/admin', LayoutDashboard, 'Resumen', home || (seg[0] === 'admin' && !seg[1]))}
            {tab('/admin/centers', ShieldCheck, 'Centros', seg[1] === 'centers', pendingCenters > 0 && <span className="badge">{pendingCenters}</span>)}
            {tab('/admin/users', Users, 'Usuarios', seg[1] === 'users')}
            {tab('/admin/admins', UserCog, 'Admins', seg[1] === 'admins')}
            {tab('/admin/log', ScrollText, 'Registro', seg[1] === 'log')}
            {tab('/perfil', Settings, 'Cuenta', seg[0] === 'perfil')}
          </>
        ) : session && isCenter ? (
          <>
            {tab('/centro', LayoutDashboard, 'Panel', home || (seg[0] === 'centro' && !seg[1]))}
            {tab('/centro/agenda', CalendarDays, 'Agenda', seg[1] === 'agenda')}
            {tab('/centro/salidas', Ship, 'Salidas', ['salidas', 'nueva', 'salida'].includes(seg[1]))}
            {tab('/centro/informes', ChartLine, 'Informes', seg[1] === 'informes')}
            {tab('/centro/ajustes', Settings, 'Centro', seg[1] === 'ajustes')}
            {tab('/perfil', User, 'Perfil', seg[0] === 'perfil')}
          </>
        ) : (
          <>
            {tab('/', Compass, 'Salidas', home || seg[0] === 'salida')}
            {tab('/centros', MapPin, 'Centros', seg[0] === 'centros' || seg[0] === 'puntos' || seg[0] === 'c' || seg[0] === 'd')}
            {tab('/reservas', Ticket, 'Reservas', seg[0] === 'reservas')}
            {tab('/bitacora', BookOpen, 'Bitácora', seg[0] === 'bitacora')}
            {tab('/perfil', User, 'Perfil', seg[0] === 'perfil' || seg[0] === 'login')}
          </>
        )}
      </nav>
    </div>
  )
}
