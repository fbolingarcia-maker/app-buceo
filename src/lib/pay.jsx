// Pago de una reserva (señal o total, GCash o tarjeta; en modo demo, simulado). Lo usan Salida (reservar y pagar en el
// mismo paso) y Reservas (pagar el resto o reintentar).
import { useState } from 'react'
import { supabase, errMsg, siteUrl } from './supabase'
import { php } from './format'
import { t } from './i18n'
import Icon from './Icon'
import { Lock } from 'lucide-react'
import { useAuth } from './auth'

export const HOLD_MIN = 15

// Hasta cuándo se retiene la plaza de una reserva sin pagar
export const holdEnd = (b) => Math.max(new Date(b.created_at).getTime() + HOLD_MIN * 60000, b.hold_until ? new Date(b.hold_until).getTime() : 0)

// Lee el error que devuelve la Edge Function
export async function fnError(error) {
  try { const j = await error.context.json(); return j.error || error.message } catch { return error.message }
}

// Métodos de PayMongo Checkout. QR Ph sirve para cualquier banco o cartera filipina (la comisión más baja)
export const METHODS = [['gcash', 'GCash'], ['paymaya', 'Maya'], ['qrph', 'QR Ph'], ['card', 'Tarjeta'], ['grab_pay', 'GrabPay']]
const METHOD_KEY = 'ds_paymethod'

// Paga una reserva (b) o varias a la vez (bs: varias salidas del mismo viaje en un solo pago)
export function PayBox({ b, bs, mode, onDone }) {
  const list = bs?.length ? bs : [b]
  const pending = list.every((x) => x.status === 'pending_payment')
  const sum = (f) => list.reduce((n, x) => n + f(x), 0)
  const balance = sum((x) => x.amount_php - x.paid_php)
  const [kind, setKind] = useState(pending ? 'deposit' : 'balance')
  // Pago en un toque (11 nov): el método preferido se guarda en el perfil; con él, un solo botón y «Cambiar»
  const { diver } = useAuth()
  const saved = (() => { try { return diver?.pay_method || localStorage.getItem(METHOD_KEY) } catch (e) { return diver?.pay_method || null } })()
  const [method, setMethod] = useState(saved || 'gcash')
  const [choosing, setChoosing] = useState(!saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const amount = kind === 'deposit' ? sum((x) => Math.max(0, x.deposit_php - x.paid_php)) : balance
  const label = (METHODS.find(([k]) => k === method) || [, 'GCash'])[1]

  async function pay() {
    setBusy(true); setError('')
    if (mode === 'demo') {
      for (const x of list) {
        const { error } = await supabase.rpc('confirm_payment_demo', { p_booking: x.id, p_kind: kind })
        if (error) { setBusy(false); return setError(errMsg(error)) }
      }
      setBusy(false)
      return onDone(null, list[0].id)
    }
    try { localStorage.setItem(METHOD_KEY, method) } catch (e) { /* sin almacenamiento */ }
    if (diver && diver.pay_method !== method) supabase.rpc('set_pay_method', { p_method: method }).then(() => {}, () => {})
    const { data, error } = await supabase.functions.invoke('crear-pago', {
      body: { booking_id: list[0].id, booking_ids: list.map((x) => x.id), kind, method, return_url: siteUrl() },
    })
    if (error) { setBusy(false); return setError(await fnError(error)) }
    window.location.href = data.checkout_url
  }

  return (
    <div style={{ marginTop: 10 }}>
      {pending && <p className="small muted" style={{ margin: '0 0 6px' }}>{t('¿Cuánto quieres pagar ahora?')}</p>}
      {pending ? (
        <div className="seg">
          <button className={kind === 'deposit' ? 'on' : ''} onClick={() => setKind('deposit')}>{t('Señal 50 % · {amount}', { amount: php(sum((x) => Math.max(0, x.deposit_php - x.paid_php))) })}</button>
          <button className={kind === 'full' ? 'on' : ''} onClick={() => setKind('full')}>{t('Todo · {amount}', { amount: php(balance) })}</button>
        </div>
      ) : null}
      {mode !== 'demo' && !choosing && (
        <p className="small" style={{ margin: '0 0 6px' }}>{t('Pagas con {metodo}.', { metodo: method === 'card' ? t('tarjeta') : label })} <button type="button" className="linkish small" onClick={() => setChoosing(true)}>{t('Cambiar método')}</button></p>
      )}
      {mode !== 'demo' && choosing && (
        <div className="seg" role="group" aria-label={t('Método de pago')}>
          {METHODS.map(([k, n]) => <button key={k} className={method === k ? 'on' : ''} aria-pressed={method === k} onClick={() => setMethod(k)}>{k === 'card' ? t(n) : n}</button>)}
        </div>
      )}
      {error && <div className="msg err" role="alert">{error}</div>}
      <button className="btn block" disabled={busy || amount <= 0} onClick={pay}>
        {busy ? t('Un momento…')
          : mode === 'demo' ? t('Pagar {amount} (modo demo)', { amount: php(amount) })
          : t('Pagar {amount} con {metodo}', { amount: php(amount), metodo: method === 'card' ? t('tarjeta') : label })}
      </button>
      {mode !== 'demo' && <p className="small muted" style={{ margin: '6px 0 0' }}><Icon icon={Lock} size={14} /> {t('Pago seguro con PayMongo. DivingSlot no guarda los datos de tu tarjeta.')}</p>}
    </div>
  )
}
