// Consultas a tablas desde el frontend: el subconjunto de PostgREST que usa la app
// (select con tablas incrustadas, filtros, orden, límite, count, single; insert, update, upsert y delete),
// siempre pasando por las políticas de policies.js. Recibe JSON de src/lib/cf-client.js.
import { TABLES, VIEWS, TYPES, FKS, pkOf } from './schema.js'
import { POLICIES, HIDDEN, PROTECTED, and, or, P, YES, NO } from './policies.js'
import { ApiError, fail, outRow, inVal, all, first, uuid, nowIso } from './lib/util.js'

const MAX_ROWS = 5000
const CHUNK = 80 // D1 admite 100 parámetros por consulta

const isTable = (t) => !!POLICIES[t] && (TABLES[t] || VIEWS[t]) && !TABLES[t]?.internal
const cols = (t) => Object.keys(TYPES[t])
const readable = (t) => cols(t).filter((c) => !(HIDDEN[t] || []).includes(c))
function checkCol(t, c) {
  if (!TYPES[t] || !Object.hasOwn(TYPES[t], c)) fail('BAD_COLUMN', `columna desconocida: ${t}.${c}`)
  return c
}

// MFA: con la verificación en dos pasos activada y sin el código, todo se deniega (política restrictiva mfa_required)
const policy = (ctx, t, kind, alias) => {
  if (ctx.uid && !ctx.mfaOk) return NO
  const p = POLICIES[t]
  const f = p?.[kind]
  return f ? f(ctx, alias) : NO
}

// ── select: 'id, name, trips!inner(id, centers(name)), centers:verified_by(name)' ──
export function parseSelect(s) {
  const items = []
  let i = 0
  const str = (s || '*').replace(/\s+/g, ' ')
  function list() {
    const out = []
    while (i < str.length) {
      while (str[i] === ' ' || str[i] === ',') i++
      if (str[i] === ')' || i >= str.length) break
      let tok = ''
      while (i < str.length && !'(),'.includes(str[i])) tok += str[i++]
      tok = tok.trim()
      if (str[i] === '(') {
        i++
        const children = list()
        i++ // ')'
        const m = /^(?:(\w+):)?(\w+)(!inner)?$/.exec(tok)
        if (!m) fail('BAD_SELECT', tok)
        out.push({ embed: true, alias: m[1] || m[2], name: m[2], inner: !!m[3], children })
      } else if (tok) out.push({ col: tok })
    }
    return out
  }
  items.push(...list())
  return items
}

// Relación entre la tabla padre y la incrustada (como PostgREST: por clave foránea)
function relation(parent, item) {
  // alias:columna(...) → la columna es la FK del padre
  if (item.alias !== item.name && TYPES[parent]?.[item.name]) {
    const fk = FKS.find((f) => f.from === parent && f.col === item.name)
    if (fk) return { kind: 'one', table: fk.to, local: fk.col, remote: fk.toCol }
  }
  const t = item.name
  if (!isTable(t)) fail('BAD_SELECT', `tabla desconocida: ${t}`)
  const down = FKS.filter((f) => f.from === parent && f.to === t)
  if (down.length === 1) return { kind: 'one', table: t, local: down[0].col, remote: down[0].toCol }
  const up = FKS.filter((f) => f.from === t && f.to === parent)
  if (up.length === 1) return { kind: 'many', table: t, local: up[0].toCol, remote: up[0].col }
  if (down.length > 1 || up.length > 1) fail('BAD_SELECT', `relación ambigua ${parent} → ${t}`)
  fail('BAD_SELECT', `sin relación ${parent} → ${t}`)
}

// ── filtros ──
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
function filterSql(t, alias, [col, op, val]) {
  checkCol(t, col)
  const c = `${alias}.${col}`
  if (OPS[op]) return P(`${c} ${OPS[op]} ?`, inVal(t, col, val))
  if (op === 'in') {
    const arr = Array.isArray(val) ? val : []
    if (!arr.length) return P('0')
    return P(`${c} IN (${arr.map(() => '?').join(',')})`, ...arr.map((v) => inVal(t, col, v)))
  }
  if (op === 'is') {
    if (val === null || val === 'null') return P(`${c} IS NULL`)
    if (val === true || val === 'true') return P(`${c} = 1`)
    if (val === false || val === 'false') return P(`${c} = 0`)
    fail('BAD_FILTER', 'is')
  }
  if (op === 'like') return P(`${c} GLOB ?`, String(val).replace(/[*?[\]]/g, '[$&]').replace(/%/g, '*').replace(/_/g, '?'))
  if (op === 'ilike') return P(`${c} LIKE ? ESCAPE '\\'`, String(val))
  if (op.startsWith('not.')) { const inner = filterSql(t, alias, [col, op.slice(4), val]); return P(`NOT (${inner.sql})`, ...inner.params) }
  fail('BAD_FILTER', op)
}
// .or('listing_status.neq.socio,verification_status.eq.verified')
function orSql(t, alias, s) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch }
  if (cur) parts.push(cur)
  return or(...parts.map((p) => {
    const m = /^(\w+)\.(not\.)?(\w+)\.(.*)$/.exec(p.trim())
    if (!m) fail('BAD_FILTER', p)
    let val = m[4]
    if (m[3] === 'in') val = val.replace(/^\(|\)$/g, '').split(',')
    return filterSql(t, alias, [m[1], (m[2] || '') + m[3], val])
  }).map((x) => (x.sql === '1' ? P('(1)') : x)))
}
// Separa los filtros de la tabla y los de las tablas incrustadas ('trips.center_id')
function splitFilters(filters = []) {
  const own = [], nested = {}
  for (const f of filters) {
    const i = f[0].indexOf('.')
    if (i < 0) own.push(f)
    else { const k = f[0].slice(0, i); (nested[k] = nested[k] || []).push([f[0].slice(i + 1), f[1], f[2]]) }
  }
  return { own, nested }
}

// ── lectura ──
async function fetchRows(ctx, t, { items, filters = [], orSql: orStr, order = [], limit, offset, count, head, where }) {
  const a = 't0'
  const pol = policy(ctx, t, 'select', a)
  if (pol.sql === '0') return { rows: [], count: 0 }
  const { own, nested } = splitFilters(filters)
  const conds = [pol, ...own.map((f) => filterSql(t, a, f))]
  if (orStr) conds.push(orSql(t, a, orStr))
  if (where) conds.push(where(a))
  // !inner: el padre solo sale si la tabla incrustada tiene filas visibles (y cumplen sus filtros)
  for (const it of items.filter((x) => x.embed && x.inner)) {
    const rel = relation(t, it)
    const b = 'e' + Math.random().toString(36).slice(2, 7)
    const sub = and(policy(ctx, rel.table, 'select', b), ...(nested[it.alias] || []).map((f) => filterSql(rel.table, b, f)))
    conds.push({ sql: `EXISTS (SELECT 1 FROM ${rel.table} ${b} WHERE ${b}.${rel.remote} = ${a}.${rel.local} AND ${sub.sql})`, params: sub.params })
  }
  const w = and(...conds)
  if (w.sql === '0') return { rows: [], count: 0 }
  let total
  if (count) total = (await first(ctx.db, `SELECT count(*) AS n FROM ${t} ${a} WHERE ${w.sql}`, ...w.params))?.n ?? 0
  if (head) return { rows: [], count: total }
  const wanted = new Set()
  let star = false
  for (const it of items) {
    if (it.embed) { const rel = relation(t, it); if (rel.kind === 'one') wanted.add(rel.local); else wanted.add(rel.local) } else if (it.col === '*') star = true
    else wanted.add(checkCol(t, it.col))
  }
  if (star) readable(t).forEach((c) => wanted.add(c))
  for (const c of wanted) if ((HIDDEN[t] || []).includes(c)) fail('FORBIDDEN', `columna privada: ${c}`, 403)
  const selCols = [...wanted]
  const ord = order.map(({ col, ascending = true, nullsFirst }) => {
    checkCol(t, col)
    const nf = nullsFirst ?? !ascending // Postgres: ASC NULLS LAST, DESC NULLS FIRST
    return `(${a}.${col} IS NULL) ${nf ? 'DESC' : 'ASC'}, ${a}.${col} ${ascending ? 'ASC' : 'DESC'}`
  })
  const lim = Math.min(Number.isFinite(+limit) && limit !== null ? +limit : MAX_ROWS, MAX_ROWS)
  const sql = `SELECT ${selCols.map((c) => `${a}.${c}`).join(', ') || '1 AS _'} FROM ${t} ${a} WHERE ${w.sql}${ord.length ? ' ORDER BY ' + ord.join(', ') : ''} LIMIT ${lim}${offset ? ' OFFSET ' + (+offset | 0) : ''}`
  let rows = (await all(ctx.db, sql, ...w.params)).map((r) => outRow(t, r))
  // tablas incrustadas
  for (const it of items.filter((x) => x.embed)) {
    const rel = relation(t, it)
    const keys = [...new Set(rows.map((r) => r[rel.local]).filter((v) => v !== null && v !== undefined))]
    const childItems = [...it.children]
    const extra = !childItems.some((c) => c.col === '*' || c.col === rel.remote)
    if (extra) childItems.push({ col: rel.remote })
    const found = []
    for (let i = 0; i < keys.length; i += CHUNK) {
      const part = keys.slice(i, i + CHUNK)
      const sub = await fetchRows(ctx, rel.table, { items: childItems, filters: nested[it.alias] || [], where: (b) => P(`${b}.${rel.remote} IN (${part.map(() => '?').join(',')})`, ...part) })
      found.push(...sub.rows)
    }
    const strip = (r) => { if (!extra) return r; const o = { ...r }; delete o[rel.remote]; return o }
    for (const r of rows) {
      const match = found.filter((c) => c[rel.remote] === r[rel.local])
      r[it.alias] = rel.kind === 'one' ? (match[0] ? strip(match[0]) : null) : match.map(strip)
    }
    if (it.inner) rows = rows.filter((r) => (rel.kind === 'one' ? r[it.alias] : r[it.alias].length))
  }
  // quita las columnas de unión que no se pidieron
  const asked = new Set(items.filter((x) => !x.embed).map((x) => x.col))
  if (!star) for (const r of rows) for (const k of Object.keys(r)) if (!asked.has(k) && !items.some((x) => x.embed && x.alias === k)) delete r[k]
  return { rows, count: total }
}

// Comprueba un predicado de política sobre los valores de una fila (WITH CHECK)
async function checkRow(ctx, t, row) {
  const a = 'n0'
  const pol = policy(ctx, t, 'check', a)
  if (pol.sql === '1') return true
  if (pol.sql === '0') return false
  const cs = cols(t)
  // (los ? del predicado van antes que los de la fila en el texto SQL)
  const r = await first(ctx.db, `SELECT ${pol.sql} AS ok FROM (SELECT ${cs.map((c) => `? AS ${c}`).join(', ')}) ${a}`, ...pol.params, ...cs.map((c) => inVal(t, c, row[c] ?? null)))
  return !!r?.ok
}

const pkWhere = (t, row, alias = '') => {
  const pk = pkOf(t)
  return P(pk.map((c) => `${alias}${c} = ?`).join(' AND '), ...pk.map((c) => inVal(t, c, row[c])))
}

// Reglas que en Supabase eran triggers
async function beforeWrite(ctx, t, op, row, old) {
  if (t === 'centers' && op === 'update' && !ctx.isAdmin && !ctx.trusted) {
    for (const c of PROTECTED.centers) if (JSON.stringify(row[c] ?? null) !== JSON.stringify(old[c] ?? null)) fail('FORBIDDEN', 'solo la plataforma puede cambiar la verificación del centro', 403)
  }
  if (t === 'trips' && row.status === 'published' && (op === 'insert' || old?.status !== 'published')) {
    const c = await first(ctx.db, "SELECT 1 AS ok FROM centers WHERE id = ? AND verification_status = 'verified'", row.center_id)
    if (!c) fail('NOT_VERIFIED', 'tu centro aún no está verificado. Podrás publicar salidas cuando lo validemos (puedes dejarlas en borrador).')
  }
}
function afterWrite(ctx, t, op, row, old) {
  const stmts = []
  if (t === 'trips' && op === 'update' && row.status === 'cancelled_weather' && old.status !== 'cancelled_weather') {
    stmts.push(ctx.db.prepare("UPDATE bookings SET status = 'cancelled_by_center', refund_php = paid_php, commission_php = 0, cancelled_at = ? WHERE trip_id = ? AND status IN ('pending_payment', 'confirmed')").bind(nowIso(), row.id))
  }
  return stmts
}

function cleanValues(t, v) {
  const o = {}
  for (const [k, val] of Object.entries(v || {})) { checkCol(t, k); o[k] = val }
  return o
}

// ── punto de entrada ──
// .single() / .maybeSingle(): un objeto en vez de una lista (mismo error que PostgREST)
function single(q, res) {
  if (!q.single || !Array.isArray(res.data)) return res
  const n = res.data.length
  if (n === 1) return { ...res, data: res.data[0] }
  if (n === 0 && q.single === 'maybe') return { ...res, data: null }
  throw new ApiError('PGRST116', 'JSON object requested, multiple (or no) rows returned', 406)
}

export async function handleRest(ctx, q) {
  const t = q.table
  if (!isTable(t)) fail('NOT_FOUND', 'tabla desconocida', 404)
  const items = parseSelect(q.select || '*')
  const op = q.op || 'select'
  const p = POLICIES[t]
  const result = async (pkRows) => {
    if (!q.returning) return { data: null }
    const rows = []
    for (const r of pkRows) {
      const got = await fetchRows(ctx, t, { items, where: (a) => pkWhere(t, r, a + '.') })
      rows.push(...got.rows)
    }
    return single(q, { data: rows })
  }

  if (op === 'select') {
    const { rows, count } = await fetchRows(ctx, t, { items, filters: q.filters, orSql: q.or, order: q.order, limit: q.limit, offset: q.offset, count: q.count, head: q.head })
    return single(q, { data: q.head ? null : rows, count: q.count ? count : null })
  }
  if (ctx.uid && !ctx.mfaOk) fail('MFA_REQUIRED', 'introduce el código de verificación en dos pasos', 403)
  if (!ctx.uid) fail('FORBIDDEN', 'inicia sesión', 401)
  if (VIEWS[t]) fail('FORBIDDEN', 'vista de solo lectura', 403)

  const writeOp = op === 'upsert' ? 'insert' : op
  if (!(p.ops || []).includes(writeOp)) fail('FORBIDDEN', 'no tienes permiso para esto', 403)

  if (op === 'insert' || op === 'upsert') {
    const list = (Array.isArray(q.values) ? q.values : [q.values]).map((v) => cleanValues(t, v))
    const pk = pkOf(t)
    const stmts = [], done = []
    for (const v of list) {
      if (op === 'upsert' && pk.every((c) => v[c] !== undefined)) {
        const old = await first(ctx.db, `SELECT * FROM ${t} WHERE ${pkWhere(t, v).sql}`, ...pkWhere(t, v).params)
        if (old) { // ON CONFLICT DO UPDATE: misma comprobación que un update
          const w = policy(ctx, t, 'write', 'x')
          const ok = w.sql === '1' || (w.sql !== '0' && await first(ctx.db, `SELECT 1 AS ok FROM ${t} x WHERE ${pkWhere(t, v, 'x.').sql} AND ${w.sql}`, ...pkWhere(t, v).params, ...w.params))
          if (!ok) fail('FORBIDDEN', 'no tienes permiso para esto', 403)
          const merged = { ...outRow(t, old), ...v }
          await beforeWrite(ctx, t, 'update', merged, outRow(t, old))
          if (!(await checkRow(ctx, t, merged))) fail('FORBIDDEN', 'no tienes permiso para esto', 403)
          const sets = Object.keys(v).filter((c) => !pk.includes(c))
          if (sets.length) stmts.push(ctx.db.prepare(`UPDATE ${t} SET ${sets.map((c) => `${c} = ?`).join(', ')} WHERE ${pkWhere(t, v).sql}`).bind(...sets.map((c) => inVal(t, c, v[c])), ...pkWhere(t, v).params))
          done.push(v)
          continue
        }
      }
      const row = { ...v }
      if (pk.length === 1 && row[pk[0]] === undefined && TYPES[t][pk[0]] === 'uuid') row[pk[0]] = uuid()
      // valores por defecto que necesitan las comprobaciones
      if (t === 'trips' && row.status === undefined) row.status = 'draft'
      await beforeWrite(ctx, t, 'insert', row)
      if (!(await checkRow(ctx, t, row))) fail('FORBIDDEN', 'no tienes permiso para esto', 403)
      const cs = Object.keys(row)
      stmts.push(ctx.db.prepare(`INSERT INTO ${t} (${cs.join(', ')}) VALUES (${cs.map(() => '?').join(', ')})`).bind(...cs.map((c) => inVal(t, c, row[c]))))
      done.push(row)
    }
    if (stmts.length) await ctx.db.batch(stmts)
    return result(done)
  }

  // update / delete: filas visibles que cumplen los filtros y la política USING
  const w = policy(ctx, t, 'write', 't0')
  if (w.sql === '0') return { data: q.returning ? [] : null }
  const { own } = splitFilters(q.filters)
  const conds = and(w, policy(ctx, t, 'select', 't0'), ...own.map((f) => filterSql(t, 't0', f)), ...(q.or ? [orSql(t, 't0', q.or)] : []))
  if (!own.length && !q.or) fail('BAD_REQUEST', 'falta un filtro')
  if (conds.sql === '0') return { data: q.returning ? [] : null }
  const targets = (await all(ctx.db, `SELECT * FROM ${t} t0 WHERE ${conds.sql} LIMIT ${MAX_ROWS}`, ...conds.params)).map((r) => outRow(t, r))

  if (op === 'delete') {
    const before = q.returning ? (await result(targets)).data : null
    if (targets.length) await ctx.db.batch(targets.map((r) => ctx.db.prepare(`DELETE FROM ${t} WHERE ${pkWhere(t, r).sql}`).bind(...pkWhere(t, r).params)))
    return { data: before }
  }
  if (op === 'update') {
    const v = cleanValues(t, q.values)
    const sets = Object.keys(v)
    if (!sets.length) return result(targets)
    const stmts = []
    const newRows = []
    for (const old of targets) {
      const row = { ...old, ...v }
      await beforeWrite(ctx, t, 'update', row, old)
      if (!(await checkRow(ctx, t, row))) fail('FORBIDDEN', 'no tienes permiso para esto', 403)
      stmts.push(ctx.db.prepare(`UPDATE ${t} SET ${sets.map((c) => `${c} = ?`).join(', ')} WHERE ${pkWhere(t, old).sql}`).bind(...sets.map((c) => inVal(t, c, v[c])), ...pkWhere(t, old).params))
      stmts.push(...afterWrite(ctx, t, 'update', row, old))
      newRows.push(row)
    }
    if (stmts.length) await ctx.db.batch(stmts)
    return result(newRows)
  }
  fail('BAD_REQUEST', 'operación no válida')
}

// Para las RPC: lee filas con las mismas políticas (p. ej. devolver la reserva creada)
export const readRows = fetchRows
export { ApiError }
