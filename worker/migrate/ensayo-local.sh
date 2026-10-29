#!/usr/bin/env bash
# Ensayo completo de la exportación en un Postgres 16 local (sin tocar Supabase ni Cloudflare):
#   crea una base con la forma de Supabase y datos inventados, aplica la migración 034, ejecuta private.export_to_d1
#   (pg_net simulado: guarda las peticiones) y deja esas peticiones en worker/test/fixtures/import-supabase.json,
#   que luego prueba worker/test/import.mjs contra el Worker.
# Uso: bash worker/migrate/ensayo-local.sh   (necesita initdb/pg_ctl/psql de PostgreSQL 16 y la extensión pgcrypto)
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d)
RUNAS=()
if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; RUNAS=(su postgres -c); fi
run() { if [ ${#RUNAS[@]} -gt 0 ]; then "${RUNAS[@]}" "$*"; else bash -c "$*"; fi; }
run "$BIN/initdb -D $DIR/data -A trust -U postgres >/dev/null"
run "$BIN/pg_ctl -D $DIR/data -o '-k $DIR -p 5498 -c listen_addresses=' -l $DIR/log -w start >/dev/null"
trap 'run "$BIN/pg_ctl -D $DIR/data -m fast stop >/dev/null"; rm -rf "$DIR"' EXIT
P="psql -h $DIR -p 5498 -U postgres -v ON_ERROR_STOP=1 -q -d postgres"
$P -f worker/test/fixtures/supabase-falso.sql
$P -f worker/test/fixtures/datos-falsos.sql
grep -v 'create extension if not exists pg_net' supabase/migrations/*_034_exportar_a_d1.sql | $P
$P -tA -c "select private.export_to_d1('t1', true, true, 10)"
$P -tA -c "select private.export_to_d1('t2', false, true, 10)"
$P -tA -c "select jsonb_agg(jsonb_build_object('run', body->>'run', 'body', body) order by id) from net.reqs" > worker/test/fixtures/import-supabase.json
echo "OK → worker/test/fixtures/import-supabase.json; ahora: node --no-warnings worker/test/import.mjs"
