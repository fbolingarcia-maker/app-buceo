// Pago de una reserva (señal o total, GCash o tarjeta; en modo demo, simulado). Lo usan Salida (reservar y pagar en el
// mismo paso) y Reservas (pagar el resto o reintentar).
import { useState } from 'react'
import { supabase, errMsg, siteUrl } from './supabase'
import { php } from './format'
import { t } from './i18n'
import Icon from './Icon'
import { Lock } from 'lucide-react'

export const HOLD_MIN = 15

// Hasta cuándo se retiene la plaza de una reserva sin pagar
export const holdEnd = (b) => Math.max(new Date(b.created_at).getTime() + HOLD_MIN * 60000, b.hold_until ? new Date(b.hold_until).getTime() : 0)

// Lee el error que devuelve la Edge Function
export async function fnError(error) {
  try { const j = await error.context.json(); return j.error || error.message } catch { return error.message }
}

export function PayBox({ b, mode, onDone }) {
  const pending = b.status === 'pending_payment'
  const balance = b.amount_php - b.paid_php
  const [kind, setKind] = useState(pending ? 'deposit' : 'balance')
  const [method, setMethod] = useState('gcash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const amount = kind === 'deposit' ? b.deposit_php - b.paid_php : balance

  async function pay() {
    setBusy(true); setError('')
    if (mode === 'demo') {
      const { error } = await supabase.rpc('confirm_payment_demo', { p_booking: b.id, p_kind: kind })
      setBusy(false)
      return error ? setError(errMsg(error)) : onDone(null, b.id)
    }
    const { data, error } = await supabase.functions.invoke('crear-pago', {
      body: { booking_id: b.id, kind, method, return_url: siteUrl() },
    })
    if (error) { setBusy(false); return setError(await fnError(error)) }
    window.location.href = data.checkout_url
  }

  return (
    <div style={{ marginTop: 10 }}>
      {pending && <p className="small muted" style={{ margin: '0 0 6px' }}>{t('¿Cuánto quieres pagar ahora?')}</p>}
      {pending ? (
        <div className="seg">
          <button className={kind === 'deposit' ? 'on' : ''} onClick={() => setKind('deposit')}>{t('Señal 50 % · {amount}', { amount: php(b.deposit_php - b.paid_php) })}</button>
          <button className={kind === 'full' ? 'on' : ''} onClick={() => setKind('full')}>{t('Todo · {amount}', { amount: php(balance) })}</button>
        </div>
      ) : null}
      {mode !== 'demo' && (
        <div className="seg">
          <button className={method === 'gcash' ? 'on' : ''} onClick={() => setMethod('gcash')}>GCash</button>
          <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>{t('Tarjeta')}</button>
        </div>
      )}
      {error && <div className="msg err" role="alert">{error}</div>}
      <button className="btn block" disabled={busy || amount <= 0} onClick={pay}>
        {busy ? t('Un momento…')
          : mode === 'demo' ? t('Pagar {amount} (modo demo)', { amount: php(amount) })
          : method === 'gcash' ? t('Pagar {amount} con GCash', { amount: php(amount) })
          : t('Pagar {amount} con tarjeta', { amount: php(amount) })}
      </button>
      {mode !== 'demo' && <p className="small muted" style={{ margin: '6px 0 0' }}><Icon icon={Lock} size={14} /> {t('Pago seguro con PayMongo. DivingSlot no guarda los datos de tu tarjeta.')}</p>}
    </div>
  )
}

