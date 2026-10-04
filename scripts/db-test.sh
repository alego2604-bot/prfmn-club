#!/usr/bin/env bash
# Aplica todas las migraciones en un PostgreSQL local efímero y ejecuta los tests de RLS/integridad.
# Requiere binarios de PostgreSQL 15+ (initdb, pg_ctl, psql). No toca ningún proyecto Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PGTEST_PORT:-54329}"
DATA_DIR="$(mktemp -d -t bos-pgtest-XXXXXX)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$DATA_DIR"
  RUN_AS=(su postgres -c)
fi

run() {
  if [ ${#RUN_AS[@]} -gt 0 ]; then "${RUN_AS[@]}" "$*"; else bash -c "$*"; fi
}

cleanup() {
  run "$PG_BIN/pg_ctl -D $DATA_DIR -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

run "$PG_BIN/initdb -D $DATA_DIR -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
run "$PG_BIN/pg_ctl -D $DATA_DIR -o '-p $PORT -k /tmp -c listen_addresses=' -l $DATA_DIR/log -w start" >/dev/null

PSQL=(psql -h /tmp -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

echo "→ Supabase stub"
"${PSQL[@]}" -f "$ROOT/supabase/tests/bootstrap_supabase_stub.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "→ tests"
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls_isolation.sql" 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'

# Reversión de 0920 y reaplicación: la migración es reversible y forward-only repetible (sin pérdida de datos de prueba)
echo "→ rollback 0920"
"${PSQL[@]}" -f "$ROOT/supabase/rollbacks/20261006000920_down.sql" >/dev/null 2>&1 || { echo "FAIL: el rollback de 0920 falló"; exit 1; }
[ "$("${PSQL[@]}" -tA -c "select count(*) from pg_trigger where tgname in ('trg_payments_permission','trg_members_guard','trg_customers_sensitive')")" = "0" ] || { echo "FAIL: el rollback dejó triggers"; exit 1; }
[ "$("${PSQL[@]}" -tA -c "select has_column_privilege('authenticated','public.customers','tax_id','select')")" = "t" ] || { echo "FAIL: el rollback no devolvió el SELECT"; exit 1; }
[ "$("${PSQL[@]}" -tA -c "select (public.server_capabilities() ->> 'schema')::int")" = "900" ] || { echo "FAIL: el rollback no restauró server_capabilities"; exit 1; }
echo "→ 20261006000920 (reaplicada)"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261006000920_permissions_enforcement.sql" >/dev/null 2>&1 || { echo "FAIL: reaplicar 0920 falló"; exit 1; }
[ "$("${PSQL[@]}" -tA -c "select has_column_privilege('authenticated','public.customers','tax_id','select')")" = "f" ] || { echo "FAIL: tras reaplicar, tax_id sigue legible"; exit 1; }
[ "$("${PSQL[@]}" -tA -c "select (public.server_capabilities() ->> 'schema')::int")" = "920" ] || { echo "FAIL: capacidades 920"; exit 1; }
echo "✔ 0920 reversible y reaplicable"
