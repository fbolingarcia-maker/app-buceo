// Crea un pago online con PayMongo (tarjeta o GCash) y comprueba su estado al volver.
// Secretos necesarios (Supabase → Edge Functions → Secrets): PAYMONGO_SECRET_KEY
// Opcional: APP_URLS = lista separada por comas de URLs de la app permitidas para volver tras pagar.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const PM = 'https://api.paymongo.com/v1'
const APP_URLS = (Deno.env.get('APP_URLS') ?? 'https://fbolingarcia-maker.github.io/app-buceo/,http://localhost:5173/')
  .split(',').map((s) => s.trim()).filter(Boolean)
// CORS: solo la propia app puede llamar a esta función desde el navegador
const ORIGINS = APP_URLS.map((u) => new URL(u).origin)
const corsFor = (req: Request) => {
  const o = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const KIND_LABEL: Record<string, string> = { deposit: 'Señal 50 %', full: 'Pago total', balance: 'Resto' }

// Mensaje legible de los errores de la base de datos ("CODIGO: mensaje")
const dbMsg = (m: string) => (/^[A-Z_]+: /.test(m) ? m.slice(m.indexOf(': ') + 2) : m)

async function sessionPaid(sessionId: string, key: string): Promise<boolean> {
  const r = await fetch(`${PM}/checkout_sessions/${sessionId}`, {
    headers: { Authorization: 'Basic ' + btoa(key + ':') },
  })
  if (!r.ok) return false
  const a = (await r.json())?.data?.attributes
  const paid = (a?.payments ?? []).some((p: any) => p?.attributes?.status === 'paid')
  return paid || a?.payment_intent?.attributes?.status === 'succeeded'
}

Deno.serve(async (req) => {
  const cors = corsFor(req)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) return json({ error: 'Inicia sesión para pagar' }, 401)

    const body = await req.json()
    const key = Deno.env.get('PAYMONGO_SECRET_KEY')

    // ── Comprobar un pago al volver de PayMongo ──
    if (body.action === 'check') {
      const { data: p } = await admin.from('payments')
        .select('*, bookings!inner(divers!inner(user_id))').eq('id', body.payment_id).maybeSingle()
      if (!p || p.bookings?.divers?.user_id !== user.id) return json({ error: 'Pago no encontrado' }, 404)
      if (p.status === 'paid') return json({ status: 'paid' })
      if (key && p.provider_ref && (await sessionPaid(p.provider_ref, key))) {
        const { error } = await admin.rpc('settle_payment', { p_payment: p.id })
        if (error) return json({ error: dbMsg(error.message) }, 400)
        return json({ status: 'paid' })
      }
      return json({ status: p.status })
    }

    // ── Crear un pago ──
    const { booking_id, kind, method } = body
    if (!['deposit', 'full', 'balance'].includes(kind) || !['card', 'gcash'].includes(method)) {
      return json({ error: 'Datos de pago no válidos' }, 400)
    }
    if (!key) return json({ error: 'Los pagos con tarjeta y GCash aún no están activados' }, 503)
    const appUrl = APP_URLS.includes(body.return_url) ? body.return_url : APP_URLS[0]

    const { data: p, error } = await admin.rpc('start_online_payment', {
      p_booking: booking_id, p_kind: kind, p_method: method, p_user: user.id,
    })
    if (error) return json({ error: dbMsg(error.message) }, 400)

    const { data: b } = await admin.from('bookings')
      .select('seats, trips(departs_at, centers(name))').eq('id', booking_id).single()
    const when = new Date(b?.trips?.departs_at).toLocaleString('es-ES', {
      timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    const name = `${KIND_LABEL[kind]} · ${b?.trips?.centers?.name ?? 'Salida de buceo'} · ${when}`

    const r = await fetch(`${PM}/checkout_sessions`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(key + ':'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{ name, amount: p.amount_php * 100, currency: 'PHP', quantity: 1 }],
            payment_method_types: [method],
            description: `Reserva ${booking_id.slice(0, 8)} · ${b?.seats} plaza(s)`,
            reference_number: p.id,
            success_url: `${appUrl}#/reservas?pago=${p.id}`,
            cancel_url: `${appUrl}#/reservas?pago=${p.id}&cancelado=1`,
            show_description: true,
            show_line_items: true,
            send_email_receipt: true,
            metadata: { payment_id: p.id, booking_id },
          },
        },
      }),
    })
    const j = await r.json()
    if (!r.ok) {
      await admin.from('payments').update({ status: 'failed' }).eq('id', p.id)
      const detail = j?.errors?.[0]?.detail ?? 'error desconocido'
      return json({ error: `PayMongo: ${detail}` }, 502)
    }
    const checkout_url = j.data.attributes.checkout_url
    await admin.from('payments').update({ provider_ref: j.data.id, checkout_url }).eq('id', p.id)
    return json({ payment_id: p.id, checkout_url })
  } catch (e) {
    console.error('crear-pago', e)
    return json({ error: 'No se pudo procesar el pago. Inténtalo de nuevo.' }, 500)
  }
})
