import { useState } from 'react'
import { supabase, errMsg } from '../lib/supabase'
import { go } from '../lib/router'
import { t } from '../lib/i18n'

// Zona de peligro del perfil: el usuario (buceador o centro) elimina su propia cuenta.
// 1) delete_my_account(true) dice qué se borra y qué lo impide; 2) se borran los ficheros de Storage;
// 3) delete_my_account(false) borra en la base de datos y el usuario de Auth.
export default function EliminarCuenta({ diver, isCenter, signOut }) {
  const [step, setStep] = useState(0) // 0 cerrado · 1 revisión · 2 borrando
  const [info, setInfo] = useState(null)
  const [word, setWord] = useState('')
  const [err, setErr] = useState('')
  const WORD = t('ELIMINAR')

  async function check() {
    setErr(''); setStep(1); setInfo(null)
    const { data, error } = await supabase.rpc('delete_my_account', { p_dry_run: true })
    if (error) { setErr(errMsg(error)); return }
    setInfo(data)
  }

  async function removeFiles(centers) {
    // Fotos de la bitácora (bucket dive-photos) y documentos del centro (bucket center-docs)
    if (diver?.id) {
      const { data } = await supabase.from('dive_log_photos').select('path, dive_logs!inner(diver_id)').eq('dive_logs.diver_id', diver.id)
      const paths = (data || []).map((p) => p.path).filter(Boolean)
      for (let i = 0; i < paths.length; i += 100) await supabase.storage.from('dive-photos').remove(paths.slice(i, i + 100))
    }
    if (centers?.length) {
      const { data } = await supabase.from('center_documents').select('path').in('center_id', centers)
      const paths = (data || []).map((p) => p.path).filter(Boolean)
      for (let i = 0; i < paths.length; i += 100) await supabase.storage.from('center-docs').remove(paths.slice(i, i + 100))
    }
  }

  async function del() {
    if (word.trim().toUpperCase() !== WORD) return
    setErr(''); setStep(2)
    try {
      const pre = await supabase.rpc('delete_my_account', { p_dry_run: true })
      if (pre.error) throw pre.error
      if (!pre.data?.ok) { setInfo(pre.data); setStep(1); return }
      await removeFiles(pre.data.centers)
      const { data, error } = await supabase.rpc('delete_my_account', { p_dry_run: false })
      if (error) throw error
      if (!data?.deleted) { setInfo(data); setStep(1); return }
      try { sessionStorage.setItem('flash', t('Tu cuenta se ha eliminado. Gracias por bucear con DivingSlot.')) } catch (e) { /* sin almacenamiento */ }
      await signOut()
      go('/')
    } catch (e) {
      setErr(errMsg(e)); setStep(1)
    }
  }

  const blockers = info?.blockers || []
  // Los motivos llegan de la base de datos en español con el número dentro
  const blockerText = (b) => {
    const n = (b.match(/\d+/) || [''])[0]
    if (b.startsWith('Tienes')) return t('Tienes {n} reserva(s) futura(s). Cancélalas antes de eliminar la cuenta.', { n })
    if (b.startsWith('Tu centro')) return t('Tu centro tiene {n} reserva(s) en salidas futuras. Cancélalas o avisa a los buceadores antes de eliminar la cuenta.', { n })
    return b
  }

  return (
    <>
      <h2>{t('Eliminar cuenta')}</h2>
      <div className="card danger-zone">
        {step === 0 && <>
          <p className="small muted" style={{ marginTop: 0 }}>
            {isCenter
              ? t('Se borran tu acceso, tus datos personales y los documentos de verificación. El centro se cierra y deja de aparecer en la app; sus reservas pasadas se conservan para la contabilidad.')
              : t('Se borran tus datos personales, tu bitácora (con fotos) y tus certificaciones. Las reservas pasadas se conservan de forma anónima para la contabilidad del centro.')}
          </p>
          <button type="button" className="btn danger ghost" onClick={check}>{t('Eliminar mi cuenta…')}</button>
        </>}

        {step >= 1 && <>
          {!info && !err && <p className="muted">{t('Comprobando…')}</p>}
          {blockers.length > 0 && (
            <div className="msg err" role="alert">
              <b>{t('Todavía no puedes eliminar la cuenta:')}</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{blockers.map((b, i) => <li key={i}>{blockerText(b)}</li>)}</ul>
            </div>
          )}
          {info && blockers.length === 0 && <>
            <p style={{ marginTop: 0 }}><b>{t('Esta acción no se puede deshacer.')}</b></p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              {info.dive_logs > 0 && <li>{t('Se borrarán {n} inmersiones de tu bitácora.', { n: info.dive_logs })}</li>}
              {info.bookings_kept > 0 && <li>{t('{n} reservas pasadas quedarán anónimas.', { n: info.bookings_kept })}</li>}
              {info.centers?.length > 0 && <li>{t('Tu centro se cerrará y sus salidas futuras pasarán a borrador.')}</li>}
              <li>{t('Ya no podrás entrar con este email.')}</li>
            </ul>
            <div className="field">
              <label htmlFor="del-word">{t('Escribe {w} para confirmar', { w: WORD })}</label>
              <input id="del-word" autoComplete="off" autoCapitalize="characters" value={word} onChange={(e) => setWord(e.target.value)} disabled={step === 2} />
            </div>
          </>}
          {err && <div className="msg err" role="alert">{err}</div>}
          <div className="row between">
            <button type="button" className="btn ghost" onClick={() => { setStep(0); setWord(''); setInfo(null); setErr('') }} disabled={step === 2}>{t('Cancelar')}</button>
            {info && blockers.length === 0 && (
              <button type="button" className="btn danger" onClick={del} disabled={step === 2 || word.trim().toUpperCase() !== WORD}>
                {step === 2 ? t('Eliminando…') : t('Eliminar definitivamente')}
              </button>
            )}
          </div>
        </>}
      </div>
    </>
  )
}
