import { useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t } from './i18n'
import { dayLabel, manilaDate, addDays } from './format'
import Icon from './Icon'
import { Check, TriangleAlert } from 'lucide-react'

// Cuestionario médico del buceador (Diver Medical Participant Questionnaire, el que usan PADI, SSI y la mayoría de agencias).
// La app no guarda las respuestas (dato de salud): solo el resultado y la fecha, que vale 12 meses.
//   all_no       → todas las respuestas son NO
//   physician_ok → alguna es SÍ y un médico ha firmado la autorización (el buceador la lleva al centro)
export const MEDICAL_FORM_URL = 'https://padi.com/sites/default/files/documents/2022-12/Diver_Medical_Participant_Questionnaire_10346_EN_English_2022-02-01.pdf'
export const VALID_DAYS = 365

// Hasta qué día vale (YYYY-MM-DD) o null si no hay cuestionario
export const medicalUntil = (d) => (d?.medical_done_at && d?.medical_result ? addDays(d.medical_done_at, VALID_DAYS) : null)
export const medicalValid = (d) => { const u = medicalUntil(d); return !!u && u > manilaDate() }
// Días desde la última inmersión (null si no la ha puesto)
export const daysSinceDive = (d) => (d?.last_dive_date ? Math.floor((Date.parse(manilaDate()) - Date.parse(d.last_dive_date)) / 864e5) : null)

const RESULT = { all_no: 'Todas las respuestas NO', physician_ok: 'Con autorización médica firmada' }
export const medicalLabel = (d) => (d?.medical_result ? t(RESULT[d.medical_result]) : '')

// Estado + formulario. compact: dentro de la reserva (solo pide lo necesario para seguir)
export function MedicalCheck({ diver, onSaved, compact }) {
  const [edit, setEdit] = useState(!medicalValid(diver))
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const until = medicalUntil(diver)

  async function save() {
    setBusy(true); setError('')
    const { error } = await supabase.from('divers').update({ medical_result: answer, medical_done_at: manilaDate() }).eq('id', diver.id)
    setBusy(false)
    if (error) return setError(errMsg(error))
    setEdit(false); setAnswer(''); onSaved?.()
  }

  if (!edit && medicalValid(diver)) return (
    <div className="row between wrap medical-ok" style={{ gap: 8 }}>
      <span className="small"><Icon icon={Check} size={16} className="ok-ic" /> <b>{t('Cuestionario médico al día')}</b> · {medicalLabel(diver)} · {t('hasta el {fecha}', { fecha: dayLabel(until, { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>
      {!compact && <button type="button" className="btn xs ghost" onClick={() => setEdit(true)}>{t('Actualizar')}</button>}
    </div>
  )
  return (
    <fieldset className="medical">
      <legend><b>{t('Cuestionario médico para bucear')}</b></legend>
      <p className="small muted" style={{ margin: '2px 0 8px' }}>
        {until ? t('El tuyo caducó el {fecha}. Se renueva cada 12 meses.', { fecha: dayLabel(until, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('Lo piden todos los centros y vale 12 meses. Son 10 preguntas sobre tu salud.')}
        {' '}<a href={MEDICAL_FORM_URL} target="_blank" rel="noreferrer">{t('Leer el cuestionario oficial')}</a>
      </p>
      <div className="stack">
        {[['all_no', 'He respondido NO a todas las preguntas'], ['physician_ok', 'Alguna es SÍ y tengo la autorización firmada por un médico'], ['yes_no_doctor', 'Alguna es SÍ y aún no tengo autorización médica']].map(([k, label]) => (
          <label key={k} className="check"><input type="radio" name={'medical-' + diver.id} checked={answer === k} onChange={() => setAnswer(k)} /> <span>{t(label)}</span></label>
        ))}
      </div>
      {answer === 'yes_no_doctor' && (
        <div className="msg warn" role="status"><Icon icon={TriangleAlert} size={16} /> {t('Necesitas que un médico revise el cuestionario y firme la autorización antes de bucear. Cuando la tengas, vuelve y marca la segunda opción.')}</div>
      )}
      {answer === 'physician_ok' && <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Lleva la autorización firmada a la salida: el centro la revisará.')}</p>}
      {error && <div className="msg err" role="alert">{error}</div>}
      <p className="small muted" style={{ margin: '8px 0 0' }}>{t('DivingSlot no guarda tus respuestas, solo el resultado y la fecha. El centro de tus salidas lo verá.')}</p>
      <button type="button" className='btn small ghost' style={{ marginTop: 10 }} disabled={busy || !answer || answer === 'yes_no_doctor'} onClick={save}>{busy ? t('Un momento…') : t('Guardar cuestionario')}</button>
    </fieldset>
  )
}
