# Architecture

Ver resumen y diagrama en [PROJECT_MASTER §2](PROJECT_MASTER.md#2-arquitectura).

## Capas del frontend
```
features/*  (pantallas)            ← solo presentan y llaman a repositorios
   │
data/repos  (casos de uso)         ← permisos, validación, atomicidad, auditoría
   │
data/store  (persistencia)         ← hoy IndexedDB por empresa; Fase 5: Supabase
   │
domain/*    (lógica pura)          ← IVA, totales, caja, KPIs, alertas: sin I/O, testeada
```
Regla: una pantalla nunca calcula dinero por su cuenta; usa `domain/`.

## Multitenancy
- **Servidor**: fila + RLS con `organization_id` (y `location_id`), FK compuestas. Ver [DATABASE_SCHEMA](DATABASE_SCHEMA.md).
- **Local**: cada empresa es un documento independiente en IndexedDB (`ws:<orgId>`); el índice de cuentas/miembros vive en `meta`. Es estructuralmente imposible leer otra empresa.
- El usuario puede pertenecer a varias empresas (selector en la barra lateral) y estar limitado a centros.

## Autorización
Capacidades (`sales.void`, `catalog.prices`…) en `domain/permissions.ts`, idénticas a `public.role_permissions`. La UI pregunta `can(perm)`; los repositorios vuelven a comprobarlo (la UI no es la barrera de seguridad; en servidor lo será RLS).

## Core vs verticales
`organizations.vertical` + `organization_modules`. Core: ventas, caja, catálogo, clientes, finanzas, documentos, comunicaciones, analytics, importaciones. Fitness: membresías con créditos, asistencia, clases, drop-ins (la navegación los oculta para otros sectores).

## Importación
`features/imports/engine`: `read` (XLSX/CSV) → `analyze` (hojas, cabecera, mapeo por sinónimos, rol) → `salesPlan`/`invoicesPlan` (validación, confianza, duplicados, controles de cuadre, insights) → `commit` (transacción única, `import_records`) → `revertImport` (anula, nunca borra). 100 % puro y testeado con los Excel reales.

## Seguridad
- Sin secretos en el frontend (`.env.example`). Integraciones con secretos → Edge Functions.
- Modo local: contraseña con hash SHA-256 solo como control de acceso básico al dispositivo, **no** es seguridad de servidor (documentado en DECISIONS).
- Exportaciones y copias se generan en el navegador; nada sale a terceros.

## Rendimiento
Rutas con carga diferida; ExcelJS, jsPDF y Recharts en chunks separados que solo se descargan al usarse. Agregados calculados en memoria con `useMemo` (miles de ventas → instantáneo). En servidor: índices `(organization_id, fecha)` ya definidos.
