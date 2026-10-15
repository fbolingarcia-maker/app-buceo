import { useAuth } from './lib/auth'
import { useRoute, Link } from './lib/router'
import Explorar from './pages/Explorar'
import Salida from './pages/Salida'
import Reservas from './pages/Reservas'
import Perfil from './pages/Perfil'
import Login from './pages/Login'
import Centro from './pages/Centro'
import NuevaSalida from './pages/NuevaSalida'
import Centros from './pages/Centros'
import NuevaClave from './pages/NuevaClave'

function NeedLogin({ children }) {
  const { session } = useAuth()
  if (session === undefined) return <p className="muted center">Cargando…</p>
  if (!session) return <Login />
  return children
}

export default function App() {
  const path = useRoute()
  const { session, center, recovering } = useAuth()
  const seg = path.split('/').filter(Boolean)

  let page
  if (recovering) page = <NuevaClave />
  else if (seg[0] === 'salida' && seg[1]) page = <Salida id={seg[1]} />
  else if (seg[0] === 'reservas') page = <NeedLogin><Reservas /></NeedLogin>
  else if (seg[0] === 'perfil') page = <NeedLogin><Perfil /></NeedLogin>
  else if (seg[0] === 'login') page = session ? <Perfil /> : <Login />
  else if (seg[0] === 'centro' && seg[1] === 'nueva') page = <NeedLogin><NuevaSalida /></NeedLogin>
  else if (seg[0] === 'centro') page = <NeedLogin><Centro /></NeedLogin>
  else if (seg[0] === 'centros') page = <Centros />
  else page = <Explorar />

  const tab = (to, icon, label, match) => (
    <Link to={to} className={match ? 'tab on' : 'tab'}>
      <span aria-hidden>{icon}</span>{label}
    </Link>
  )

  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand">🤿 Buceo Panglao</Link>
        {!session && session !== undefined && <Link to="/login" className="btn small ghost">Entrar</Link>}
      </header>
      <main>{page}</main>
      <nav className="tabs">
        {tab('/', '🌊', 'Salidas', !seg[0] || seg[0] === 'salida')}
        {tab('/centros', '📍', 'Centros', seg[0] === 'centros')}
        {tab('/reservas', '🎟️', 'Reservas', seg[0] === 'reservas')}
        {center && tab('/centro', '⚓', 'Mi centro', seg[0] === 'centro')}
        {tab('/perfil', '👤', 'Perfil', seg[0] === 'perfil' || seg[0] === 'login')}
      </nav>
    </div>
  )
}
