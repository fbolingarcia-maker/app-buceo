// Copia de datos Supabase → D1 para el cambio a Cloudflare (se usa una vez, el día del cambio, o para ensayarlo).
//   POST /api/import          Supabase manda las sentencias por trozos (private.export_to_d1, migración 034), con la
//                             cabecera X-Notify-Key = NOTIFY_KEY. Cuerpo: { run, seq, total, reset, statements: [...] }.
//                             Los trozos se guardan en import_chunks; al llegar el último se ejecuta TODO en un solo
//                             lote de D1 (una transacción: o entra todo o no cambia nada).
//   GET  /api/import/status?run=…   cómo va (trozos recibidos, estado, filas por tabla al terminar).
// Seguridad:
//   · Solo se aceptan sentencias con la forma exacta que genera la exportación: INSERT INTO <tabla conocida> (<sus
//     columnas>) VALUES (<literales>); DELETE FROM <tabla>; y PRAGMA defer_foreign_keys. Nada de SQL libre.
//   · En cuanto la app está en marcha en Cloudflare (3 o más personas que no son administradores han entrado después
//     de la última importación), la importación se cierra para siempre: no se puede pisar la base de datos de una app
//     en uso. Para ensayar se puede entrar con alguna cuenta de prueba y repetir la importación sin problema.
//     El cron lo comprueba cada hora (cron.js), así que se cierra aunque nadie vuelva a intentar importar.
//   · reset: true borra y vuelve a crear todas las tablas (excepto visitas, avisos e importaciones) con el esquema
//     actual de schema.js: así D1 queda al día aunque se creara con una versión antigua. Cierra todas las sesiones.
import { json, fail, nowIso } from './lib/util.js'
import { safeEqual } from './lib/crypto.js'
import { TABLES, VIEWS, schemaSql } from './schema.js'

const KEEP = new Set(['visits', 'notify_log', 'import_chunks', 'import_runs'])
const IMPORTABLE = Object.keys(TABLES).filter((t) => t === 'users' || !TABLES[t].internal)
const COLS = Object.fromEntries(IMPORTABLE.map((t) => [t, TABLES[t].cols.map((c) => c[0]).join(', ')]))
const MAX_STATEMENTS = 200000

let ready = false
async function ensureTables(db) {
  if (ready) return
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS import_chunks (run TEXT NOT NULL, seq INTEGER NOT NULL, total INTEGER NOT NULL,
      reset INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY (run, seq))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS import_runs (run TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, statements INTEGER, detail TEXT)`),
  ])
  ready = true
}

// ¿Es una lista de literales SQLite válida? NULL, números o '…' con las comillas dobladas, separados por comas.
function literalsOk(s) {
  let i = 0
  const n = s.length
  const ws = () => { while (i < n && s[i] === ' ') i++ }
  for (;;) {
    ws()
    if (s.startsWith('NULL', i)) i += 4
    else if (s[i] === "'") {
      i++
      for (;;) {
        const j = s.indexOf("'", i)
        if (j < 0) return false
        if (s[j + 1] === "'") { i = j + 2; continue }
        i = j + 1; break
      }
    } else {
      const m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(s.slice(i, i + 40))
      if (!m) return false
      i += m[0].length
    }
    ws()
    if (i === n) return true
    if (s[i] !== ',') return false
    i++
  }
}

// Comprueba una sentencia; devuelve null si vale o el motivo si no
export function checkStatement(sql) {
  if (typeof sql !== 'string' || sql.length > 95000) return 'demasiado larga'
  if (sql === 'PRAGMA defer_foreign_keys = true;') return null
  let m = /^DELETE FROM ([a-z0-9_]+);$/.exec(sql)
  if (m) return IMPORTABLE.includes(m[1]) ? null : 'tabla desconocida ' + m[1]
  m = /^INSERT INTO ([a-z0-9_]+) \(([a-z0-9_, ]+)\) VALUES \(([\s\S]*)\);$/.exec(sql)
  if (!m) return 'forma no permitida'
  if (!IMPORTABLE.includes(m[1])) return 'tabla desconocida ' + m[1]
  if (m[2] !== COLS[m[1]]) return 'columnas distintas en ' + m[1]
  return literalsOk(m[3]) ? null : 'valores no válidos en ' + m[1]
}

// Cerrada si la app ya se usa en Cloudflare (o se cerró antes)
const LIVE_USERS = 3
async function locked(db) {
  if (await db.prepare("SELECT 1 FROM import_runs WHERE run = '#locked'").first()) return true
  const last = (await db.prepare("SELECT max(finished_at) AS t FROM import_runs WHERE status = 'done'").first())?.t || ''
  const s = await db.prepare(`SELECT count(DISTINCT s.user_id) AS n FROM sessions s
    WHERE s.created_at > ? AND NOT EXISTS (SELECT 1 FROM platform_admins a WHERE a.user_id = s.user_id)`).bind(last).first().catch(() => null)
  if ((s?.n || 0) < LIVE_USERS) return false
  await db.prepare("INSERT OR IGNORE INTO import_runs (run, status, started_at, detail) VALUES ('#locked', 'locked', ?, 'la app ya está en marcha en Cloudflare')").bind(nowIso()).run()
  return true
}

// Sentencias para borrar y volver a crear el esquema (todo menos KEEP)
function resetStatements(db) {
  const out = [db.prepare('PRAGMA defer_foreign_keys = true')]
  for (const v of Object.keys(VIEWS)) out.push(db.prepare(`DROP VIEW IF EXISTS ${v}`))
  for (const t of Object.keys(TABLES).reverse()) if (!KEEP.has(t)) out.push(db.prepare(`DROP TABLE IF EXISTS ${t}`))
  const body = schemaSql().replace(/^--.*$/gm, '').replace(/^PRAGMA foreign_keys = ON;$/m, '')
  for (const s of body.split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) out.push(db.prepare(s))
  return out
}

async function execute(env, run) {
  const db = env.DB
  const chunks = (await db.prepare('SELECT seq, reset, body FROM import_chunks WHERE run = ? ORDER BY seq').bind(run).all()).results
  const statements = chunks.flatMap((c) => JSON.parse(c.body))
  const reset = chunks.some((c) => c.reset)
  const stmts = [...(reset ? resetStatements(db) : []), ...statements.map((s) => db.prepare(s))]
  try {
    await db.batch(stmts)
  } catch (e) {
    await db.prepare("UPDATE import_runs SET status = 'error', finished_at = ?, detail = ? WHERE run = ?").bind(nowIso(), String(e?.message || e).slice(0, 500), run).run()
    return { status: 'error', error: String(e?.message || e).slice(0, 500) }
  }
  const counts = {}
  for (const t of IMPORTABLE) counts[t] = (await db.prepare(`SELECT count(*) AS n FROM ${t}`).first())?.n ?? 0
  await db.batch([
    db.prepare("UPDATE import_runs SET status = 'done', finished_at = ?, statements = ?, detail = ? WHERE run = ?").bind(nowIso(), statements.length, JSON.stringify(counts), run),
    db.prepare('DELETE FROM import_chunks WHERE run = ?').bind(run),
  ])
  return { status: 'done', statements: statements.length, counts }
}

export async function handleImport(req, env, url) {
  if (!env.DB) fail('NOT_CONFIGURED', 'falta la base de datos D1', 503)
  const db = env.DB
  await ensureTables(db)
  if (req.method === 'GET' && url.pathname.endsWith('/status')) {
    const run = url.searchParams.get('run') || ''
    const r = await db.prepare('SELECT status, started_at, finished_at, statements, detail FROM import_runs WHERE run = ?').bind(run).first()
    const got = await db.prepare('SELECT count(*) AS n, max(total) AS total FROM import_chunks WHERE run = ?').bind(run).first()
    return json({ run, status: r?.status || (got?.n ? 'receiving' : 'unknown'), received: got?.n || 0, total: got?.total || null,
      started_at: r?.started_at || null, finished_at: r?.finished_at || null, statements: r?.statements ?? null,
      detail: r?.status === 'done' ? JSON.parse(r.detail || '{}') : r?.detail || null, locked: await locked(db) })
  }
  if (req.method !== 'POST') fail('NOT_FOUND', 'ruta desconocida', 404)
  if (!env.NOTIFY_KEY) fail('NOT_CONFIGURED', 'falta NOTIFY_KEY', 503)
  if (!safeEqual(req.headers.get('X-Notify-Key') || '', env.NOTIFY_KEY)) fail('FORBIDDEN', 'clave incorrecta', 403)
  if (await locked(db)) fail('LOCKED', 'la app ya está en marcha en Cloudflare: no se puede volver a importar', 409)
  const b = await req.json().catch(() => null)
  const run = String(b?.run || '')
  const seq = b?.seq, total = b?.total
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(run) || run.startsWith('#')) fail('INVALID', 'run no válido')
  if (!Number.isInteger(seq) || !Number.isInteger(total) || total < 1 || total > 5000 || seq < 1 || seq > total) fail('INVALID', 'seq/total no válidos')
  if (!Array.isArray(b.statements) || b.statements.length > 5000) fail('INVALID', 'statements no válido')
  for (const [i, s] of b.statements.entries()) {
    const why = checkStatement(s)
    if (why) fail('INVALID', `sentencia ${seq}.${i + 1}: ${why}`)
  }
  const prev = await db.prepare('SELECT status FROM import_runs WHERE run = ?').bind(run).first()
  if (prev) fail('DUPLICATE', `la importación «${run}» ya se ejecutó (${prev.status}); usa otro nombre`, 409)
  await db.prepare('INSERT OR REPLACE INTO import_chunks (run, seq, total, reset, body, received_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(run, seq, total, b.reset ? 1 : 0, JSON.stringify(b.statements), nowIso()).run()
  const got = await db.prepare('SELECT count(*) AS n, sum(json_array_length(body)) AS s, min(total) AS lo, max(total) AS hi FROM import_chunks WHERE run = ?').bind(run).first()
  if (got.lo !== got.hi) fail('INVALID', 'total distinto entre trozos')
  if (got.s > MAX_STATEMENTS) fail('INVALID', 'demasiadas sentencias')
  if (got.n < total) return json({ ok: true, run, received: got.n, total })
  // Último trozo: solo una petición se queda con la ejecución
  const claim = await db.prepare("INSERT INTO import_runs (run, status, started_at) VALUES (?, 'running', ?) ON CONFLICT (run) DO NOTHING RETURNING run").bind(run, nowIso()).first()
  if (!claim) return json({ ok: true, run, received: got.n, total, status: 'running' })
  const r = await execute(env, run)
  return json({ ok: r.status === 'done', run, ...r }, r.status === 'done' ? 200 : 500)
}

// Desde el cron: cierra la importación si la app ya está en marcha
export async function checkImportLock(env) {
  if (!env.DB) return
  await ensureTables(env.DB)
  await locked(env.DB)
}
