// Comprobación anti-bots (Cloudflare Turnstile) para entrar, crear cuenta y los emails de cuenta.
// Solo se carga si el Worker tiene la clave (auth/session devuelve `captcha`); si no, no hay nada que hacer.
// Modo «interaction-only»: casi siempre es invisible y solo pide un clic si Cloudflare tiene dudas.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { getLang } from './i18n'

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading = null
function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading = loading || new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = SRC; s.async = true
    s.onload = () => res(window.turnstile); s.onerror = () => { loading = null; rej(new Error('turnstile')) }
    document.head.appendChild(s)
  })
  return loading
}

// Devuelve { box, get, reset }: `box` va dentro del formulario; `await get()` da el token para la petición (espera
// hasta 8 s a que Cloudflare lo emita) y `reset()` pide uno nuevo tras cada intento (cada token vale una vez).
export function useCaptcha() {
  const [key, setKey] = useState(null)
  const tok = useRef('')
  const setToken = (v) => { tok.current = v }
  const el = useRef(null)
  const id = useRef(null)
  useEffect(() => { supabase.auth.captchaKey?.().then((k) => setKey(k || null)).catch(() => {}) }, [])
  useEffect(() => {
    if (!key || !el.current) return
    let alive = true
    loadScript().then((ts) => {
      if (!alive || !el.current || id.current != null) return
      id.current = ts.render(el.current, {
        sitekey: key, appearance: 'interaction-only', size: 'flexible', language: getLang(),
        callback: (tk) => setToken(tk), 'expired-callback': () => setToken(''), 'error-callback': () => setToken(''),
      })
    }).catch(() => {})
    return () => { alive = false; if (id.current != null) { try { window.turnstile?.remove(id.current) } catch (e) { /* ya no está */ } id.current = null } }
  }, [key])
  const reset = useCallback(() => { tok.current = ''; if (id.current != null) try { window.turnstile?.reset(id.current) } catch (e) { /* sin widget */ } }, [])
  const get = useCallback(async () => {
    if (!key) return undefined
    for (let i = 0; i < 40 && !tok.current; i++) await new Promise((r) => setTimeout(r, 200))
    return tok.current || undefined
  }, [key])
  return { box: key ? <div ref={el} className="captcha" /> : null, get, reset }
}
