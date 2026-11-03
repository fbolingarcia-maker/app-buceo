import { useEffect, useState } from 'react'
import { supabase, errMsg, appUrl } from '../lib/supabase'
import { Link } from '../lib/router'
import { dateTime, php } from '../lib/format'
import { t } from '../lib/i18n'
import Icon from '../lib/Icon'
import { Check, Lock } from 'lucide-react'

// Parte de un pago dividido (#/pagar/<token>): la paga cualquiera con el enlace, sin cuenta
export default function Pagar({ token }) {
  const [s, setS] = useState(null)
  const [method, setMethod] = useState('gcash')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const load = () => supabase.rpc('get_share', { p_token: token }).then(({ data, error }) => {
    if (error) { setError(errMsg(error)); setS(false) } else setS(data)
  })
  useEffect(() => { load() }, [token])

  // Vuelta desde PayMongo: #/pagar/<token>?pago=<id>[&cancelado=1]
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const pid = q.get('pago')
    if (!pid) return
    history.replaceState(null, '', window.location.pathname + '#/pagar/' + token)
    if (q.get('cancelado')) { setInfo(t('Pago cancelado. Puedes intentarlo de nuevo.')); return }
    setInfo(t('Comprobando el pago…'))
    supabase.functions.invoke('crear-pago', { body: { action: 'check', payment_id: pid, share_token: token } }).then(({ data }) => {
      setInfo(data?.status === 'paid' ? '' : t('El pago aún no aparece como completado. Si has pagado, se actualizará en unos minutos.'))
      load()
    })
  }, [token])

  async function pay() {
    setBusy(true); setError('')
    if (s.mode === 'demo') {
      const { error } = await supabase.rpc('pay_share_demo', { p_token: token })
      setBusy(false)
      if (error) return setError(errMsg(error))
      return load()
    }
    const { data, error } = await supabase.functions.invoke('crear-pago', { body: { share_token: token, method } })
    if (error) {
      setBusy(false)
      try { const j = await error.context.json(); return setError(j.error || error.message) } catch { return setError(error.message) }
    }
    window.location.href = data.checkout_url
  }

  if (s === null) return <p className="muted">{t('Cargando…')}</p>
  if (s === false) return <div className="card"><p>{error || t('Este enlace de pago no es válido.')}</p><Link to="/">{t('Ver salidas')}</Link></div>
  return (
    <>
      <h1>{t('Tu parte del pago')}</h1>
      <div className="card stack">
        <div className="row between"><span className="muted">{t('Centro')}</span><b>{s.center_name}</b></div>
        <div className="row between"><span className="muted">{t('Salida')}</span><span>{dateTime(s.departs_at)}</span></div>
        <div className="row between"><span className="muted">{t('Reserva de')}</span><span>{s.organiser} · {s.seats === 1 ? t('{n} plaza', { n: 1 }) : t('{n} plazas', { n: s.seats })}</span></div>
        <div className="row between"><span className="muted">{s.label}</span><span className="big">{php(s.amount_php)}</span></div>
      </div>
      {info && <div className="msg ok" role="status">{info}</div>}
      {s.paid ? (
        <div className="card confirmada" role="status">
          <b className="row" style={{ gap: 6 }}><Icon icon={Check} className="ok-ink" />{t('Parte pagada. ¡Gracias!')}</b>
          <p className="small muted" style={{ marginBottom: 0 }}>{t('¿Aún no tienes cuenta? Créala para guardar tus inmersiones en la bitácora.')} <a href={appUrl() + '#/login'}>{t('Crear cuenta')}</a></p>
        </div>
      ) : !s.open ? (
        <div className="card muted">{t('Este enlace ya no admite pagos: la reserva ha caducado, se ha cancelado o la salida ya empezó.')}</div>
      ) : (
        <div className="card">
          {s.mode !== 'demo' && (
            <div className="seg">
              <button className={method === 'gcash' ? 'on' : ''} onClick={() => setMethod('gcash')}>GCash</button>
              <button className={method === 'card' ? 'on' : ''} onClick={() => setMethod('card')}>{t('Tarjeta')}</button>
            </div>
          )}
          {error && <div className="msg err" role="alert">{error}</div>}
          <button className="btn block" disabled={busy} onClick={pay}>
            {busy ? t('Un momento…') : s.mode === 'demo' ? t('Pagar {amount} (modo demo)', { amount: php(s.amount_php) })
              : method === 'gcash' ? t('Pagar {amount} con GCash', { amount: php(s.amount_php) }) : t('Pagar {amount} con tarjeta', { amount: php(s.amount_php) })}
          </button>
          {s.mode !== 'demo' && <p className="small muted" style={{ margin: '6px 0 0' }}><Icon icon={Lock} size={14} /> {t('Pago seguro con PayMongo. DivingSlot no guarda los datos de tu tarjeta.')}</p>}
        </div>
      )}
    </>
  )
}
