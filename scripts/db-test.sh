#!/usr/bin/env bash
# Aplica todas las migraciones en un PostgreSQL local efímero y ejecuta los tests de RLS/integridad.
# Requiere binarios de PostgreSQL 15+ (initdb, pg_ctl, psql). No toca ningún proyecto Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PGTEST_PORT:-54329}"
DATA_DIR="$(mktemp -d -t prfmn-pgtest-XXXXXX)"
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
