#!/usr/bin/env bash
# Business OS · stack LOCAL equivalente a Supabase (PostgreSQL 16 + Supabase Auth/GoTrue + PostgREST + pasarela).
# Mismos componentes que un proyecto Supabase real, sin Docker. Solo desarrollo y tests E2E:
# nunca contiene datos reales y no se conecta a ningún proyecto remoto.
#   ./scripts/local-supabase/start.sh         → arranca (crea la BD si no existe) y escribe .env.local
#   ./scripts/local-supabase/start.sh reset   → borra la BD local y la recrea desde las migraciones
#   ./scripts/local-supabase/start.sh stop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/local-supabase"
STATE="$ROOT/.local-supabase"
BIN="${SB_BIN:-/opt/sb}"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}"
PGPORT=54322; AUTH_PORT=9999; REST_PORT=3000; GATEWAY_PORT=54321
JWT_SECRET="business-os-local-dev-secret-not-for-production-000000"
AUTH_VERSION=2.170.0; PGRST_VERSION=12.2.3
mkdir -p "$STATE" "$BIN"

as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
stop_all() {
  for p in gateway rest auth; do [ -f "$STATE/$p.pid" ] && kill "$(cat "$STATE/$p.pid")" 2>/dev/null || true; rm -f "$STATE/$p.pid"; done
  [ -d "$STATE/pg" ] && as_pg "$PG_BIN/pg_ctl -D $STATE/pg -m fast stop" >/dev/null 2>&1 || true
}
if [ "${1:-}" = stop ]; then stop_all; echo "stack detenido"; exit 0; fi
if [ "${1:-}" = reset ]; then stop_all; rm -rf "$STATE/pg"; fi

# Binarios oficiales (se descargan una vez)
if [ ! -x "$BIN/postgrest" ]; then
  curl -sSL "https://github.com/PostgREST/postgrest/releases/download/v$PGRST_VERSION/postgrest-v$PGRST_VERSION-linux-static-x64.tar.xz" | tar xJ -C "$BIN"
fi
if [ ! -x "$BIN/auth/auth" ]; then
  mkdir -p "$BIN/auth"
  curl -sSL "https://github.com/supabase/auth/releases/download/v$AUTH_VERSION/auth-v$AUTH_VERSION-x86.tar.gz" | tar xz -C "$BIN/auth"
fi

PSQL=(psql -h /tmp -p $PGPORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
FRESH=0
if [ ! -d "$STATE/pg" ]; then
  FRESH=1
  mkdir -p "$STATE/pg"; [ "$(id -u)" = 0 ] && chown postgres "$STATE" "$STATE/pg"
  as_pg "$PG_BIN/initdb -D $STATE/pg -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
fi
as_pg "$PG_BIN/pg_ctl -D $STATE/pg -o '-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1' -l $STATE/pg/log -w start" >/dev/null 2>&1 || true

DB_AUTH="postgres://supabase_auth_admin:auth_admin@127.0.0.1:$PGPORT/postgres?sslmode=disable"
if [ $FRESH = 1 ]; then
  echo "→ roles Supabase"; "${PSQL[@]}" -f "$HERE/roles.sql"
  echo "→ migraciones de Supabase Auth"
  (cd "$BIN/auth" && GOTRUE_DB_DRIVER=postgres DATABASE_URL="$DB_AUTH" GOTRUE_JWT_SECRET="$JWT_SECRET" API_EXTERNAL_URL=http://localhost:$GATEWAY_PORT/auth/v1 \
    GOTRUE_SITE_URL=http://localhost:5173 GOTRUE_DB_MIGRATIONS_PATH="$BIN/auth/migrations" ./auth migrate >/dev/null 2>&1)
  for f in "$ROOT"/supabase/migrations/*.sql; do echo "→ $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
fi

cd "$BIN/auth"
GOTRUE_DB_DRIVER=postgres DATABASE_URL="$DB_AUTH" GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  API_EXTERNAL_URL=http://localhost:$GATEWAY_PORT/auth/v1 GOTRUE_SITE_URL=http://localhost:5173 GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_DISABLE_SIGNUP=false GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 \
  GOTRUE_DB_MIGRATIONS_PATH="$BIN/auth/migrations" nohup ./auth serve > "$STATE/auth.log" 2>&1 & echo $! > "$STATE/auth.pid"
PGRST_DB_URI="postgres://authenticator:authenticator@127.0.0.1:$PGPORT/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=$REST_PORT PGRST_DB_MAX_ROWS=1000 \
  nohup "$BIN/postgrest" > "$STATE/rest.log" 2>&1 & echo $! > "$STATE/rest.pid"
AUTH_PORT=$AUTH_PORT REST_PORT=$REST_PORT GATEWAY_PORT=$GATEWAY_PORT nohup node "$HERE/gateway.mjs" > "$STATE/gateway.log" 2>&1 & echo $! > "$STATE/gateway.pid"

# Migraciones nuevas sobre una BD existente (las ya aplicadas se registran en public.local_schema_migrations)
"${PSQL[@]}" -c "create table if not exists public.local_schema_migrations (name text primary key, applied_at timestamptz default now()); revoke all on public.local_schema_migrations from anon, authenticated;"
if [ $FRESH = 1 ]; then
  for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -c "insert into public.local_schema_migrations(name) values ('$(basename "$f")') on conflict do nothing"; done
else
  for f in "$ROOT"/supabase/migrations/*.sql; do
    n=$(basename "$f")
    if [ -z "$("${PSQL[@]}" -tAc "select 1 from public.local_schema_migrations where name='$n'")" ]; then
      echo "→ $n"; "${PSQL[@]}" -f "$f"; "${PSQL[@]}" -c "insert into public.local_schema_migrations(name) values ('$n')"
    fi
  done
fi
"${PSQL[@]}" -c "notify pgrst, 'reload schema'"

eval "$(node "$HERE/keys.mjs" "$JWT_SECRET")"
cat > "$STATE/env" <<ENV
VITE_SUPABASE_URL=http://localhost:$GATEWAY_PORT
VITE_SUPABASE_ANON_KEY=$ANON_KEY
VITE_APP_ENV=development
LOCAL_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
LOCAL_DB_URL=postgres://postgres@127.0.0.1:$PGPORT/postgres
ENV
for i in $(seq 1 40); do
  curl -sf "http://localhost:$GATEWAY_PORT/auth/v1/health" >/dev/null && curl -sf -o /dev/null "http://localhost:$GATEWAY_PORT/rest/v1/" -H "apikey: $ANON_KEY" && break
  sleep 0.5
done
echo "✔ stack local listo · API http://localhost:$GATEWAY_PORT · BD 127.0.0.1:$PGPORT · claves en .local-supabase/env"
