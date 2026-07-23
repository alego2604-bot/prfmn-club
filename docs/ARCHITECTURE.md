# Architecture

## Visión general

PRFMN Club es una SPA de React servida estáticamente, respaldada por Supabase (Postgres + Auth + Storage + Edge Functions) y Stripe para pagos. Arquitectura multi-tenant por fila (`row-level multi-tenancy`) sobre un único cluster Postgres compartido, aislado mediante Row Level Security (RLS).

```
┌─────────────────────────────┐
│   React SPA (Admin)         │  desktop/tablet-first
│   React SPA (Athlete) *fase │  mobile-first, futura app separada o subruta
└──────────────┬──────────────┘
               │ HTTPS (supabase-js)
               ▼
┌─────────────────────────────┐
│  Supabase                    │
│  - Auth (JWT, roles)         │
│  - Postgres + RLS            │
│  - Storage (docs, imágenes)  │
│  - Edge Functions (Deno)     │
│     · Stripe webhooks        │
│     · lógica sensible/servidor│
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Stripe                      │  pagos, suscripciones, webhooks
└─────────────────────────────┘
```

## Por qué este stack

- **Supabase sobre backend propio**: Postgres real (no NoSQL disfrazado), RLS nativo para multi-tenancy, Auth integrado, Storage y Edge Functions cubren el 90% de necesidades sin mantener infraestructura propia. Acelera Fases 4-10 sin sacrificar control sobre el modelo de datos.
- **Row-level multi-tenancy sobre schema-per-tenant**: con decenas/cientos de gimnasios (no miles), un único schema con `gym_id` + RLS es más simple de mantener, migrar y sobre el que reportar (analytics cross-tenant para el superadmin) que un schema por tenant. Se documenta como decisión en `docs/DECISIONS.md`.
- **Stripe** como único proveedor de pagos: Connect permite en el futuro que cada gimnasio tenga su propia cuenta conectada (los cobros van directamente al gimnasio, PRFMN cobra comisión de plataforma vía `application_fee`), sin manejar nunca datos de tarjeta.
- **React + TypeScript + Vite**: DX rápido, tipado fuerte en un dominio con muchas entidades relacionadas (clientes, facturas, reservas) donde los errores de forma de datos son costosos.
- **Tailwind CSS**: velocidad de construcción de UI + design tokens propios (ver `DESIGN_SYSTEM.md`) para lograr consistencia sin un framework de componentes pesado.

## Multi-tenancy: el contrato central

**Toda tabla de negocio tiene una columna `gym_id UUID NOT NULL REFERENCES gyms(id)`.**

Reglas:

1. Ninguna query de aplicación filtra manualmente por `gym_id` como única defensa — eso es responsabilidad de RLS. El filtrado en la app es una optimización, no la barrera de seguridad.
2. Toda política RLS sigue el patrón:
   ```sql
   using (gym_id = (select gym_id from public.gym_members where user_id = auth.uid() and gym_id = <tabla>.gym_id))
   ```
   implementado vía función `auth.current_gym_ids()` que devuelve los `gym_id` a los que el usuario autenticado pertenece (normalmente uno, potencialmente varios para coaches multi-gimnasio).
3. El `service_role` de Supabase (bypassa RLS) **solo se usa en Edge Functions**, nunca se expone al cliente.
4. El superadmin de plataforma no tiene un "bypass" implícito: accede a través de una tabla `platform_admins` y políticas específicas de solo lectura + un modo soporte auditado (tabla `support_access_log`).

Ver `docs/DATABASE_SCHEMA.md` para el detalle de tablas y políticas.

## Autenticación

- Supabase Auth (JWT). Un `auth.users` por persona real.
- Tabla `gym_members (user_id, gym_id, role, permission_overrides, status)` — relación N:M entre usuarios y gimnasios, con rol por relación (ver `USER_ROLES.md`).
- El JWT no lleva el rol directamente (evita tokens obsoletos tras cambios de permiso); el rol se resuelve en cada request vía RLS/función contra `gym_members`.
- App atleta y app admin comparten el mismo sistema de Auth; el router decide la experiencia según el rol activo.

## Autorización

Modelo de **capacidades** (`capabilities`), no roles hardcodeados en componentes:

```ts
type Capability =
  | "clients.view" | "clients.edit"
  | "billing.view" | "billing.manage"
  | "bookings.manage" | "pos.sell"
  | "automations.manage" | "settings.manage"
  | /* ... */;

const ROLE_CAPABILITIES: Record<Role, Capability[]> = { /* ... */ };
```

Un componente pregunta `can("billing.view")`, no `role === "owner"`. Esto permite `permission_overrides` por usuario sin tocar el código de UI. Ver implementación en `src/lib/permissions.ts`.

## Frontend

- **Vite + React + TypeScript**, `react-router` para enrutado.
- Estructura por *features* (no por tipo de archivo): cada módulo (`clients`, `bookings`, `pos`, ...) contiene sus componentes, hooks y tipos.
- Capa de datos desacoplada: en Fase 2 los "repositorios" leen de `src/mocks`; en Fase 5 se sustituyen por llamadas a `supabase-js` sin cambiar la interfaz que consumen los componentes (patrón repositorio/adapter).
- Un único Design System (`src/design-system`) con primitivos (Button, Card, Badge, DataTable, Modal, Drawer, EmptyState, StatTile...) reutilizados en todos los módulos.

## Backend / lógica de servidor

- **Edge Functions** (Deno, en `supabase/functions/`) para:
  - Webhooks de Stripe (pagos, impagados, suscripciones).
  - Cualquier lógica que requiera `service_role` o secretos (envío de emails/WhatsApp vía proveedor, cálculo de Health Score si se vuelve pesado, generación de facturas con numeración legal).
  - Cron jobs de automatizaciones (evaluación periódica de reglas, ver `AUTOMATIONS.md`).
- Nunca se llama a APIs de terceros con claves secretas desde el frontend.

## Multi-tenant + planes de plataforma

Además de `gyms`, existe `platform_plans` (planes que PRFMN vende a los gimnasios: nº de usuarios, módulos activos, límites). Esto es independiente de las `rate_plans`/tarifas que cada gimnasio vende a sus propios clientes — son dos capas de "planes" distintas y no deben confundirse en el modelo de datos.

## Escalabilidad prevista

- Índices compuestos `(gym_id, *)` en todas las tablas de alto volumen (bookings, payments, messages).
- Particionado por `gym_id` o por fecha se evalúa solo si el volumen real lo exige (no se implementa prematuramente).
- Analytics cross-tenant (para superadmin) vía vistas materializadas o un pequeño data warehouse (ej. tabla de hechos agregada por día/gym), nunca queries en caliente sobre tablas transaccionales.

## Seguridad — resumen

- RLS en el 100% de las tablas con `gym_id`.
- Ninguna clave secreta en el frontend (`.env` del frontend solo con claves públicas prefijadas `VITE_PUBLIC_*`).
- Auditoría de acciones sensibles (cambios de tarifa, anulaciones de factura, accesos de soporte) en tablas de log append-only.
- Ver también `docs/DECISIONS.md` para el registro de decisiones de seguridad tomadas.
