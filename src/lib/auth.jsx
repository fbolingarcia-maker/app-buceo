import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = cargando
  const [diver, setDiver] = useState(null)
  const [center, setCenter] = useState(null) // centro que gestiona el usuario (o null)
  const [recovering, setRecovering] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false) // administrador de la plataforma (valida centros)
  const [pendingCenters, setPendingCenters] = useState(0) // centros esperando validación (solo admin)

  const loadProfile = useCallback(async (s) => {
    if (!s) { setDiver(null); setCenter(null); setIsAdmin(false); return }
    supabase.rpc('is_platform_admin').then(({ data }) => {
      setIsAdmin(data === true)
      if (data === true) supabase.from('centers').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending')
        .then(({ count }) => setPendingCenters(count || 0))
    })
    const [{ data: d }, { data: st }] = await Promise.all([
      supabase.from('divers').select('*').eq('user_id', s.user.id).maybeSingle(),
      supabase.from('center_staff').select('role, centers(*)').eq('user_id', s.user.id).maybeSingle(),
    ])
    setDiver(d || null)
    setCenter(st ? { ...st.centers, role: st.role } : null)
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

  // Perfil: cuenta de centro (gestiona un centro o se registró como centro) o de buceador
  const isCenter = !!center || diver?.account_type === 'center' || session?.user?.user_metadata?.account_type === 'center'
  const verified = center?.verification_status === 'verified'
  const value = {
    session, user: session?.user || null, diver, center, isCenter, isAdmin, pendingCenters, verified, recovering, setRecovering,
    refresh: () => loadProfile(session),
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
