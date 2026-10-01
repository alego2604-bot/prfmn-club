# PRFMN Club

**Business Operating System** para centros de entrenamiento (y, después, cualquier negocio de servicios): caja, ventas, catálogo, clientes, facturación, importación de datos e informes en una única fuente de verdad. Multiempresa y multicentro desde el primer commit. Primer cliente real: **The Gravity Room**.

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

Tests con tus Excel reales (solo en local, nunca se suben al repo):
```bash
PRFMN_CAJA_XLSX=/ruta/CAJA.xlsx PRFMN_FACTURAS_XLSX=/ruta/BeMadBox_Q3.xlsx npm test
```

## Documentación

| Documento | Contenido |
|---|---|
| [PROJECT_MASTER](docs/PROJECT_MASTER.md) | Visión, arquitectura, módulos, sitemap, MVP, riesgos, decisiones, estado |
| [EXCEL_ANALYSIS](docs/EXCEL_ANALYSIS.md) | Análisis fila a fila de los Excel actuales |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Capas, multitenancy, seguridad |
| [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md) | Modelo de datos y RLS |
| [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md) | Tokens, componentes, gráficas |
| [USER_FLOWS](docs/USER_FLOWS.md) | Flujos principales |
| [ROADMAP](docs/ROADMAP.md) | Fases |
| [SETUP](docs/SETUP.md) · [ENVIRONMENT](docs/ENVIRONMENT.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) · [API](docs/API.md) | Operación |
| [DECISIONS](docs/DECISIONS.md) · [CHANGELOG](docs/CHANGELOG.md) | Registro |

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
  migrations/     esquema SQL versionado (0100–0500)
  tests/          stub de Supabase + tests de aislamiento RLS
  rollbacks/      reversión (solo dev/staging)
scripts/db-test.sh
```
