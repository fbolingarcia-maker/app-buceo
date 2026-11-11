// Copia de seguridad semanal de D1 en un bucket R2 aparte (BACKUPS = divingslot-backups), fuera de la propia base de
// datos: si se borra o se corrompe D1 (o pasan los 30 días de Time Travel), los datos siguen ahí.
// Cada copia es una carpeta <AAAA-MM-DD>/ con schema.sql, un <tabla>.jsonl.gz por tabla y manifest.json (filas por tabla).
// Se guardan las últimas KEEP_WEEKS copias. Restaurar: tools/backup/README.md (tools/backup/restore.mjs genera el SQL).
import { all, first, fail } from './lib/util.js'

export const BACKUP_CRON = '41 19 * * 0' // domingo 19:41 UTC = lunes 3:41 en Manila
const KEEP_WEEKS = 12
const PAGE = 1000
// Lo que no hace falta guardar: sesiones (caducan), contadores de límites y códigos de un solo uso
const SKIP = new Set(['sessions', 'rate_limits', 'reauth_codes'])

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function backupD1(env, now = new Date()) {
  if (!env.BACKUPS) return { skipped: 'sin bucket BACKUPS' }
  const day = now.toISOString().slice(0, 10)
  const objs = await all(env.DB, "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name")
  await env.BACKUPS.put(day + '/schema.sql', objs.map((o) => o.sql + ';').join('\n\n') + '\n', { httpMetadata: { contentType: 'application/sql' } })
  const counts = {}
  for (const { name } of objs.filter((o) => o.type === 'table' && !SKIP.has(o.name))) {
    const lines = []
    for (let off = 0; ; off += PAGE) {
      const rows = await all(env.DB, `SELECT * FROM "${name}" ORDER BY rowid LIMIT ? OFFSET ?`, PAGE, off)
      for (const r of rows) lines.push(JSON.stringify(r))
      if (rows.length < PAGE) break
    }
    counts[name] = lines.length
    await env.BACKUPS.put(`${day}/${name}.jsonl.gz`, await gzip(lines.join('\n')), { httpMetadata: { contentType: 'application/gzip' } })
  }
  await env.BACKUPS.put(day + '/manifest.json', JSON.stringify({ at: now.toISOString(), tables: counts }, null, 1), { httpMetadata: { contentType: 'application/json' } })
  // Copias antiguas
  const days = new Set()
  let cursor
  do {
    const l = await env.BACKUPS.list({ cursor, delimiter: '/' })
    for (const p of l.delimitedPrefixes || []) days.add(p.replace(/\/$/, ''))
    cursor = l.truncated ? l.cursor : undefined
  } while (cursor)
  const old = [...days].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(KEEP_WEEKS)
  for (const d of old) {
    let c
    do {
      const l = await env.BACKUPS.list({ prefix: d + '/', cursor: c })
      if (l.objects.length) await env.BACKUPS.delete(l.objects.map((o) => o.key))
      c = l.truncated ? l.cursor : undefined
    } while (c)
  }
  const res = { day, at: now.toISOString(), tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), removed: old }
  await env.DB.prepare("INSERT INTO app_config (key, value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(res)).run()
  return res
}

// RPC de administrador: estado de la última copia y «Hacer copia ahora» (Resumen de administración)
export const BACKUP_RPC = {
  async admin_backup_status(ctx) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'solo administradores', 403)
    const v = (await first(ctx.db, "SELECT value FROM app_config WHERE key = 'last_backup'"))?.value
    return { enabled: !!ctx.env?.BACKUPS, last: v ? JSON.parse(v) : null }
  },
  async admin_backup_now(ctx) {
    if (!ctx.isAdmin) fail('FORBIDDEN', 'solo administradores', 403)
    if (!ctx.env?.BACKUPS) fail('NO_BUCKET', 'falta el bucket de copias (BACKUPS en wrangler.jsonc)')
    return backupD1(ctx.env)
  },
}
