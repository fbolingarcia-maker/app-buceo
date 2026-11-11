// Prueba de la copia de seguridad (sin red): node --no-warnings worker/test/backup.mjs
// Copia una base con datos en un R2 simulado, la restaura con tools/backup/restore.mjs en una base vacía y compara.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { D1, R2 } from './shim.mjs'
import { backupD1 } from '../backup.js'
import { restoreSql } from '../../tools/backup/restore.mjs'

let fails = 0, passes = 0
const ok = (c, name, extra) => { if (c) passes++; else { fails++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '') } }
const db = new D1(new URL('../schema.sql', import.meta.url).pathname)
await db.batch([
  db.prepare("INSERT INTO destinations VALUES ('Panglao', 'Bohol', 'Visayas', 9.55, 123.77)"),
  db.prepare("INSERT INTO centers (id, name, destination, listing_status, verification_status) VALUES ('c1', 'Azul ''Divers''', 'Panglao', 'socio', 'verified')"),
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'a@x.test', 'pbkdf2$1$x$y')"),
  db.prepare("INSERT INTO sessions (id, user_id, aal, recovery, expires_at) VALUES ('s1', 'u1', 'aal1', 0, '2030-01-01')"),
])
const env = { DB: db, BACKUPS: new R2() }
// Una copia vieja que tiene que desaparecer (se guardan 12)
for (let i = 0; i < 13; i++) await env.BACKUPS.put(`2025-0${(i % 9) + 1}-${String(10 + i).padStart(2, '0')}/manifest.json`, '{}')
const r = await backupD1(env, new Date('2026-11-15T19:41:00Z'))
ok(r.day === '2026-11-15' && r.rows >= 3, 'copia hecha', r)
ok(r.removed.length === 2, 'borra las copias de más de 12 semanas', r.removed)
ok(!env.BACKUPS.m.has('2026-11-15/sessions.jsonl.gz'), 'no copia las sesiones')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-backup-'))
for (const [k, v] of env.BACKUPS.m) if (k.startsWith('2026-11-15/')) fs.writeFileSync(path.join(dir, k.split('/')[1]), v.body)
const fresh = new DatabaseSync(':memory:')
fresh.exec(restoreSql(dir))
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const bad = Object.entries(manifest.tables).filter(([t, n]) => Number(fresh.prepare(`SELECT count(*) AS n FROM "${t}"`).get().n) !== n)
ok(bad.length === 0, 'la restauración tiene las mismas filas en todas las tablas', bad)
ok(fresh.prepare("SELECT name FROM centers WHERE id = 'c1'").get()?.name === "Azul 'Divers'", 'los textos con comillas se restauran bien')

console.log(`\n${passes} bien, ${fails} mal`)
process.exit(fails ? 1 : 0)
