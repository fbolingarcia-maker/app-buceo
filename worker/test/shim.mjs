// Simuladores para probar el Worker en Node sin red: D1 sobre node:sqlite y R2 en memoria.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params }
  bind(...p) {
    for (const v of p) if (v === undefined || typeof v === 'boolean' || (typeof v === 'object' && v !== null && !(v instanceof Uint8Array))) throw new Error('D1_TYPE_ERROR: tipo no admitido ' + typeof v + ' en ' + this.sql.slice(0, 60))
    // D1 guarda los enteros de JS como INTEGER; con SHIM_REAL=1 se prueban como REAL (lo peor que puede pasar)
    return new Stmt(this.db, this.sql, process.env.SHIM_REAL ? p : p.map((v) => (Number.isInteger(v) ? BigInt(v) : v)))
  }
  _exec() {
    const st = this.db.prepare(this.sql)
    const reader = /^\s*(SELECT|WITH|PRAGMA\s+table_info)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)
    if (reader) return { results: st.all(...this.params).map((r) => ({ ...r })), success: true, meta: { changes: 0 } }
    const r = st.run(...this.params)
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }
  async all() { await tick(); return this._exec() }
  async run() { await tick(); return this._exec() }
  async first(col) { await tick(); const r = this._exec().results[0] || null; return col ? r?.[col] ?? null : r }
}
// Cede el turno entre consultas para que las peticiones concurrentes se intercalen como en producción
const tick = () => new Promise((r) => setImmediate(r))

export class D1 {
  constructor(schemaPath) {
    this.db = new DatabaseSync(':memory:')
    this.db.exec(fs.readFileSync(schemaPath, 'utf8'))
    this.db.exec('PRAGMA foreign_keys = ON')
  }
  prepare(sql) { return new Stmt(this.db, sql) }
  async batch(stmts) {
    await tick()
    this.db.exec('BEGIN')
    try { const out = stmts.map((s) => s._exec()); this.db.exec('COMMIT'); return out } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  async exec(sql) { this.db.exec(sql) }
}

export class R2 {
  constructor() { this.m = new Map() }
  async put(k, v, o = {}) { this.m.set(k, { body: v, httpMetadata: o.httpMetadata || {} }) }
  async get(k) { const o = this.m.get(k); return o ? { body: o.body, httpMetadata: o.httpMetadata } : null }
  async head(k) { return this.m.has(k) ? {} : null }
  async delete(ks) { for (const k of [].concat(ks)) this.m.delete(k) }
}
