# Despliegue

## Frontend
SPA estática: `npm run build` → `dist/`. Cualquier hosting estático con fallback a `index.html` (Vercel, Netlify, Cloudflare Pages). Cabeceras recomendadas: CSP estricta, `X-Frame-Options: DENY`, HSTS.

## Base de datos (Supabase) — Fase 5
1. Crear **proyectos Supabase nuevos y exclusivos de Business OS**: `business-os-staging` y `business-os-production` (región UE). Nunca reutilizar el Supabase de PRFMN ni de ningún otro producto.
2. `supabase link --project-ref <staging>` y `supabase db push` (aplica `supabase/migrations` en orden).
3. Ejecutar los tests de aislamiento contra staging antes de cada release (adaptar `supabase/tests/rls_isolation.sql` con usuarios de prueba reales o pgTAP).
4. Activar backups diarios + PITR en producción.
5. Repetir en producción solo tras validar staging.

Reglas: migraciones nuevas hacia delante; nunca editar una aplicada; nunca `DROP` sin `IF EXISTS` y revisión.

## Staging (business-os-staging · ref `hjuoddtsdavbatepexsz` · eu-west-1)

Requisitos del entorno de trabajo (nunca en Git ni en el chat): red a `api.supabase.com` y `*.supabase.co`; variables `SUPABASE_ACCESS_TOKEN`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

1. **Migraciones**: `node scripts/staging/apply.mjs --status` (ver) → `node scripts/staging/apply.mjs` (aplica en orden, cada una en una transacción, registradas en `supabase_migrations.schema_migrations`; comprueba al final que todas las tablas tienen RLS). El script se niega a operar sobre cualquier otro proyecto.
2. **Auth**: Site URL y redirect URLs del frontend de staging. Para los tests automáticos, «Confirm email» desactivado en staging (en producción se mantiene activo).
3. **Tests contra staging**:
   - `BOS_CLOUD_URL=$VITE_SUPABASE_URL BOS_CLOUD_ANON_KEY=$VITE_SUPABASE_ANON_KEY npm run test:cloud` (integración: 2 dispositivos, aislamiento, permisos, importación).
   - `npm run dev` con `.env.local` de staging + `npm run e2e` (navegador real: alta → venta → cierre → logout → reentrada → segundo dispositivo).
   - Crean cuentas y empresas sintéticas (`*@empresa.test`); se pueden borrar desde el panel de Supabase.
4. **Producción**: solo cuando staging esté validado; mismo procedimiento con un script/ref propios y backups + PITR activados antes.

## Desarrollo local equivalente a Supabase

`npm run supabase:local` levanta PostgreSQL 16 + Supabase Auth (GoTrue) + PostgREST + pasarela en `http://localhost:54321` y escribe las claves locales en `.local-supabase/env`. Copia las `VITE_*` a `.env.local` para que la app lo use. `reset` recrea la BD desde las migraciones.

## Checklist de release
- [ ] lint, typecheck, test, build en verde
- [ ] `npm run db:test` si hay migraciones
- [ ] `npm run test:cloud` y `npm run e2e` contra staging
- [ ] `npm run check:privacy`
- [ ] CHANGELOG actualizado
- [ ] Probado en desktop, iPad y móvil
