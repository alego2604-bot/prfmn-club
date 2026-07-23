# Decisions Log

Registro de decisiones técnicas/producto relevantes tomadas de forma autónoma, con motivo. Formato: fecha — decisión — motivo — alternativas consideradas.

## 2026-07-23 — Proyecto aislado en subcarpeta `prfmn-club/`

**Decisión**: crear el nuevo proyecto en `prfmn-club/`, dejando intactos todos los archivos y carpetas `PRFMN_*` existentes en el directorio padre.

**Motivo**: el directorio de trabajo ya contenía un prototipo funcional previo (app de workouts en un solo archivo HTML, con Supabase real conectado, múltiples iteraciones/pilotos). No es el mismo producto que "PRFMN Club" (SaaS de gestión multi-tenant), pero destruirlo o mezclarlo habría violado la regla explícita de no destruir funcionalidad existente. Confirmado con el usuario antes de proceder.

**Alternativas consideradas**: reorganizar todo el directorio moviendo lo existente a `legacy/` (descartada por el usuario, se prefirió la opción menos invasiva).

## 2026-07-23 — Nuevo proyecto Supabase dedicado

**Decisión**: PRFMN Club usará un proyecto Supabase nuevo y propio, no el que ya usa el prototipo de workouts existente.

**Motivo**: el proyecto Supabase existente ya tiene usuarios/datos reales de auth y resultados deportivos; reutilizarlo para una arquitectura multi-tenant desde cero habría arriesgado esos datos y mezclado modelos de datos incompatibles (el existente no es multi-tenant). Confirmado con el usuario.

**Pendiente**: crear el proyecto Supabase real ocurre en Fase 4; hasta entonces el frontend usa exclusivamente mock data en memoria.

## 2026-07-23 — Multi-tenancy por fila (RLS) en lugar de schema-per-tenant

**Decisión**: un único schema Postgres compartido, aislamiento vía `gym_id` + Row Level Security, en lugar de un schema (o base de datos) por gimnasio.

**Motivo**: con la escala esperada (decenas/cientos de gimnasios, no miles), este modelo es más simple de migrar, mantener y sobre el que reportar de forma agregada para el superadmin, sin sacrificar aislamiento real si las políticas RLS están bien diseñadas y testeadas. Se revisará si el volumen real lo justifica (ver `ARCHITECTURE.md#escalabilidad-prevista`).

**Alternativas consideradas**: schema-per-tenant (más aislamiento físico pero mucha más complejidad operativa de migraciones); base de datos separada por tenant (descartada, coste operativo desproporcionado en este estadio).

## 2026-07-23 — Entorno sin Node.js/npm/Homebrew

**Decisión/hallazgo**: el entorno de ejecución de este agente no tiene Node.js, npm ni Homebrew instalados, y la instalación de Homebrew requiere una contraseña de administrador de macOS que no puede introducirse de forma no interactiva.

**Motivo**: limitación del entorno, no una decisión de producto. Se documenta porque bloquea la ejecución (`npm install`, `npm run dev`) hasta que el usuario instale Node manualmente. Todo el código fuente se escribe igualmente, listo para ejecutar en cuanto exista el runtime.

## Pendiente de validación legal/fiscal

**Nota**: el modelo de facturación (`BILLING_SYSTEM.md`) está preparado conceptualmente para normativa española (series, IVA, NIF/CIF) pero no ha sido validado por un asesor fiscal. No se debe emitir facturas reales en producción sin esa validación.
