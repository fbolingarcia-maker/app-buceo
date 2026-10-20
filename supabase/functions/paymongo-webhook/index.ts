// Webhook de PayMongo: confirma los pagos aunque el buceador no vuelva a la app.
// Secretos: PAYMONGO_SECRET_KEY y PAYMONGO_WEBHOOK_SECRET (el "whsk_…" que da PayMongo al crear el webhook).
// Evento a suscribir en PayMongo: checkout_session.payment.paid
// URL: https://tosgzcpnkpsrrkfqctgy.supabase.co/functions/v1/paymongo-webhook   (desplegada sin verificación JWT)
import { createClient } from 'jsr:@supabase/supabase-js@2'

const PM = 'https://api.paymongo.com/v1'

async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// Comparación en tiempo constante (evita ataques de temporización al comprobar la firma)
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

async function sessionPaid(sessionId: string, key: string): Promise<boolean> {
  const r = await fetch(`${PM}/checkout_sessions/${sessionId}`, { headers: { Authorization: 'Basic ' + btoa(key + ':') } })
  if (!r.ok) return false
  const a = (await r.json())?.data?.attributes
  const paid = (a?.payments ?? []).some((p: any) => p?.attributes?.status === 'paid')
  return paid || a?.payment_intent?.attributes?.status === 'succeeded'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  const raw = await req.text()
  const secret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')
  const key = Deno.env.get('PAYMONGO_SECRET_KEY')
  if (!secret || !key) return new Response('not configured', { status: 503 })

  // Firma: "t=<timestamp>,te=<firma test>,li=<firma live>" ; HMAC-SHA256(secret, `${t}.${raw}`)
  const parts = Object.fromEntries((req.headers.get('paymongo-signature') ?? '').split(',').map((kv) => kv.split('=')))
  let evt: any
  try { evt = JSON.parse(raw) } catch { return new Response('bad json', { status: 400 }) }
  const attrs = evt?.data?.attributes ?? {}
  const expected = await hmacHex(secret, `${parts.t}.${raw}`)
  const given = attrs.livemode ? parts.li : parts.te
  if (!parts.t || !given || !safeEqual(given, expected)) return new Response('bad signature', { status: 401 })

  const type = attrs.type ?? evt?.data?.type
  const session = attrs.data ?? evt?.data?.data
  if (type !== 'checkout_session.payment.paid' || !session?.id) return new Response('ignored')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: p } = await admin.from('payments').select('id, status').eq('provider_ref', session.id).maybeSingle()
  if (!p) return new Response('unknown session')
  if (p.status !== 'paid' && (await sessionPaid(session.id, key))) {
    const { error } = await admin.rpc('settle_payment', { p_payment: p.id })
    if (error) { console.error('settle_payment', error.message); return new Response('error', { status: 500 }) }
  }
  return new Response('ok')
})
