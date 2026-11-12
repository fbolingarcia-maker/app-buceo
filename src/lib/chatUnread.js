// Mensajes sin leer de los chats privados de reservas (worker/chat.js): pequeño para ir en el paquete principal
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

// Sin leer: { bookings: { <reserva>: n }, center: n }. Se consulta al entrar y cada minuto.
export function useChatUnread() {
  const { session } = useAuth()
  const [u, setU] = useState({ bookings: {}, center: 0 })
  const load = useCallback(() => supabase.rpc('chat_unread', {}).then(({ data }) => { if (data) setU(data) }).catch(() => {}), [])
  useEffect(() => {
    if (!session) return
    load()
    const i = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', f) }
  }, [session, load])
  return u
}
