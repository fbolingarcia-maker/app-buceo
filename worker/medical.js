// Cuestionario médico del buceador, rellenado y firmado en la app (27 nov 2026).
// - Preguntas: las 10 del estándar internacional para buceo recreativo (WRSTC/UHMS 2020, el que usan PADI, SSI y la
//   mayoría de agencias) redactadas con nuestras palabras, con sus bloques A–G de preguntas de detalle (src/lib/medicalForm.jsx).
//   Regla: un SÍ en las preguntas 3, 5 o 10, o en cualquier pregunta de detalle, pide la evaluación de un médico.
// - Firma: el buceador escribe su nombre y firma con el dedo (trazo SVG); queda la fecha y hora de la firma.
// - Confidencial (dato de salud; Data Privacy Act de Filipinas, RA 10173, y RGPD):
//   · respuestas, firma y datos del médico se guardan cifrados (AES-GCM, clave 'medical' derivada de AUTH_SECRET);
//   · solo los ven el propio buceador y, para una reserva activa (de 30 días antes a 30 días después de la salida),
//     el equipo del centro de esa salida y los guías asignados a ella. Ni los administradores de DivingSlot ni otros centros;
//   · cada consulta del centro queda registrada y el buceador ve quién lo ha mirado y cuándo;
//   · los avisos (push) no llevan ningún dato de salud;
//   · se borra solo 3 meses después de caducar (12 meses + 3), al borrarlo el buceador o al eliminar su cuenta;
//   · la evaluación del médico (foto o PDF) va al almacén privado del buceador (dive-photos/<user_id>/medico/…) y el
//     centro solo la abre con un enlace firmado de 10 minutos.
// Las tablas se crean solas (ensureMedical) y también están en schema.js para las pruebas.
import { fail, nowIso, uuid, all, first, run } from './lib/util.js'
import { rateLimit } from './auth.js'
import { notifyCentreStaff } from './push.js'
import { encryptFor, decryptFor } from './lib/crypto.js'
import { signedObjectUrl } from './storage.js'

const mfa = (ctx) => { if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403) }
const later = (ctx, p) => { const q = p.catch((e) => console.error('médico aviso', e.message)); if (ctx.waitUntil) ctx.waitUntil(q); return q }
export const VERSION = 'wrstc-2020-ds1'
const VALID_DAYS = 365, KEEP_AFTER_DAYS = 90
const WINDOW_BEFORE = 30, WINDOW_AFTER = 30 // el centro lo ve de 30 días antes a 30 días después de la salida
// Preguntas principales y su bloque de detalle (null = un SÍ ya pide médico)
export const MAIN = { q1: 'A', q2: 'B', q3: null, q4: 'C', q5: null, q6: 'D', q7: 'E', q8: 'F', q9: 'G', q10: null }
export const BOX_SIZE = { A: 5, B: 4, C: 4, D: 5, E: 4, F: 5, G: 6 } // = BOXES de src/lib/medicalForm.jsx

let ready = false
export async function ensureMedical(db) {
  if (ready) return
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS medical_forms (
      id TEXT PRIMARY KEY, diver_id TEXT NOT NULL REFERENCES divers(id) ON DELETE CASCADE, user_id TEXT,
      version TEXT NOT NULL, payload TEXT NOT NULL, needs_physician INTEGER NOT NULL DEFAULT 0,
      physician_cleared INTEGER NOT NULL DEFAULT 0, doc_path TEXT, signed_at TEXT NOT NULL, valid_until TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare('CREATE INDEX IF NOT EXISTS medical_forms_d ON medical_forms (diver_id, signed_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS medical_access (
      id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES medical_forms(id) ON DELETE CASCADE, center_id TEXT,
      user_id TEXT, who TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare('CREATE INDEX IF NOT EXISTS medical_access_f ON medical_access (form_id, at)'),
  ])
  ready = true
}

const seal = (ctx, obj) => encryptFor(ctx.env.AUTH_SECRET, 'medical', JSON.stringify(obj))
const open = async (ctx, boxed) => { try { return JSON.parse(await decryptFor(ctx.env.AUTH_SECRET, 'medical', boxed)) } catch (e) { return null } }
const today = () => new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

// Valida las respuestas y calcula si hace falta médico
export function evaluate(answers, boxes) {
  const a = answers && typeof answers === 'object' ? answers : {}
  const bx = boxes && typeof boxes === 'object' ? boxes : {}
  const outA = {}, outB = {}
  let needs = false
  for (const [q, box] of Object.entries(MAIN)) {
    if (typeof a[q] !== 'boolean') fail('INCOMPLETE', 'responde a todas las preguntas')
    outA[q] = a[q]
    if (!a[q]) continue
    if (!box) { needs = true; continue }
    const v = bx[box]
    if (!Array.isArray(v) || v.length !== BOX_SIZE[box] || v.some((x) => typeof x !== 'boolean')) fail('INCOMPLETE', 'responde a las preguntas de detalle del bloque ' + box)
    outB[box] = v
    if (v.some(Boolean)) needs = true
  }
  return { answers: outA, boxes: outB, needs }
}

function cleanSignature(sig) {
  const s = String(sig || '')
  // Trazo SVG: solo comandos M/L/Q y números (nada de etiquetas ni scripts)
  if (s.length < 20 || s.length > 60000 || !/^[MLQ0-9.,\s-]+$/.test(s)) fail('BAD_SIGNATURE', 'firma con el dedo en el recuadro')
  return s
}

async function current(ctx, diverId) {
  await ensureMedical(ctx.db)
  return first(ctx.db, 'SELECT * FROM medical_forms WHERE diver_id = ? ORDER BY signed_at DESC LIMIT 1', diverId)
}

// Estado del cuestionario: 'valid' (al día), 'needs_physician' (firmado, falta la evaluación del médico), 'expired', 'none'
function statusOf(f) {
  if (!f) return 'none'
  if (f.valid_until < today()) return 'expired'
  if (f.needs_physician && !f.physician_cleared) return 'needs_physician'
  return 'valid'
}

// Reserva a la que pertenece el acceso del centro (o del guía asignado) y si está dentro de la ventana
async function staffAccess(ctx, bookingId) {
  mfa(ctx)
  if (!ctx.uid) fail('FORBIDDEN', 'inicia sesión', 401)
  const b = await first(ctx.db, `SELECT b.id, b.diver_id, b.status, t.id AS trip_id, t.center_id, t.departs_at, c.name AS center_name
    FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN centers c ON c.id = t.center_id WHERE b.id = ?`, String(bookingId || ''))
  if (!b || !b.diver_id) fail('NOT_FOUND', 'no encontramos esta reserva', 404)
  let role = null
  if (ctx.staff.includes(b.center_id)) role = 'centre'
  else if (await first(ctx.db, 'SELECT 1 AS x FROM trip_guides WHERE trip_id = ? AND user_id = ?', b.trip_id, ctx.uid)) role = 'guide'
  if (!role) fail('FORBIDDEN', 'solo el centro de la salida y sus guías pueden ver el cuestionario médico', 403)
  if (!['confirmed', 'pending_payment'].includes(b.status)) fail('FORBIDDEN', 'la reserva no está activa', 403)
  const dep = Date.parse(b.departs_at)
  if (Date.now() < dep - WINDOW_BEFORE * 864e5 || Date.now() > dep + WINDOW_AFTER * 864e5) fail('FORBIDDEN', 'el cuestionario solo se puede ver de 30 días antes a 30 días después de la salida', 403)
  return { b, role }
}

export const MEDICAL = {
  // El buceador: su cuestionario (descifrado), estado y quién lo ha consultado
  async my_medical(ctx) {
    mfa(ctx)
    if (!ctx.diverId) fail('NO_PROFILE', 'crea tu perfil de buceador')
    const f = await current(ctx, ctx.diverId)
    if (!f) return { status: 'none', version: VERSION }
    const p = await open(ctx, f.payload)
    const log = await all(ctx.db, 'SELECT who, at FROM medical_access WHERE form_id = ? ORDER BY at DESC LIMIT 50', f.id)
    return { status: statusOf(f), version: VERSION, form: { id: f.id, signed_at: f.signed_at, valid_until: f.valid_until, needs_physician: !!f.needs_physician,
      physician_cleared: !!f.physician_cleared, has_doc: !!f.doc_path, ...(p || {}) }, access: log }
  },

  // Firmar el cuestionario: respuestas + nombre + firma (+ datos del médico si hace falta y ya los tiene)
  async medical_sign(ctx, { p_answers, p_boxes, p_name, p_birth_date, p_signature, p_physician = null, p_lang = 'es' }) {
    mfa(ctx)
    if (!ctx.diverId) fail('NO_PROFILE', 'crea tu perfil de buceador')
    await ensureMedical(ctx.db)
    await rateLimit(ctx.env, 'medical:' + ctx.uid, 10, 3600)
    const { answers, boxes, needs } = evaluate(p_answers, p_boxes)
    const name = String(p_name || '').trim().slice(0, 120)
    if (name.length < 3) fail('BAD_NAME', 'escribe tu nombre completo')
    const birth = /^\d{4}-\d{2}-\d{2}$/.test(String(p_birth_date || '')) ? p_birth_date : null
    if (!birth) fail('BAD_BIRTH', 'pon tu fecha de nacimiento')
    const signature = cleanSignature(p_signature)
    let physician = null, cleared = 0, docPath = null
    if (needs && p_physician) {
      const ph = p_physician
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(ph.date || '')) ? ph.date : null
      if (!String(ph.name || '').trim() || !date) fail('BAD_PHYSICIAN', 'pon el nombre del médico y la fecha de su evaluación')
      if (date < addDays(today(), -VALID_DAYS) || date > today()) fail('BAD_PHYSICIAN', 'la evaluación del médico debe ser de los últimos 12 meses')
      const path = String(ph.doc_path || '')
      if (path && !path.startsWith(ctx.uid + '/medico/')) fail('BAD_PATH', 'documento no válido')
      physician = { name: String(ph.name).trim().slice(0, 120), date, clinic: String(ph.clinic || '').trim().slice(0, 160) }
      docPath = path || null
      cleared = docPath ? 1 : 0
    }
    const signedAt = nowIso(), id = uuid()
    const validUntil = addDays(today(), VALID_DAYS)
    const payload = await seal(ctx, { answers, boxes, name, birth_date: birth, signature, physician, lang: String(p_lang).slice(0, 5), ua: '' })
    await run(ctx.db, `INSERT INTO medical_forms (id, diver_id, user_id, version, payload, needs_physician, physician_cleared, doc_path, signed_at, valid_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, ctx.diverId, ctx.uid, VERSION, payload, needs ? 1 : 0, cleared, docPath, signedAt, validUntil)
    // El resultado (sin respuestas) es lo que ya usan la reserva y el manifiesto
    if (!needs || cleared) await run(ctx.db, 'UPDATE divers SET medical_result = ?, medical_done_at = ? WHERE id = ?', needs ? 'physician_ok' : 'all_no', today(), ctx.diverId)
    else await run(ctx.db, 'UPDATE divers SET medical_result = NULL, medical_done_at = NULL WHERE id = ?', ctx.diverId)
    // Aviso a los centros de sus próximas salidas, sin ningún dato de salud
    const upcoming = await all(ctx.db, `SELECT DISTINCT t.center_id FROM bookings b JOIN trips t ON t.id = b.trip_id
      WHERE b.diver_id = ? AND b.status IN ('confirmed', 'pending_payment') AND t.departs_at > ?`, ctx.diverId, nowIso())
    const d = await first(ctx.db, 'SELECT full_name FROM divers WHERE id = ?', ctx.diverId)
    for (const c of upcoming) later(ctx, notifyCentreStaff(ctx.env, c.center_id, { title: d?.full_name || 'DivingSlot', body: 'Cuestionario médico firmado · Medical form signed', url: '/centro/agenda', tag: 'medical-' + ctx.diverId }))
    return { id, status: needs && !cleared ? 'needs_physician' : 'valid', valid_until: validUntil, needs_physician: needs }
  },

  // Añadir la evaluación del médico a un cuestionario ya firmado
  async medical_add_physician(ctx, { p_form, p_name, p_date, p_clinic = '', p_doc_path }) {
    mfa(ctx)
    await ensureMedical(ctx.db)
    const f = await first(ctx.db, 'SELECT * FROM medical_forms WHERE id = ? AND diver_id = ?', String(p_form || ''), ctx.diverId || '')
    if (!f) fail('NOT_FOUND', 'cuestionario no encontrado', 404)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(p_date || '')) ? p_date : null
    if (!String(p_name || '').trim() || !date || date > today() || date < addDays(today(), -VALID_DAYS)) fail('BAD_PHYSICIAN', 'pon el nombre del médico y la fecha de su evaluación (últimos 12 meses)')
    const path = String(p_doc_path || '')
    if (!path.startsWith(ctx.uid + '/medico/')) fail('BAD_PATH', 'sube la evaluación firmada por el médico (foto o PDF)')
    const p = (await open(ctx, f.payload)) || {}
    p.physician = { name: String(p_name).trim().slice(0, 120), date, clinic: String(p_clinic || '').trim().slice(0, 160) }
    await run(ctx.db, 'UPDATE medical_forms SET payload = ?, physician_cleared = 1, doc_path = ? WHERE id = ?', await seal(ctx, p), path, f.id)
    if (f.id === (await current(ctx, ctx.diverId))?.id) await run(ctx.db, "UPDATE divers SET medical_result = 'physician_ok', medical_done_at = ? WHERE id = ?", today(), ctx.diverId)
    return { status: 'valid' }
  },

  // El buceador borra sus cuestionarios (derecho de supresión); deja de estar «al día»
  async medical_delete_mine(ctx) {
    mfa(ctx)
    if (!ctx.diverId) fail('NO_PROFILE', 'crea tu perfil de buceador')
    await ensureMedical(ctx.db)
    const docs = await all(ctx.db, 'SELECT doc_path FROM medical_forms WHERE diver_id = ? AND doc_path IS NOT NULL', ctx.diverId)
    await ctx.db.batch([
      ctx.db.prepare('DELETE FROM medical_access WHERE form_id IN (SELECT id FROM medical_forms WHERE diver_id = ?)').bind(ctx.diverId),
      ctx.db.prepare('DELETE FROM medical_forms WHERE diver_id = ?').bind(ctx.diverId),
      ctx.db.prepare('UPDATE divers SET medical_result = NULL, medical_done_at = NULL WHERE id = ?').bind(ctx.diverId),
    ])
    for (const d of docs) await ctx.env.DIVE_PHOTOS?.delete(d.doc_path).catch(() => {})
    return { deleted: true }
  },

  // El centro (o el guía asignado) ve el cuestionario de un buceador de una reserva activa; queda registrado
  async medical_for_booking(ctx, { p_booking }) {
    const { b, role } = await staffAccess(ctx, p_booking)
    const f = await current(ctx, b.diver_id)
    if (!f) return { status: 'none' }
    const p = await open(ctx, f.payload)
    const who = (role === 'guide' ? 'Guía · ' : '') + b.center_name
    await run(ctx.db, 'INSERT INTO medical_access (id, form_id, center_id, user_id, who) VALUES (?, ?, ?, ?, ?)', uuid(), f.id, b.center_id, ctx.uid, who)
    return { status: statusOf(f), version: f.version, signed_at: f.signed_at, valid_until: f.valid_until, needs_physician: !!f.needs_physician,
      physician_cleared: !!f.physician_cleared, has_doc: !!f.doc_path, answers: p?.answers || {}, boxes: p?.boxes || {}, name: p?.name || '',
      birth_date: p?.birth_date || null, signature: p?.signature || '', physician: p?.physician || null, lang: p?.lang || 'es' }
  },

  // Enlace de 10 minutos a la evaluación del médico (el propio buceador o el centro/guía de una reserva activa)
  async medical_doc_url(ctx, { p_booking = null }) {
    mfa(ctx)
    let diverId = ctx.diverId, acc = null
    if (p_booking) { acc = await staffAccess(ctx, p_booking); diverId = acc.b.diver_id }
    if (!diverId) fail('FORBIDDEN', null, 403)
    const f = await current(ctx, diverId)
    if (!f?.doc_path) fail('NOT_FOUND', 'no hay evaluación del médico', 404)
    if (acc) await run(ctx.db, 'INSERT INTO medical_access (id, form_id, center_id, user_id, who) VALUES (?, ?, ?, ?, ?)', uuid(), f.id, acc.b.center_id, ctx.uid,
      (acc.role === 'guide' ? 'Guía · ' : '') + acc.b.center_name + ' · evaluación del médico')
    return { url: await signedObjectUrl(ctx.env, 'dive-photos', f.doc_path, 600) }
  },
}

// Cron diario: borra los cuestionarios caducados hace más de 3 meses (y su evaluación del médico)
export async function purgeMedical(env) {
  await ensureMedical(env.DB)
  const limit = addDays(today(), -KEEP_AFTER_DAYS)
  const old = await env.DB.prepare('SELECT id, doc_path FROM medical_forms WHERE valid_until < ?').bind(limit).all()
  for (const f of old.results || []) {
    if (f.doc_path) await env.DIVE_PHOTOS?.delete(f.doc_path).catch(() => {})
    await env.DB.batch([env.DB.prepare('DELETE FROM medical_access WHERE form_id = ?').bind(f.id), env.DB.prepare('DELETE FROM medical_forms WHERE id = ?').bind(f.id)])
  }
  return { purged: (old.results || []).length }
}

// Al eliminar la cuenta del buceador
export async function deleteDiverMedical(db, diverId) {
  await ensureMedical(db)
  return [
    db.prepare('DELETE FROM medical_access WHERE form_id IN (SELECT id FROM medical_forms WHERE diver_id = ?)').bind(diverId),
    db.prepare('DELETE FROM medical_forms WHERE diver_id = ?').bind(diverId),
  ]
}
