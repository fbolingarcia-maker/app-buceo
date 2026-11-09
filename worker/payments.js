// Pagos online con PayMongo (tarjeta y GCash): port de las Edge Functions crear-pago y paymongo-webhook.
// Secretos: PAYMONGO_SECRET_KEY y PAYMONGO_WEBHOOK_SECRET. URL del webhook: https://divingslot.com/api/webhooks/paymongo
// (evento checkout_session.payment.paid). La app nunca toca datos de tarjeta: todo pasa por la página de PayMongo.
import { json, first, run, all } from './lib/util.js'
import { hmacHex, safeEqual } from './lib/crypto.js'
import { startOnlinePayment, settlePayment, PAY_METHODS } from './rpc.js'
import { notifyAdmin } from './stats.js'

// Cobra el pago y avisa al administrador (como el trigger notify_payment de la migración 030)
async function settleAndNotify(env, db, paymentId) {
  const before = await first(db, 'SELECT status, provider, method, kind, amount_php FROM payments WHERE id = ?', paymentId)
  await settlePayment(db, paymentId)
  if (before && before.status !== 'paid' && before.provider === 'paymongo') {
    await notifyAdmin(env, { kind: 'pago', title: 'Pago online recibido: ₱' + (before.amount_php || 0).toLocaleString('en-US'),
      lines: ['Método: ' + (before.method || '—'), 'Tipo: ' + (before.kind || '—')] }).catch((e) => console.error('aviso pago', e.message))
  }
}

// Un pago de PayMongo puede cubrir varias reservas: se aplican todos los pagos con esa sesión
async function settleSession(env, db, sessionId) {
  const rows = await all(db, "SELECT id FROM payments WHERE provider_ref = ? AND status <> 'paid'", sessionId)
  for (const r of rows) await settleAndNotify(env, db, r.id)
}

const PM = 'https://api.paymongo.com/v1'
const KIND_LABEL = { deposit: 'Señal 50 %', full: 'Pago total', balance: 'Resto' }
const dbMsg = (m) => (/^[A-Z_]+: /.test(m) ? m.slice(m.indexOf(': ') + 2) : m)

async function sessionPaid(sessionId, key) {
  const r = await fetch(`${PM}/checkout_sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: 'Basic ' + btoa(key + ':') } })
  if (!r.ok) return false
  const a = (await r.json())?.data?.attributes
  return (a?.payments ?? []).some((p) => p?.attributes?.status === 'paid') || a?.payment_intent?.attributes?.status === 'succeeded'
}

// POST /api/functions/crear-pago  (mismo contrato que la Edge Function: el frontend no cambia)
export async function crearPago(req, env, ctx) {
  const body = await req.json().catch(() => ({}))
  const key = env.PAYMONGO_SECRET_KEY
  if (!ctx.uid) return json({ error: 'Inicia sesión para pagar' }, 401)
  try {
    if (body.action === 'check') {
      const p = await first(ctx.db, 'SELECT p.* FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = ? AND b.diver_id = ?', String(body.payment_id || ''), ctx.diverId || '')
      if (!p) return json({ error: 'Pago no encontrado' }, 404)
      if (p.status === 'paid') return json({ status: 'paid' })
      if (key && p.provider_ref && (await sessionPaid(p.provider_ref, key))) { await settleSession(env, ctx.db, p.provider_ref); return json({ status: 'paid' }) }
      return json({ status: p.status })
    }
    const { booking_id, kind, method } = body
    // Varias salidas en un solo pago: booking_ids (hasta 7), cada una con su señal o total
    const ids = Array.isArray(body.booking_ids) && body.booking_ids.length ? [...new Set(body.booking_ids.map(String))].slice(0, 7) : [String(booking_id || '')]
    if (!['deposit', 'full', 'balance'].includes(kind) || !PAY_METHODS.includes(method)) return json({ error: 'Datos de pago no válidos' }, 400)
    if (!key) return json({ error: 'Los pagos con tarjeta y GCash aún no están activados' }, 503)
    const origin = new URL(req.url).origin
    const allowed = [origin + '/', origin + '/app/', ...String(env.APP_URLS || '').split(',').map((s) => s.trim()).filter(Boolean)]
    const appUrl = allowed.includes(body.return_url) ? body.return_url : allowed[0]

    const ps = []
    try { for (const id of ids) ps.push(await startOnlinePayment(ctx, id, kind, method)) } catch (e) {
      for (const x of ps) await run(ctx.db, "UPDATE payments SET status = 'failed' WHERE id = ?", x.id)
      return json({ error: dbMsg(e.message) }, 400)
    }
    const p = ps[0]
    const items = []
    for (const x of ps) {
      const b = await first(ctx.db, 'SELECT b.seats, t.departs_at, c.name AS center FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id WHERE b.id = ?', x.booking_id)
      const when = new Date(b?.departs_at).toLocaleString('es-ES', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      items.push({ name: `${KIND_LABEL[kind]} · ${b?.center ?? 'Salida de buceo'} · ${when}`, amount: x.amount_php * 100, currency: 'PHP', quantity: 1, seats: b?.seats })
    }
    const r = await fetch(`${PM}/checkout_sessions`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(key + ':'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: {
        line_items: items.map(({ seats, ...it }) => it),
        payment_method_types: [method],
        description: ps.length > 1 ? `${ps.length} reservas` : `Reserva ${p.booking_id.slice(0, 8)} · ${items[0].seats} plaza(s)`,
        reference_number: p.id,
        success_url: `${appUrl}#/reservas?pago=${p.id}`,
        cancel_url: `${appUrl}#/reservas?pago=${p.id}&cancelado=1`,
        show_description: true, show_line_items: true, send_email_receipt: true,
        metadata: { payment_id: p.id, booking_id: p.booking_id },
      } } }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      for (const x of ps) await run(ctx.db, "UPDATE payments SET status = 'failed' WHERE id = ?", x.id)
      return json({ error: `PayMongo: ${j?.errors?.[0]?.detail ?? 'error desconocido'}` }, 502)
    }
    for (const x of ps) await run(ctx.db, 'UPDATE payments SET provider_ref = ?, checkout_url = ? WHERE id = ?', j.data.id, j.data.attributes.checkout_url, x.id)
    return json({ payment_id: p.id, checkout_url: j.data.attributes.checkout_url })
  } catch (e) {
    console.error('crear-pago', e.message)
    return json({ error: 'No se pudo procesar el pago. Inténtalo de nuevo.' }, 500)
  }
}

// POST /api/webhooks/paymongo — firma "t=<ts>,te=<test>,li=<live>", HMAC-SHA256(secret, `${t}.${cuerpo}`)
export async function paymongoWebhook(req, env) {
  const raw = await req.text()
  const secret = env.PAYMONGO_WEBHOOK_SECRET, key = env.PAYMONGO_SECRET_KEY
  if (!secret || !key) return new Response('not configured', { status: 503 })
  const parts = Object.fromEntries((req.headers.get('paymongo-signature') ?? '').split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] }))
  let evt
  try { evt = JSON.parse(raw) } catch (e) { return new Response('bad json', { status: 400 }) }
  const attrs = evt?.data?.attributes ?? {}
  const expected = await hmacHex(secret, `${parts.t}.${raw}`)
  const given = attrs.livemode ? parts.li : parts.te
  if (!parts.t || !given || !safeEqual(given, expected)) return new Response('bad signature', { status: 401 })
  if (Math.abs(Date.now() / 1000 - +parts.t) > 3600) return new Response('stale', { status: 401 }) // evita reenvíos antiguos
  const type = attrs.type ?? evt?.data?.type
  const session = attrs.data ?? evt?.data?.data
  if (type !== 'checkout_session.payment.paid' || !session?.id) return new Response('ignored')
  const p = await first(env.DB, "SELECT count(*) AS n, sum(status <> 'paid') AS open FROM payments WHERE provider_ref = ?", session.id)
  if (!p?.n) return new Response('unknown session')
  try {
    if (p.open && (await sessionPaid(session.id, key))) await settleSession(env, env.DB, session.id)
  } catch (e) { console.error('settle', e.message); return new Response('error', { status: 500 }) }
  return new Response('ok')
}

