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
import CentroAjustes from './pages/CentroAjustes'
import RegistrarCentro from './pages/RegistrarCentro'

function NeedLogin({ children }) {
  const { session } = useAuth()
  if (session === undefined) return <p className="muted center">{t('Cargando…')}</p>
  if (!session) return <Login />
  return children
}

// Páginas del centro: hace falta sesión y tener el centro dado de alta
function NeedCenter({ children }) {
  const { session, center, diver } = useAuth()
  if (session === undefined || (session && !diver)) return <p className="muted center">{t('Cargando…')}</p>
  if (!session) return <Login />
  if (!center) return <RegistrarCentro />
  return children
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
  const { session, isCenter, recovering, signOut } = useAuth()
  const seg = path.split('/').filter(Boolean)

  let page
  if (recovering) page = <NuevaClave />
  else if (seg[0] === 'salida' && seg[1]) page = <Salida id={seg[1]} />
  else if (seg[0] === 'reservas') page = <NeedLogin><Reservas /></NeedLogin>
  else if (seg[0] === 'bitacora' && seg[1]) page = <NeedLogin><Inmersion id={seg[1]} /></NeedLogin>
  else if (seg[0] === 'bitacora') page = <NeedLogin><Bitacora /></NeedLogin>
  else if (seg[0] === 'perfil') page = <NeedLogin><Perfil /></NeedLogin>
  else if (seg[0] === 'login') page = session ? <Perfil /> : <Login />
  else if (seg[0] === 'centro' && seg[1] === 'nueva') page = <NeedCenter><NuevaSalida /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'salida' && seg[2]) page = <NeedCenter><NuevaSalida id={seg[2]} /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'agenda') page = <NeedCenter><CentroAgenda /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'salidas') page = <NeedCenter><CentroSalidas /></NeedCenter>
  else if (seg[0] === 'centro' && seg[1] === 'ajustes') page = <NeedCenter><CentroAjustes /></NeedCenter>
  else if (seg[0] === 'centro') page = <NeedCenter><CentroPanel /></NeedCenter>
  else if (seg[0] === 'centros') page = <Centros />
  else page = session && isCenter ? <NeedCenter><CentroPanel /></NeedCenter> : <Explorar />

  const tab = (to, icon, label, match) => (
    <Link to={to} className={match ? 'tab on' : 'tab'}>
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
          <LangSwitch />
          {session === null && <Link to="/login" className="btn small ghost">{t('Entrar')}</Link>}
          {session && (
            <button type="button" className="btn small ghost" onClick={async () => { await signOut(); go('/') }}>{t('Salir')}</button>
          )}
        </div>
      </header>
      <main>{page}</main>
      <nav className="tabs">
        {session && isCenter ? (
          <>
            {tab('/centro', '📊', 'Panel', home || (seg[0] === 'centro' && !seg[1]))}
            {tab('/centro/agenda', '📅', 'Agenda', seg[1] === 'agenda')}
            {tab('/centro/salidas', '⛵', 'Salidas', ['salidas', 'nueva', 'salida'].includes(seg[1]))}
            {tab('/centro/ajustes', '⚙️', 'Centro', seg[1] === 'ajustes')}
            {tab('/perfil', '👤', 'Perfil', seg[0] === 'perfil')}
          </>
        ) : (
          <>
            {tab('/', '🌊', 'Salidas', home || seg[0] === 'salida')}
            {tab('/centros', '📍', 'Centros', seg[0] === 'centros')}
            {tab('/reservas', '🎟️', 'Reservas', seg[0] === 'reservas')}
            {tab('/bitacora', '📖', 'Bitácora', seg[0] === 'bitacora')}
            {tab('/perfil', '👤', 'Perfil', seg[0] === 'perfil' || seg[0] === 'login')}
          </>
        )}
      </nav>
    </div>
  )
}
