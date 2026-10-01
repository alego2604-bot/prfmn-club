# Business OS

> **Business OS is an independent product and has no runtime dependency on PRFMN.**
> **The Gravity Room is the first tenant, not the product itself.**

**Software de gestión empresarial** (Business Management / CRM / Finance / Operations): caja, ventas, catálogo, clientes, facturación, importación de datos e informes en una única fuente de verdad. Multiempresa, multicentro y multisector: un núcleo común + módulos verticales (el primero, Fitness). «Business OS» es el nombre interno provisional.

Primera empresa cliente (tenant): The Gravity Room. El software funciona igual para cualquier empresa; ningún dato ni regla de una empresa concreta está en el código.

> Empieza por [`docs/PROJECT_MASTER.md`](docs/PROJECT_MASTER.md) (source of truth) y las reglas de [`CLAUDE.md`](CLAUDE.md).

## Estado (2026-10-01)

| | |
|---|---|
| Base de datos | Esquema SQL multi-tenant con RLS, auditoría e inmutabilidad financiera — **probado** en PostgreSQL 16 (`npm run db:test`) |
| App | Funcional en **modo local** (IndexedDB): login, empresa, caja, ventas, cierres, catálogo, clientes, facturas, pagos, importación, informes, ajustes, auditoría |
| Servidor | Supabase **aún no conectado** (Fase 5). Ver estado por módulo en `PROJECT_MASTER.md §16` |

## Arranque rápido

```bash
npm install
npm run dev          # http://localhost:5173
```

Crea una cuenta → crea tu empresa → **Importaciones → Nueva** y sube tus Excel. O pulsa «Explorar con datos de demostración» (empresa demo separada).

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Typecheck + build de producción (`dist/`) |
| `npm run typecheck` | Solo tipos |
| `npm run lint` | ESLint (0 warnings permitidos) |
| `npm test` | Tests unitarios y de integración (Vitest) |
| `npm run db:test` | Aplica las migraciones en un Postgres efímero y ejecuta los tests de RLS/aislamiento |
| `npm run check:privacy` | Bloquea datos personales y secretos en los ficheros versionados |

Tests con tus Excel reales (solo en local, nunca se suben al repo):
```bash
# ficheros y cifras esperadas fuera del repositorio
BOS_CAJA_XLSX=/ruta/caja.xlsx BOS_FACTURAS_XLSX=/ruta/facturas.xlsx BOS_REAL_EXPECT=/ruta/expect.json npm test
```

## Documentación

| Documento | Contenido |
|---|---|
| [PROJECT_MASTER](docs/PROJECT_MASTER.md) | Visión, arquitectura, módulos, sitemap, MVP, riesgos, decisiones, estado |
| [EXCEL_ANALYSIS](docs/EXCEL_ANALYSIS.md) | Formatos Excel de origen y sus problemas de calidad (anonimizado) |
| [SECURITY](docs/SECURITY.md) | Privacidad, secretos, datos de clientes fuera de Git |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Capas, multitenancy, seguridad |
| [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md) | Modelo de datos y RLS |
| [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md) | Tokens, componentes, gráficas |
| [USER_FLOWS](docs/USER_FLOWS.md) | Flujos principales |
| [ROADMAP](docs/ROADMAP.md) | Fases |
| [INTEGRATIONS](docs/INTEGRATIONS.md) | Capa de integración opcional (API/webhooks), sin acoplamiento |
| [SETUP](docs/SETUP.md) · [ENVIRONMENT](docs/ENVIRONMENT.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [API](docs/API.md) | Operación |
| [DECISIONS](docs/DECISIONS.md) · [CHANGELOG](docs/CHANGELOG.md) | Registro |

## Independencia

| | PRFMN | Business OS |
|---|---|---|
| Ámbito | Training / performance (workouts, atletas, scores, leaderboards) | Gestión empresarial (operaciones, clientes, finanzas, datos, analytics) |
| Repositorio | propio | este |
| Base de datos / Supabase / Auth | propios | propios (proyecto nuevo, aún por crear) |
| Deploy y dominio | propios | propios |
| Dependencia del otro | ninguna | ninguna |
| Conexión futura | opcional, por API/webhook ([INTEGRATIONS](docs/INTEGRATIONS.md)) | ← |

## Estructura

```
src/
  app/            shell, sesión, navegación, ⌘K, tema
  design-system/  tokens + componentes (DataTable, Modal, Drawer, Kpi, charts…)
  domain/         lógica pura y testeada: IVA, totales, caja, KPIs, alertas, permisos
  data/           store por empresa (IndexedDB), repositorios con permisos + auditoría, demo
  features/       una carpeta por módulo (pos, sales, cash, catalog, customers, invoices,
                  payments, imports/engine, reports, settings, dashboard, auth)
  lib/            dinero, fechas, NIF, exportación XLSX/CSV
supabase/
  migrations/     esquema SQL versionado (0100–0600)
  tests/          stub de Supabase + tests de aislamiento RLS
  rollbacks/      reversión (solo dev/staging)
scripts/db-test.sh
```
