import { useEffect, useRef, useState } from 'react'
import { supabase, errMsg } from './supabase'
import { t, getLang, locale } from './i18n'
import { useAuth } from './auth'
import { dayLabel, manilaDate } from './format'
import Icon from './Icon'
import { Check, X, TriangleAlert, Lock, Printer, Upload, Eraser } from 'lucide-react'

// Cuestionario médico para bucear, rellenado y firmado en la app (worker/medical.js).
// Contenido: los temas de las 10 preguntas y los bloques A–G del cuestionario internacional para buceo recreativo
// (WRSTC/UHMS 2020, el que usan PADI, SSI y la mayoría de agencias), redactados con nuestras palabras.
// Un SÍ en las preguntas 3, 5 o 10, o en cualquier pregunta de detalle, pide la evaluación de un médico.
export const MAIN = [
  ['q1', 'A', 'He tenido problemas de pulmones, respiración, corazón o sangre que afectan a mi rendimiento físico o mental normal.'],
  ['q2', 'B', 'Tengo más de 45 años.'],
  ['q3', null, 'Me cuesta hacer ejercicio moderado (por ejemplo, andar 1,6 km en 14 minutos o nadar 200 m sin parar), o en los últimos 12 meses no he podido hacer actividad física normal por salud o forma física.'],
  ['q4', 'C', 'He tenido problemas de ojos, oídos o fosas nasales y senos paranasales.'],
  ['q5', null, 'Me han operado en los últimos 12 meses, o sigo con problemas por una operación anterior.'],
  ['q6', 'D', 'He perdido el conocimiento, tengo migrañas, he tenido convulsiones, un ictus, un golpe fuerte en la cabeza o tengo una lesión o enfermedad neurológica persistente.'],
  ['q7', 'E', 'Recibo (o he recibido en los últimos 5 años) tratamiento por un problema psicológico, ataques de pánico o una adicción a drogas o alcohol, o tengo diagnosticado un trastorno del aprendizaje o del desarrollo.'],
  ['q8', 'F', 'He tenido problemas de espalda, hernia, úlceras o diabetes.'],
  ['q9', 'G', 'He tenido problemas de estómago o intestino, incluida diarrea reciente.'],
  ['q10', null, 'Tomo medicamentos con receta (salvo anticonceptivos o antipalúdicos que no sean mefloquina).'],
]
export const BOXES = {
  A: ['Me han operado del pecho, del corazón o de una válvula, llevo un dispositivo implantado (stent, marcapasos…), he tenido un neumotórax o tengo una enfermedad pulmonar crónica.',
    'En los últimos 12 meses he tenido asma, pitos al respirar, alergias fuertes o vías respiratorias congestionadas que limitan mi actividad física.',
    'He tenido un problema de corazón (angina, dolor en el pecho al hacer esfuerzo, insuficiencia cardiaca, edema pulmonar por inmersión, infarto o ictus) o tomo medicación para el corazón.',
    'En los últimos 12 meses he tenido bronquitis que se repite y ahora tengo tos, o me han diagnosticado enfisema.',
    'En los últimos 30 días he tenido síntomas de pulmones, respiración, corazón o sangre que afectan a mi rendimiento físico o mental.'],
  B: ['Fumo o tomo nicotina de otra forma.', 'Tengo el colesterol alto.', 'Tengo la tensión alta.',
    'Un familiar directo murió de repente o por un problema de corazón o ictus antes de los 50, o hay antecedentes familiares de enfermedad del corazón antes de los 50.'],
  C: ['Me han operado de los senos paranasales en los últimos 6 meses.', 'Tengo una enfermedad de oído, me han operado del oído, he perdido audición o tengo problemas de equilibrio.',
    'He tenido sinusitis que se repite en los últimos 12 meses.', 'Me han operado de los ojos en los últimos 3 meses.'],
  D: ['He tenido un golpe en la cabeza con pérdida de conocimiento en los últimos 5 años.', 'Tengo una lesión o enfermedad neurológica persistente.',
    'He tenido migrañas que se repiten en los últimos 12 meses o tomo medicación para evitarlas.', 'He tenido desmayos o pérdidas de conocimiento (totales o parciales) en los últimos 5 años.',
    'Tengo epilepsia, convulsiones o tomo medicación para evitarlas.'],
  E: ['He tenido problemas de salud mental o psicológicos que han necesitado tratamiento médico o psiquiátrico.',
    'Tengo depresión grave, ataques de pánico o trastorno bipolar no controlado que necesitan medicación o tratamiento psiquiátrico.',
    'Tengo diagnosticado un problema de salud mental o un trastorno del aprendizaje o del desarrollo que necesita atención continua o ayuda especial.',
    'He necesitado tratamiento por una adicción a drogas o alcohol en los últimos 5 años.'],
  F: ['He tenido problemas de espalda que se repiten en los últimos 6 meses y limitan mi actividad diaria.', 'Me han operado de la espalda o la columna en los últimos 12 meses.',
    'Tengo diabetes (con medicación o con dieta) o he tenido diabetes gestacional en los últimos 12 meses.', 'Tengo una hernia sin operar que limita mis capacidades físicas.',
    'Tengo úlceras o heridas activas o sin tratar, o me han operado de una úlcera en los últimos 6 meses.'],
  G: ['Me han hecho una ostomía y no tengo el visto bueno del médico para nadar.', 'En los últimos 7 días he tenido una deshidratación que ha necesitado atención médica.',
    'Tengo úlceras de estómago o intestino activas o sin tratar, o me han operado de una úlcera en los últimos 6 meses.', 'Tengo ardor de estómago o reflujo frecuentes.',
    'Tengo colitis ulcerosa o enfermedad de Crohn activa o no controlada.', 'Me han hecho una cirugía bariátrica en los últimos 12 meses.'],
}
const BOX_TITLE = { A: 'Pulmones, respiración, corazón y sangre', B: 'Más de 45 años', C: 'Ojos, oídos y senos', D: 'Cabeza y sistema nervioso',
  E: 'Salud mental y aprendizaje', F: 'Espalda, hernia, úlceras y diabetes', G: 'Estómago e intestino' }

export const needsPhysician = (answers, boxes) => MAIN.some(([q, box]) => answers[q] === true && (!box || (boxes[box] || []).some(Boolean)))
const day = (d) => (d ? dayLabel(d, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// Firma con el dedo o el ratón; devuelve un trazo SVG (solo M/L/Q y números) en un lienzo de 600×200
export function SignaturePad({ onChange }) {
  const ref = useRef(null)
  const strokes = useRef([])
  const [has, setHas] = useState(false)
  useEffect(() => {
    const c = ref.current, ctx = c.getContext('2d')
    const ratio = window.devicePixelRatio || 1
    const fit = () => { const w = c.clientWidth; c.width = w * ratio; c.height = (w / 3) * ratio; ctx.setTransform(ratio * w / 600, 0, 0, ratio * w / 600, 0, 0); redraw() }
    function redraw() {
      ctx.clearRect(0, 0, 600, 200); ctx.lineWidth = 3; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = getComputedStyle(c).color
      for (const s of strokes.current) { ctx.beginPath(); s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (s.length === 1) ctx.lineTo(s[0][0] + 0.5, s[0][1]); ctx.stroke() }
    }
    const pt = (e) => { const r = c.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * 600), Math.round(((e.clientY - r.top) / r.height) * 200)] }
    let drawing = false
    const down = (e) => { e.preventDefault(); c.setPointerCapture?.(e.pointerId); drawing = true; strokes.current.push([pt(e)]); redraw() }
    const move = (e) => { if (!drawing) return; e.preventDefault(); const s = strokes.current[strokes.current.length - 1], p = pt(e), q = s[s.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 2) { s.push(p); redraw() } }
    const up = () => {
      if (!drawing) return
      drawing = false
      const total = strokes.current.reduce((a, s) => a + s.length, 0)
      const ok = total >= 8
      setHas(ok)
      onChange(ok ? strokes.current.map((s) => 'M' + s.map((p) => p.join(' ')).join(' L')).join(' ') : '')
    }
    fit()
    window.addEventListener('resize', fit)
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    c.clear = () => { strokes.current = []; setHas(false); onChange(''); redraw() }
    return () => { window.removeEventListener('resize', fit); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])
  return (
    <div className="sig-pad">
      <canvas ref={ref} aria-label={t('Recuadro para firmar con el dedo')} role="img" />
      {!has && <span className="sig-hint" aria-hidden="true">{t('Firma aquí con el dedo')}</span>}
      <button type="button" className="btn xs ghost sig-clear" onClick={() => ref.current.clear()} disabled={!has}><Icon icon={Eraser} size={14} /> {t('Borrar')}</button>
    </div>
  )
}

export const SignatureView = ({ d }) => (
  <svg className="sig-view" viewBox="0 0 600 200" role="img" aria-label={t('Firma')}><path d={d} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

function YesNo({ name, value, onChange, label, n }) {
  return (
    <div className={'mq-row' + (value === true ? ' yes' : '')} role="radiogroup" aria-label={label}>
      <p className="mq-text">{n && <b className="mq-n">{n}</b>}{label}</p>
      <div className="seg mq-seg">
        <label className={value === true ? 'on' : ''}><input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> {t('Sí')}</label>
        <label className={value === false ? 'on' : ''}><input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> {t('No')}</label>
      </div>
    </div>
  )
}

// Subir la evaluación del médico (foto o PDF) a la carpeta privada del buceador y asociarla al cuestionario
function PhysicianUpload({ formId, onDone }) {
  const { user } = useAuth()
  const [ph, setPh] = useState({ name: '', date: '', clinic: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function send(e) {
    e.preventDefault()
    if (!file) return setErr(t('Añade la foto o el PDF de la evaluación firmada por el médico'))
    if (file.size > 10 * 1024 * 1024) return setErr(t('El fichero supera los 10 MB'))
    setBusy(true); setErr('')
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'
    const path = `${user.id}/medico/${formId}-${Date.now()}.${ext}`
    const up = await supabase.storage.from('dive-photos').upload(path, file, { contentType: file.type })
    if (up.error) { setBusy(false); return setErr(errMsg(up.error)) }
    const { error } = await supabase.rpc('medical_add_physician', { p_form: formId, p_name: ph.name, p_date: ph.date, p_clinic: ph.clinic, p_doc_path: path })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    onDone?.()
  }
  return (
    <form className="mq-physician" onSubmit={send}>
      <p className="small" style={{ margin: '0 0 8px' }}><b>{t('¿Ya tienes la evaluación del médico?')}</b> {t('Súbela y el centro la verá junto a tu cuestionario.')}</p>
      <div className="grid2">
        <div className="field"><label htmlFor="mq-ph-n">{t('Nombre del médico')}</label><input id="mq-ph-n" required value={ph.name} onChange={(e) => setPh({ ...ph, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="mq-ph-d">{t('Fecha de la evaluación')}</label><input id="mq-ph-d" type="date" required max={manilaDate()} value={ph.date} onChange={(e) => setPh({ ...ph, date: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="mq-ph-c">{t('Clínica (opcional)')}</label><input id="mq-ph-c" value={ph.clinic} onChange={(e) => setPh({ ...ph, clinic: e.target.value })} /></div>
      <label className="btn small ghost file-btn"><Icon icon={Upload} size={16} /> {file ? file.name : t('Foto o PDF de la evaluación')}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
      {err && <div className="msg err" role="alert">{err}</div>}
      <button className="btn small" disabled={busy} style={{ marginTop: 8 }}>{busy ? t('Subiendo…') : t('Guardar evaluación')}</button>
    </form>
  )
}

// Formulario por pasos: 1 preguntas · 2 detalle de los SÍ · 3 revisar y firmar · 4 hecho
export function MedicalForm({ diver, onDone, onCancel }) {
  const [step, setStep] = useState(1)
  const [answers, setAnswers] = useState({})
  const [boxes, setBoxes] = useState({})
  const [name, setName] = useState(diver?.full_name || '')
  const [birth, setBirth] = useState(diver?.birth_date || '')
  const [sig, setSig] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)
  const top = useRef(null)
  const go = (s) => { setStep(s); setErr(''); setTimeout(() => top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0) }

  const openBoxes = MAIN.filter(([q, box]) => box && answers[q] === true).map(([, box]) => box)
  const mainDone = MAIN.every(([q]) => typeof answers[q] === 'boolean')
  const boxesDone = openBoxes.every((b) => BOXES[b].every((_, i) => typeof boxes[b]?.[i] === 'boolean'))
  const needs = needsPhysician(answers, boxes)
  const setBox = (b, i, v) => setBoxes((x) => { const arr = [...(x[b] || Array(BOXES[b].length).fill(undefined))]; arr[i] = v; return { ...x, [b]: arr } })

  async function sign() {
    setBusy(true); setErr('')
    const p_boxes = Object.fromEntries(openBoxes.map((b) => [b, boxes[b]]))
    const { data, error } = await supabase.rpc('medical_sign', { p_answers: answers, p_boxes, p_name: name, p_birth_date: birth, p_signature: sig, p_lang: getLang() })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    setDone(data); go(4)
    if (data.status === 'valid') onDone?.(data)
  }

  return (
    <div className="mq" ref={top}>
      <ol className="mq-steps" aria-label={t('Pasos')}>
        {[t('Preguntas'), t('Detalle'), t('Firmar')].map((l, i) => <li key={l} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{l}</li>)}
      </ol>
      <p className="small muted mq-privacy"><Icon icon={Lock} size={14} /> {t('Confidencial: se guarda cifrado y solo lo ven el centro y los guías de tus salidas, de 30 días antes a 30 días después. Verás cada vez que lo consulten.')}</p>

      {step === 1 && (
        <>
          <p className="small">{t('Responde con sinceridad. Un SÍ no te impide bucear: solo significa que un médico tiene que revisarlo antes. Si estás embarazada o intentándolo, no bucees.')}</p>
          {MAIN.map(([q, , text], i) => <YesNo key={q} n={i + 1} name={'mq-' + q} label={t(text)} value={answers[q]} onChange={(v) => setAnswers({ ...answers, [q]: v })} />)}
          {err && <div className="msg err" role="alert">{err}</div>}
          <div className="row between" style={{ marginTop: 12 }}>
            {onCancel ? <button type="button" className="btn ghost small" onClick={onCancel}>{t('Cancelar')}</button> : <span />}
            <button type="button" className="btn small" onClick={() => (mainDone ? go(openBoxes.length ? 2 : 3) : setErr(t('Responde a todas las preguntas')))}>{t('Seguir')}</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="small">{t('Has respondido SÍ a alguna pregunta. Concreta un poco más:')}</p>
          {openBoxes.map((b) => (
            <fieldset key={b} className="mq-box">
              <legend><b>{t('Bloque {b}', { b })}</b> · {t(BOX_TITLE[b])}</legend>
              {BOXES[b].map((text, i) => <YesNo key={i} name={`mq-${b}-${i}`} label={t(text)} value={boxes[b]?.[i]} onChange={(v) => setBox(b, i, v)} />)}
            </fieldset>
          ))}
          {err && <div className="msg err" role="alert">{err}</div>}
          <div className="row between" style={{ marginTop: 12 }}>
            <button type="button" className="btn ghost small" onClick={() => go(1)}>{t('Atrás')}</button>
            <button type="button" className="btn small" onClick={() => (boxesDone ? go(3) : setErr(t('Responde a todas las preguntas')))}>{t('Seguir')}</button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className={'msg ' + (needs ? 'warn' : 'ok')} role="status">
            <Icon icon={needs ? TriangleAlert : Check} size={16} /> {needs
              ? t('Por tus respuestas, necesitas la evaluación de un médico antes de bucear. Firma ahora y después sube su evaluación (foto o PDF).')
              : t('No necesitas evaluación médica: con tu firma queda al día durante 12 meses.')}
          </div>
          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="field"><label htmlFor="mq-name">{t('Nombre completo')}</label><input id="mq-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="mq-birth">{t('Fecha de nacimiento')}</label><input id="mq-birth" type="date" autoComplete="bday" max={manilaDate()} value={birth} onChange={(e) => setBirth(e.target.value)} /></div>
          </div>
          <SignaturePad onChange={setSig} />
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="small">{t('Declaro que mis respuestas son ciertas y completas, que entiendo que bucear tiene riesgos y que avisaré al centro si mi salud cambia antes de la salida.')}</span>
          </label>
          {err && <div className="msg err" role="alert">{err}</div>}
          {(name.trim().length < 3 || !birth || !sig || !agree) && (
            <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Falta')}: {[name.trim().length < 3 && t('Nombre completo'), !birth && t('Fecha de nacimiento'), !sig && t('Firma'), !agree && t('marcar la declaración')].filter(Boolean).join(' · ')}</p>
          )}
          <div className="row between" style={{ marginTop: 12 }}>
            <button type="button" className="btn ghost small" onClick={() => go(openBoxes.length ? 2 : 1)}>{t('Atrás')}</button>
            <button type="button" className="btn small" disabled={busy || !agree || !sig || name.trim().length < 3 || !birth} onClick={sign}>{busy ? t('Un momento…') : t('Firmar y enviar')}</button>
          </div>
        </>
      )}

      {step === 4 && done && (
        <>
          <div className={'msg ' + (done.status === 'valid' ? 'ok' : 'warn')} role="status">
            <Icon icon={done.status === 'valid' ? Check : TriangleAlert} size={16} /> {done.status === 'valid'
              ? t('Firmado. Vale hasta el {fecha} y el centro de tus salidas lo recibe al reservar.', { fecha: day(done.valid_until) })
              : t('Firmado. Falta la evaluación del médico: hasta que la subas no podrás reservar inmersiones.')}
          </div>
          {done.status !== 'valid' && <PhysicianUpload formId={done.id} onDone={() => { setDone({ ...done, status: 'valid' }); onDone?.({ ...done, status: 'valid' }) }} />}
        </>
      )}
    </div>
  )
}

// Vista del cuestionario firmado (para el buceador en su perfil y para el centro). Imprimible.
export function MedicalSheet({ m, docUrl, who }) {
  const yes = MAIN.filter(([q]) => m.answers?.[q])
  return (
    <div className="mq-sheet">
      <div className="row between wrap" style={{ gap: 8 }}>
        <div>
          <b>{m.name}</b>{m.birth_date ? ' · ' + day(m.birth_date) : ''}
          <div className="small muted">{t('Firmado el {fecha}', { fecha: day(m.signed_at?.slice(0, 10)) })} · {t('hasta el {fecha}', { fecha: day(m.valid_until) })}</div>
        </div>
        <span className={'pill ' + (m.status === 'valid' ? (m.needs_physician ? 'warn' : 'ok') : 'bad')}>
          {m.status === 'expired' ? t('Caducado') : m.status === 'needs_physician' ? t('Falta el médico') : m.needs_physician ? t('Apto con evaluación médica') : t('Todo NO')}
        </span>
      </div>
      {yes.length === 0 ? <p className="small">{t('Ha respondido NO a todas las preguntas.')}</p> : (
        <ul className="mq-yes">
          {yes.map(([q, box, text]) => (
            <li key={q}><b>{t('SÍ')}</b> · {t(text)}
              {box && m.boxes?.[box] && <ul>{BOXES[box].map((bt, i) => m.boxes[box][i] && <li key={i}>{t(bt)}</li>)}</ul>}
            </li>
          ))}
        </ul>
      )}
      {m.physician && <div className="small" style={{ margin: '8px 0' }}><b>{t('Evaluación del médico')}:</b> {m.physician.name}{m.physician.clinic ? ' · ' + m.physician.clinic : ''} · {day(m.physician.date)}
        {docUrl && <div><button type="button" className="linkish" onClick={docUrl}>{t('Ver documento')}</button></div>}</div>}
      {m.signature && <SignatureView d={m.signature} />}
      <p className="small muted no-print">{who}</p>
    </div>
  )
}

// El centro (o el guía de la salida) abre el cuestionario de un buceador desde la agenda: cada apertura queda registrada
export function MedicalButton({ bookingId, name }) {
  const [open, setOpen] = useState(false)
  const [m, setM] = useState(null)
  const [err, setErr] = useState('')
  async function show() {
    setOpen(true); setErr(''); setM(null)
    const { data, error } = await supabase.rpc('medical_for_booking', { p_booking: bookingId })
    if (error) return setErr(errMsg(error))
    setM(data)
  }
  async function doc() {
    const { data, error } = await supabase.rpc('medical_doc_url', { p_booking: bookingId })
    if (!error && data?.url) window.open(data.url, '_blank', 'noopener')
  }
  return (
    <>
      <button type="button" className="linkish small" onClick={show}>{t('Cuestionario médico')}</button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={t('Cuestionario médico de {n}', { n: name })} onClick={() => setOpen(false)}>
          <div className="modal-card mq-modal print-only-this" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-x no-print" onClick={() => setOpen(false)} aria-label={t('Cerrar')}><Icon icon={X} /></button>
            <h2>{t('Cuestionario médico')}</h2>
            {err && <div className="msg err" role="alert">{err}</div>}
            {!m && !err && <p className="muted small">{t('Cargando…')}</p>}
            {m?.status === 'none' && <p className="small">{t('Este buceador aún no ha firmado el cuestionario en la app. Pídele que lo haga desde su perfil o que lo traiga en papel.')}</p>}
            {m && m.status !== 'none' && <MedicalSheet m={m} docUrl={m.has_doc ? doc : null} who={t('Confidencial. El buceador ve que lo has consultado. No lo descargues ni lo compartas fuera del centro.')} />}
            {m && m.status !== 'none' && <button type="button" className="btn small ghost no-print" onClick={() => window.print()}><Icon icon={Printer} size={16} /> {t('Imprimir para el archivo del centro')}</button>}
          </div>
        </div>
      )}
    </>
  )
}

// En el perfil: estado, formulario, ver lo firmado, quién lo ha consultado, borrar
export function MedicalPanel({ diver, onSaved, compact }) {
  const [me, setMe] = useState(null)
  const [mode, setMode] = useState('view')
  const [showLog, setShowLog] = useState(false)
  const load = () => supabase.rpc('my_medical', {}).then(({ data }) => setMe(data || { status: 'none' }))
  useEffect(() => { load() }, [diver?.id])
  const finished = () => { load(); onSaved?.() }
  if (!me) return <p className="muted small">{t('Cargando…')}</p>
  if (mode === 'form' || (me.status === 'none' && !compact && mode !== 'closed'))
    return <><h3 style={{ marginTop: 0 }}>{t('Cuestionario médico para bucear')}</h3><MedicalForm diver={diver} onDone={finished} onCancel={me.status === 'none' ? null : () => setMode('view')} /></>
  const f = me.form
  async function remove() {
    if (!window.confirm(t('¿Borrar tu cuestionario médico? Tendrás que volver a rellenarlo para reservar inmersiones.'))) return
    await supabase.rpc('medical_delete_mine', {}); finished()
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="small">
          {me.status === 'valid' && <><Icon icon={Check} size={16} className="ok-ic" /> <b>{t('Cuestionario médico al día')}</b> · {t('hasta el {fecha}', { fecha: day(f.valid_until) })}</>}
          {me.status === 'needs_physician' && <><Icon icon={TriangleAlert} size={16} /> <b>{t('Falta la evaluación del médico')}</b></>}
          {me.status === 'expired' && <b>{t('Tu cuestionario médico caducó')}</b>}
          {me.status === 'none' && <b>{t('Falta el cuestionario médico')}</b>}
        </span>
        <button type="button" className={'btn small' + (me.status === 'valid' ? ' ghost' : '')} onClick={() => setMode('form')}>
          {me.status === 'none' ? t('Rellenar y firmar (3 min)') : me.status === 'valid' ? t('Actualizar') : t('Renovar (3 min)')}</button>
      </div>
      {me.status === 'needs_physician' && <PhysicianUpload formId={f.id} onDone={finished} />}
      {f && !compact && (
        <details className="mq-details">
          <summary className="small">{t('Ver lo que firmaste y quién lo ha consultado')}</summary>
          <MedicalSheet m={{ ...f, status: me.status }} docUrl={f.has_doc ? async () => { const { data } = await supabase.rpc('medical_doc_url', {}); if (data?.url) window.open(data.url, '_blank', 'noopener') } : null}
            who={me.access?.length ? '' : t('Ningún centro lo ha consultado todavía.')} />
          {me.access?.length > 0 && (
            <>
              <button type="button" className="linkish small" onClick={() => setShowLog(!showLog)}>{t('Consultado {n} veces', { n: me.access.length })}</button>
              {showLog && <ul className="small mq-log">{me.access.map((a, i) => <li key={i}>{a.who} · {new Date(a.at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}</li>)}</ul>}
            </>
          )}
          <button type="button" className="linkish small danger" onClick={remove}>{t('Borrar mi cuestionario')}</button>
        </details>
      )}
    </div>
  )
}
