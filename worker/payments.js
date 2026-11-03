// Pagos online con PayMongo (tarjeta y GCash): port de las Edge Functions crear-pago y paymongo-webhook.
// Secretos: PAYMONGO_SECRET_KEY y PAYMONGO_WEBHOOK_SECRET. URL del webhook: https://divingslot.com/api/webhooks/paymongo
// (evento checkout_session.payment.paid). La app nunca toca datos de tarjeta: todo pasa por la página de PayMongo.
import { json, first, run } from './lib/util.js'
import { hmacHex, safeEqual } from './lib/crypto.js'
import { startOnlinePayment, settlePayment, openShare, shareStatements } from './rpc.js'
import { uuid } from './lib/util.js'
import { rateLimit } from './auth.js'
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
  // Parte de un pago dividido (#/pagar/<token>): la paga cualquiera con el enlace, sin cuenta
  if (body.share_token) return payShare(req, env, ctx, body, key)
  if (!ctx.uid) return json({ error: 'Inicia sesión para pagar' }, 401)
  try {
    if (body.action === 'check') {
      const p = await first(ctx.db, 'SELECT p.* FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = ? AND b.diver_id = ?', String(body.payment_id || ''), ctx.diverId || '')
      if (!p) return json({ error: 'Pago no encontrado' }, 404)
      if (p.status === 'paid') return json({ status: 'paid' })
      if (key && p.provider_ref && (await sessionPaid(p.provider_ref, key))) { await settleAndNotify(env, ctx.db, p.id); return json({ status: 'paid' }) }
      return json({ status: p.status })
    }
    const { booking_id, kind, method } = body
    if (!['deposit', 'full', 'balance'].includes(kind) || !['card', 'gcash'].includes(method)) return json({ error: 'Datos de pago no válidos' }, 400)
    if (!key) return json({ error: 'Los pagos con tarjeta y GCash aún no están activados' }, 503)
    const origin = new URL(req.url).origin
    const allowed = [origin + '/', origin + '/app/', ...String(env.APP_URLS || '').split(',').map((s) => s.trim()).filter(Boolean)]
    const appUrl = allowed.includes(body.return_url) ? body.return_url : allowed[0]

    let p
    try { p = await startOnlinePayment(ctx, String(booking_id || ''), kind, method) } catch (e) { return json({ error: dbMsg(e.message) }, 400) }
    const b = await first(ctx.db, 'SELECT b.seats, t.departs_at, c.name AS center FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id WHERE b.id = ?', p.booking_id)
    const when = new Date(b?.departs_at).toLocaleString('es-ES', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const r = await fetch(`${PM}/checkout_sessions`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(key + ':'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: {
        line_items: [{ name: `${KIND_LABEL[kind]} · ${b?.center ?? 'Salida de buceo'} · ${when}`, amount: p.amount_php * 100, currency: 'PHP', quantity: 1 }],
        payment_method_types: [method],
        description: `Reserva ${p.booking_id.slice(0, 8)} · ${b?.seats} plaza(s)`,
        reference_number: p.id,
        success_url: `${appUrl}#/reservas?pago=${p.id}`,
        cancel_url: `${appUrl}#/reservas?pago=${p.id}&cancelado=1`,
        show_description: true, show_line_items: true, send_email_receipt: true,
        metadata: { payment_id: p.id, booking_id: p.booking_id },
      } } }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      await run(ctx.db, "UPDATE payments SET status = 'failed' WHERE id = ?", p.id)
      return json({ error: `PayMongo: ${j?.errors?.[0]?.detail ?? 'error desconocido'}` }, 502)
    }
    await run(ctx.db, 'UPDATE payments SET provider_ref = ?, checkout_url = ? WHERE id = ?', j.data.id, j.data.attributes.checkout_url, p.id)
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
  const p = await first(env.DB, 'SELECT id, status FROM payments WHERE provider_ref = ?', session.id)
  if (!p) return new Response('unknown session')
  try {
    if (p.status !== 'paid' && (await sessionPaid(session.id, key))) await settleAndNotify(env, env.DB, p.id)
  } catch (e) { console.error('settle', e.message); return new Response('error', { status: 500 }) }
  return new Response('ok')
}

async function payShare(req, env, ctx, body, key) {
  try {
    await rateLimit(env, 'share:' + (req.headers.get('CF-Connecting-IP') || ''), 20, 600)
    const token = String(body.share_token)
    if (body.action === 'check') {
      const p = await first(ctx.db, 'SELECT p.* FROM payments p JOIN payment_shares s ON s.id = p.share_id WHERE p.id = ? AND s.token = ?', String(body.payment_id || ''), token)
      if (!p) return json({ error: 'Pago no encontrado' }, 404)
      if (p.status === 'paid') return json({ status: 'paid' })
      if (key && p.provider_ref && (await sessionPaid(p.provider_ref, key))) { await settleAndNotify(env, ctx.db, p.id); return json({ status: 'paid' }) }
      return json({ status: p.status })
    }
    if (!['card', 'gcash'].includes(body.method)) return json({ error: 'Datos de pago no válidos' }, 400)
    if (!key) return json({ error: 'Los pagos con tarjeta y GCash aún no están activados' }, 503)
    let s
    try { s = await openShare(ctx.db, token) } catch (e) { return json({ error: dbMsg(e.message) }, 400) }
    const origin = new URL(req.url).origin
    const pid = uuid()
    await ctx.db.batch(shareStatements(ctx.db, s, pid, body.method, 'paymongo', false))
    if (!(await first(ctx.db, 'SELECT 1 AS x FROM payments WHERE id = ?', pid))) return json({ error: 'Esta parte ya está pagada' }, 400)
    const when = new Date(s.departs_at).toLocaleString('es-ES', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    const back = `${origin}/app/#/pagar/${token}`
    const r = await fetch(`${PM}/checkout_sessions`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(key + ':'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: {
        line_items: [{ name: `${s.label || 'Parte'} · ${s.center_name} · ${when}`, amount: s.amount_php * 100, currency: 'PHP', quantity: 1 }],
        payment_method_types: [body.method],
        description: `Pago dividido · reserva ${s.booking_id.slice(0, 8)}`,
        reference_number: pid,
        success_url: `${back}?pago=${pid}`,
        cancel_url: `${back}?pago=${pid}&cancelado=1`,
        show_description: true, show_line_items: true, send_email_receipt: true,
        metadata: { payment_id: pid, booking_id: s.booking_id, share_id: s.id },
      } } }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      await run(ctx.db, "UPDATE payments SET status = 'failed' WHERE id = ?", pid)
      return json({ error: `PayMongo: ${j?.errors?.[0]?.detail ?? 'error desconocido'}` }, 502)
    }
    await run(ctx.db, 'UPDATE payments SET provider_ref = ?, checkout_url = ? WHERE id = ?', j.data.id, j.data.attributes.checkout_url, pid)
    return json({ payment_id: pid, checkout_url: j.data.attributes.checkout_url })
  } catch (e) {
    if (e?.status === 429 || /RATE/.test(e?.message || '')) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429)
    console.error('pago dividido', e.message)
    return json({ error: 'No se pudo procesar el pago. Inténtalo de nuevo.' }, 500)
  }
}
