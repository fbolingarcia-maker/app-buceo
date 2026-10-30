// Copia de datos Supabase → D1 para el cambio a Cloudflare.
//   node worker/migrate/gen-export.mjs            → worker/migrate/export-supabase.sql (con los hash de contraseñas)
//   node worker/migrate/gen-export.mjs --ensayo   → igual pero sin hash (para ensayar sin sacar contraseñas de Supabase)
//   Además (siempre) genera la migración de Supabase supabase/migrations/…_036_exportar_a_d1_sin_clave.sql con la función
//   private.export_to_d1(run, passwords, reset, chunk, dry), que manda esas mismas sentencias al Worker (POST /api/import,
//   worker/import.js) por trozos, por la cola private.outbox de la migración 035 (sin clave). Es el camino recomendado: los datos van directos de Supabase a Cloudflare.
//
// export-supabase.sql es UNA consulta de Postgres para el SQL Editor de Supabase (o execute_sql): devuelve una fila por
// sentencia SQLite (columna «sql», en orden). Esas sentencias se ejecutan tal cual en D1, por lotes:
//   1. PRAGMA defer_foreign_keys  2. DELETE de todas las tablas de la app (orden inverso)  3. INSERT de cada fila.
// Las tablas internas de sesiones, tokens, dos pasos y límites no se copian: la gente vuelve a entrar y, quien tuviera
// los dos pasos, los activa de nuevo (Supabase no deja exportar esos secretos). visits y notify_log (D1) no se tocan.
// Los tipos salen de worker/schema.js: booleanos a 0/1, arrays y jsonb a texto JSON, fechas a ISO UTC «…Z».
import fs from 'node:fs'
import { TABLES } from '../schema.js'

const ensayo = process.argv.includes('--ensayo')
const lit = (e) => `'''' || replace((${e})::text, '''', '''''') || ''''`
// Cada valor como literal SQLite (texto); si es NULL y la columna es NOT NULL con valor por defecto, ese valor
// (en Supabase hay columnas que admiten NULL y en D1 no, p. ej. arrays vacíos).
const pgLit = (x) => "'" + x.replace(/'/g, "''") + "'"
const expr = (col, type) => {
  const c = `"${col}"`
  switch (type) {
    case 'int': case 'real': return `(${c})::text`
    case 'bool': return `case when ${c} then '1' when not ${c} then '0' end`
    case 'json': return lit(`to_jsonb(${c})`)
    case 'ts': return lit(`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
    default: return lit(c)
  }
}
const val = (col, type, o = {}) => `coalesce(${expr(col, type)}, ${o.nn && o.def && !o.def.startsWith('(') ? pgLit(o.def) : "'NULL'"})`
const appTables = Object.entries(TABLES).filter(([, d]) => !d.internal).map(([t]) => t)

// Consulta con todas las sentencias (columnas n, r, sql). pw: true (con hash), false (sin hash) o una expresión SQL.
function unionSql(pw) {
const parts = []
let n = 0
const stmt = (sqlExpr, from = '') => parts.push(`select ${n++} as n, 0 as r, ${sqlExpr} as sql ${from}`)
stmt(`'PRAGMA defer_foreign_keys = true;'`)
for (const t of [...appTables].reverse()) stmt(`'DELETE FROM ${t};'`)
stmt(`'DELETE FROM users;'`)

// Cuentas (auth.users → users), con el id de Google si lo tienen
const users = (pw) => `select u.id, lower(u.email) as email,
    ${pw === false ? 'null::text' : `case when ${pw === true ? '' : pw + ' and '}coalesce(u.encrypted_password, '') <> '' then 'bcrypt$' || u.encrypted_password end`} as password_hash,
    u.email_confirmed_at, u.last_sign_in_at, u.created_at, coalesce(u.raw_user_meta_data, '{}'::jsonb) as user_metadata,
    coalesce(u.raw_app_meta_data->>'provider', 'email') as provider,
    (select i.provider_id from auth.identities i where i.user_id = u.id and i.provider = 'google' limit 1) as google_sub
  from auth.users u where u.deleted_at is null and u.email is not null`
const ucols = TABLES.users.cols
parts.push(`select ${n++} as n, row_number() over () as r, 'INSERT INTO users (${ucols.map((c) => c[0]).join(', ')}) VALUES (' || concat_ws(', ', ${ucols.map(([c, ty, o]) => val(c, ty, o)).join(', ')}) || ');' as sql from (${users(pw)}) x`)

for (const t of appTables) {
  const cols = TABLES[t].cols
  const order = cols.some((c) => c[0] === 'created_at') ? ' order by created_at' : ''
  parts.push(`select ${n++} as n, row_number() over () as r, 'INSERT INTO ${t} (${cols.map((c) => c[0]).join(', ')}) VALUES (' || concat_ws(', ', ${cols.map(([c, ty, o]) => val(c, ty, o)).join(', ')}) || ');' as sql from (select * from public.${t}${order}) x`)
}

return parts.join('\nunion all\n')
}

const sql = `-- Generado por worker/migrate/gen-export.mjs${ensayo ? ' --ensayo (sin hash de contraseñas)' : ''}. No editar a mano.
-- Devuelve las sentencias SQLite para copiar Supabase a D1, en orden (columnas n, r).
select sql from (
${unionSql(!ensayo)}
) s order by n, r;
`
const out = new URL(ensayo ? './export-ensayo.sql' : './export-supabase.sql', import.meta.url)
fs.writeFileSync(out, sql)
console.log(out.pathname, sql.length, 'bytes,', appTables.length + 1, 'tablas')

// Migración de Supabase con la función que empuja los datos al Worker (versión 036: por la cola private.outbox de la
// migración 035, sin clave compartida; la 034 era la primera versión, con X-Notify-Key)
const mig = `-- 036: copia de datos Supabase → Cloudflare D1 (para el cambio de backend). Generado por worker/migrate/gen-export.mjs.
-- Sustituye a la función de la 034: ya no necesita la clave «divingslot_notify_key» (usa la cola de la migración 035).
-- No hace nada por sí sola: solo crea la función. El día del cambio se ejecuta en el SQL Editor de Supabase:
--     select private.export_to_d1('cambio-1');             -- con las contraseñas (la gente entra con la misma)
--     select private.export_to_d1('ensayo-1', false);      -- ensayo: sin contraseñas
--     select private.export_to_d1('x', p_dry := true);     -- solo cuenta (no manda nada)
-- Cada trozo se guarda en private.outbox y al Worker (POST <url de avisos con /api/import>) le llega { claim }; el Worker lo
-- recoge con outbox_claim, comprueba cada sentencia y, al llegar el último trozo, borra y crea de nuevo las tablas de D1
-- (p_reset) y mete todo en una sola transacción.
-- Resultado: https://divingslot.com/api/import/status?run=cambio-1  (status «done» y filas por tabla).
-- Solo la puede ejecutar el propietario de la base de datos (SQL Editor); nadie desde la app.

create or replace function private.export_to_d1(p_run text, p_passwords boolean default true, p_reset boolean default true, p_chunk int default 300, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  u text;
  stmts text[];
  total int;
  nchunks int;
  ids bigint[] := '{}';
  i int;
begin
  if p_run !~ '^[A-Za-z0-9_.:-]{1,64}$' then raise exception 'nombre de importación no válido: %', p_run; end if;
  if p_chunk < 10 or p_chunk > 2000 then raise exception 'p_chunk entre 10 y 2000'; end if;
  select coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'divingslot_notify_url'),
                  'https://divingslot.com/api/notify') into u;
  u := regexp_replace(u, '/api/notify$', '/api/import');

  select array_agg(sql order by n, r) into stmts from (
${unionSql('p_passwords')}
  ) s;

  total := coalesce(array_length(stmts, 1), 0);
  nchunks := greatest(1, ceil(total::numeric / p_chunk)::int);
  if p_dry then
    return jsonb_build_object('dry_run', true, 'statements', total, 'chunks', nchunks, 'url', u,
      'bytes', (select sum(length(x)) from unnest(stmts) x), 'max_statement', (select max(length(x)) from unnest(stmts) x),
      'users', (select count(*) from unnest(stmts) x where x like 'INSERT INTO users %'));
  end if;
  for i in 1..nchunks loop
    ids := ids || private.outbox_push('import',
      jsonb_build_object('run', p_run, 'seq', i, 'total', nchunks, 'reset', p_reset,
                         'statements', to_jsonb(coalesce(stmts[(i - 1) * p_chunk + 1 : i * p_chunk], '{}'::text[]))),
      '/api/import', 60000);
  end loop;
  return jsonb_build_object('run', p_run, 'statements', total, 'chunks', nchunks, 'url', u, 'passwords', p_passwords,
    'reset', p_reset, 'request_ids', to_jsonb(ids),
    'status', regexp_replace(u, '/api/import$', '/api/import/status?run=') || p_run);
end $fn$;
revoke all on function private.export_to_d1(text, boolean, boolean, int, boolean) from public, anon, authenticated;
comment on function private.export_to_d1(text, boolean, boolean, int, boolean) is 'Copia los datos a Cloudflare D1 (worker/import.js). Ver docs/CAMBIO-A-CLOUDFLARE.md';
`
const migOut = new URL('../../supabase/migrations/20261031100000_036_exportar_a_d1_sin_clave.sql', import.meta.url)
fs.writeFileSync(migOut, mig)
console.log(migOut.pathname, mig.length, 'bytes')
