# Entornos y variables

| Entorno | Datos | Uso |
|---|---|---|
| **development** | Local (IndexedDB) o proyecto Supabase local/dev | Desarrollo y pruebas destructivas |
| **staging** | Proyecto Supabase propio, datos de prueba | Validar migraciones y releases |
| **production** | Proyecto Supabase propio, datos reales | Solo migraciones revisadas; nunca pruebas destructivas |

Nunca se comparten bases de datos entre entornos. El rollback de `supabase/rollbacks/` es solo para development/staging.

## Variables (frontend, públicas)
Solo claves públicas con prefijo `VITE_`. Ver `.env.example`.

| Variable | Descripción |
|---|---|
| `VITE_APP_ENV` | `development` · `staging` · `production` |
| `VITE_SUPABASE_URL` | URL del proyecto (Fase 5) |
| `VITE_SUPABASE_ANON_KEY` | Clave **anon** (pública; la seguridad la da RLS) |

## Secretos (solo Edge Functions / servidor, nunca en el frontend)
`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REDSYS_*`, `WHATSAPP_CLOUD_API_TOKEN`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, credenciales OCR. Se configuran con `supabase secrets set`.
