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
   - `npm run e2e:multi` (dos pestañas, dos empresas, recargas, aislamiento y filtro de centro).
   - Las pruebas en navegador desde este entorno cloud usan un preload local (fuera del repo) que reenvía las llamadas a Supabase desde Node porque el Chromium del contenedor no confía en la CA del proxy; en una máquina normal no hace falta.
   - Crean cuentas y empresas sintéticas (`*@empresa.test`, empresas «Empresa Sintética/E2E/Uno/Lotes/Importación …»).
4. **Demo de staging**: `BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npm run seed:demo` siembra (o reanuda) la empresa demo en la cuenta sintética `demo-seed@empresa.test` por lotes y la verifica desde un segundo cliente. Idempotente.
5. **Limpieza de datos sintéticos (requiere credencial admin)**: con la clave pública, RLS no permite borrar cuentas ni empresas (y lo financiero nunca se borra). Con acceso admin al panel o SQL: borrar los usuarios de Auth cuyo email termina en `@empresa.test` salvo `demo-seed@empresa.test`; sus empresas y datos caen por `on delete cascade` de `organizations` si se borran también las empresas sin miembros. Revisar la lista antes de borrar.

Estado validado el 2026-10-02 (solo clave pública): Auth, 50 tablas por API con RLS, `test:cloud` 18/18 (4 de integración real), E2E persistencia 22/22, E2E multiempresa 7/7, demo sembrada (52 lotes, 0 errores).
6. **Producción**: solo cuando staging esté validado; mismo procedimiento con un script/ref propios y backups + PITR activados antes.

### Aplicar 0900 en staging (pendiente)

```bash
SUPABASE_ACCESS_TOKEN=… node scripts/staging/apply.mjs --status   # comprobar registro 0100–0810
SUPABASE_ACCESS_TOKEN=… node scripts/staging/apply.mjs            # aplica solo 20261002000900
NODE_USE_ENV_PROXY=1 npm run test:cloud                           # el test de finanzas deja de omitirse
```
Hasta entonces la app funciona contra staging sin Gastos, Membresías, Seguimiento ni series (aviso «Pendiente de activar en el servidor»).

### Aplicar 0920 en staging (pendiente) — permisos aplicados en servidor

Orden: **1)** desplegar el cliente de esta rama (funciona con 0910 y con 0920; GitHub Pages lo publica al hacer push), **2)** aplicar la migración, **3)** validar.

```bash
SUPABASE_ACCESS_TOKEN=… node scripts/staging/apply.mjs --status   # comprobar registro hasta 0910
SUPABASE_ACCESS_TOKEN=… node scripts/staging/apply.mjs            # aplica solo 20261006000920
BOS_CLOUD_URL=… BOS_CLOUD_ANON_KEY=… npx vitest run src/data/cloud/security.integration.test.ts src/data/cloud/staging910.integration.test.ts
npm run test:cloud && E2E_BASE_URL=… node e2e/permisos.e2e.mjs      # además persistencia, negocio y multiempresa
```
- Reversión: `supabase/rollbacks/20261006000920_down.sql` (no toca datos; devuelve el SELECT de `customers` y los cobros/escalada a su estado anterior).
- Efecto visible para el usuario: el **encargado** cobra cuotas y facturas; los clientes dejan de entregar NIF/dirección a quien no tiene `customers.sensitive`.
- Un cliente anterior a esta rama (pestañas abiertas con la versión vieja) leería `customers` con `select *` y fallaría tras 0920: recargar. Por eso el orden 1 → 2.

## Staging público en GitHub Pages (sin terminal)

URL: **https://alego2604-bot.github.io/prfmn-club/** (HTTPS, sin coste: el repositorio es público).

- `.github/workflows/staging-pages.yml`: en cada push a `claude/business-os-fitness-r9jaxb` o `main` ejecuta privacidad, lint, tipos y unitarios, construye con `BOS_BASE=/prfmn-club/` y publica `dist/` (con `404.html` = `index.html` para que las rutas de la SPA funcionen al recargar).
- Solo valores públicos: URL de business-os-staging y su clave *publishable* (`sb_publishable_…`, la misma que descarga cualquier navegador). Se pueden sustituir con variables del repositorio `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Nunca `service_role`.
- `vite.config.ts` lee `BOS_BASE` (por defecto `/`); el router usa `import.meta.env.BASE_URL` como `basename`. En local no cambia nada.

**Activación (una sola vez, la hace el propietario del repositorio):**
1. Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
2. Settings → Environments → `github-pages` → *Deployment branches and tags*: añadir `claude/business-os-fitness-r9jaxb` (por defecto solo permite la rama por defecto). Alternativa: fusionar en `main`.
3. Actions → «Staging (GitHub Pages)» → *Re-run* (o cualquier push).

Limitación conocida de Pages: al abrir o recargar directamente una ruta interna (p. ej. `/prfmn-club/gastos`) el servidor responde `404.html` con estado 404; la app carga y funciona igual, pero la consola del navegador muestra ese 404.

Supabase: con «Confirm email» desactivado no hace falta tocar *Site URL*; si se activa, añadir la URL de Pages a *Redirect URLs* para que los enlaces de confirmación vuelvan a la app.

## Desarrollo local equivalente a Supabase

`npm run supabase:local` levanta PostgreSQL 16 + Supabase Auth (GoTrue) + PostgREST + pasarela en `http://localhost:54321` y escribe las claves locales en `.local-supabase/env`. Copia las `VITE_*` a `.env.local` para que la app lo use. `reset` recrea la BD desde las migraciones.

## Checklist de release
- [ ] lint, typecheck, test, build en verde
- [ ] `npm run db:test` si hay migraciones
- [ ] `npm run test:cloud`, `npm run e2e` y `npm run e2e:multi` contra staging
- [ ] `npm run check:privacy`
- [ ] CHANGELOG actualizado
- [ ] Probado en desktop, iPad y móvil
