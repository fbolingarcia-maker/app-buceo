// Convierte una copia de seguridad de D1 (carpeta descargada de R2: schema.sql + <tabla>.jsonl.gz + manifest.json)
// en un fichero SQL para cargarlo en una base de datos D1 vacía:
//   node tools/backup/restore.mjs <carpeta> > restore.sql
//   npx wrangler d1 execute <base-de-prueba> --remote --file restore.sql
// Ver tools/backup/README.md.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export function restoreSql(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  const schema = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8')
  const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? '1' : '0') : "'" + String(v).replace(/'/g, "''") + "'")
  const out = ['PRAGMA defer_foreign_keys = ON;', schema]
  // Las tablas referenciadas van antes (claves ajenas): orden según los REFERENCES de schema.sql
  const deps = {}
  for (const m of schema.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?\s*\(([\s\S]*?)\);/g)) deps[m[1]] = [...m[2].matchAll(/REFERENCES\s+"?(\w+)"?/g)].map((x) => x[1]).filter((d) => d !== m[1])
  const order = [], seen = new Set()
  const visit = (t) => { if (seen.has(t)) return; seen.add(t); for (const d of deps[t] || []) visit(d); order.push(t) }
  for (const t of Object.keys(manifest.tables)) visit(t)
  for (const table of order.filter((t) => t in manifest.tables)) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(dir, table + '.jsonl.gz'))).toString('utf8')
    for (const line of text.split('\n')) {
      if (!line) continue
      const row = JSON.parse(line)
      const cols = Object.keys(row)
      out.push(`INSERT INTO "${table}" (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${cols.map((c) => lit(row[c])).join(', ')});`)
    }
  }
  return out.join('\n') + '\n'
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  if (!process.argv[2]) { console.error('Uso: node tools/backup/restore.mjs <carpeta de la copia>'); process.exit(1) }
  process.stdout.write(restoreSql(process.argv[2]))
}
