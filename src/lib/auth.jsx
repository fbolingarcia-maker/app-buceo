import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const AuthCtx = createContext(null)

// Columnas públicas de centers (gcash_number, review_note y notes solo con center_private())
export const CENTER_COLS = 'id, name, area, phone, default_divers_per_guide, created_at, locality, website, source_url, lat, lng, location_precision, listing_status, destination, province, languages, course_languages, verification_status, claims_center_id, verified_at, agencies, agency_detail, directory_check, checked_at'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = cargando
  const [diver, setDiver] = useState(null)
  const [center, setCenter] = useState(null) // centro que gestiona el usuario (o null)
  const [recovering, setRecovering] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false) // administrador de la plataforma (valida centros)
  const [pendingCenters, setPendingCenters] = useState(0) // centros esperando validación (solo admin)
  const [needsMfa, setNeedsMfa] = useState(false) // contraseña correcta, falta el código de dos pasos
  // Administrador: «Ver como» admin | diver | center (y qué centro mira, en solo lectura)
  const [viewAs, setViewAsState] = useState(() => { try { return localStorage.getItem('adminView') || 'admin' } catch (e) { return 'admin' } })
  const [viewCenterId, setViewCenterIdState] = useState(() => { try { return localStorage.getItem('adminCenter') || '' } catch (e) { return '' } })
  const [viewCenter, setViewCenter] = useState(null)

  const loadProfile = useCallback(async (s) => {
    if (!s) { setDiver(null); setCenter(null); setIsAdmin(false); setNeedsMfa(false); return }
    // Con el segundo paso activado, hasta que no se introduce el código la sesión no vale para nada (mfa_ok() en la base de datos)
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    const need = aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2'
    setNeedsMfa(need)
    if (need) { setDiver(null); setCenter(null); setIsAdmin(false); return }
    supabase.rpc('is_platform_admin').then(({ data }) => {
      setIsAdmin(data === true)
      if (data === true) supabase.from('centers').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending')
        .then(({ count }) => setPendingCenters(count || 0))
    })
    const [{ data: d }, { data: st }] = await Promise.all([
      supabase.from('divers').select('*').eq('user_id', s.user.id).maybeSingle(),
      supabase.from('center_staff').select('role, centers(' + CENTER_COLS + ')').eq('user_id', s.user.id).maybeSingle(),
    ])
    setDiver(d || null)
    // Los datos privados del centro (GCash, nota de la revisión) no están en la lectura pública: se piden aparte
    let priv = null
    if (st?.centers?.id) priv = (await supabase.rpc('center_private', { p_center: st.centers.id })).data?.[0] || null
    setCenter(st ? { ...st.centers, ...(priv || {}), role: st.role } : null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session); loadProfile(data.session)
      // Limpia el #access_token=... que dejan los enlaces de email
      const h = window.location.hash
      if (/access_token=|error_description=/.test(h)) {
        const err = new URLSearchParams(h.replace(/^#\/?/, '')).get('error_description')
        if (err) sessionStorage.setItem('authError', err)
        history.replaceState(null, '', window.location.pathname + (h.includes('type=recovery') ? '#/perfil' : '#/'))
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
      setTimeout(() => loadProfile(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  // Centro que mira el administrador en «Ver como centro» (lectura; escribir sigue exigiendo ser del equipo)
  useEffect(() => {
    if (!isAdmin || viewAs !== 'center' || !viewCenterId || viewCenterId === center?.id) { setViewCenter(null); return }
    let live = true
    Promise.all([
      supabase.from('centers').select(CENTER_COLS).eq('id', viewCenterId).maybeSingle(),
      supabase.rpc('center_private', { p_center: viewCenterId }),
    ]).then(([{ data: c }, { data: priv }]) => { if (live) setViewCenter(c ? { ...c, ...(priv?.[0] || {}), role: 'admin' } : null) })
    return () => { live = false }
  }, [isAdmin, viewAs, viewCenterId, center?.id])

  const setViewAs = (v) => { setViewAsState(v); try { localStorage.setItem('adminView', v) } catch (e) { /* sin almacenamiento */ } }
  const setViewCenterId = (id) => { setViewCenterIdState(id); try { localStorage.setItem('adminCenter', id) } catch (e) { /* sin almacenamiento */ } }

  // Perfil: cuenta de centro (gestiona un centro o se registró como centro) o de buceador
  const ownIsCenter = !!center || diver?.account_type === 'center' || session?.user?.user_metadata?.account_type === 'center'
  const adminView = isAdmin ? viewAs : null // null = no es administrador
  const shownCenter = !isAdmin ? center : viewAs !== 'center' ? null : (viewCenterId && viewCenterId !== center?.id ? viewCenter : center)
  const isCenter = isAdmin ? viewAs === 'center' : ownIsCenter
  const readOnly = !!(isAdmin && viewAs === 'center' && shownCenter && shownCenter.id !== center?.id)
  const verified = shownCenter?.verification_status === 'verified'
  const value = {
    session, user: session?.user || null, diver, center: shownCenter, ownCenter: center, isCenter, isAdmin, pendingCenters, verified, recovering, setRecovering,
    needsMfa, adminView, setViewAs, viewCenterId, setViewCenterId, readOnly,
    refresh: () => loadProfile(session),
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
