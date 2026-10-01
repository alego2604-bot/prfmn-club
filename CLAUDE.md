# CLAUDE.md — PRFMN Club

Este archivo son las instrucciones permanentes para cualquier agente (Claude u otro) que trabaje en este repositorio.

## Qué es este proyecto

PRFMN Club es un **Business Operating System SaaS multi-tenant** (multiempresa, multicentro, multisector), especializado inicialmente en boxes de CrossFit, gimnasios funcionales/híbridos, centros HYROX y boutique performance gyms, preparado para retail, restauración, estética y servicios. No es un prototipo: se construye desde el día uno para producción real, con datos reales, dinero real y múltiples gimnasios (tenants) aislados entre sí.

El primer tenant real será **The Gravity Room**, pero ningún código debe asumir que solo existe un gimnasio.

Documentación completa en [`/docs`](docs/). Empieza siempre por [`docs/PROJECT_MASTER.md`](docs/PROJECT_MASTER.md) (source of truth, se actualiza con cada decisión relevante) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Reglas no negociables

1. **Nunca romper el aislamiento multi-tenant.** Toda tabla con datos de negocio lleva `organization_id` (y `location_id` si ocurre en un centro), con FK compuestas `(organization_id, id)`. Toda query, política RLS y repositorio filtra por la empresa del usuario autenticado. Una empresa JAMÁS puede leer o escribir datos de otra. Los tests de `supabase/tests/rls_isolation.sql` deben seguir pasando.
2. **Nunca exponer secretos.** Claves de servicio (`service_role`), secretos de Stripe, etc. viven solo en el backend/edge functions. El frontend solo usa claves públicas (`anon key`, `publishable key`).
3. **Nunca introducir claves API sensibles en el frontend.** Si una integración necesita una clave secreta, se hace desde una Supabase Edge Function o backend, nunca desde el cliente.
4. **Nunca hacer cambios destructivos en base de datos sin migración.** Todo cambio de esquema es una migración versionada y reversible (ver `supabase/migrations`). Nunca `DROP` sin `IF EXISTS` + revisión, nunca editar una migración ya aplicada en producción: se crea una nueva.
5. **Toda operación financiera requiere trazabilidad.** Facturas, pagos, devoluciones, ajustes de stock con impacto económico: nunca se hace `DELETE` físico, se anula/versiona manteniendo el histórico (soft-delete o tabla de eventos).
6. **Nunca eliminar funcionalidad estable sin causa justificada y documentada en `docs/DECISIONS.md`.**
7. **No copiar la interfaz ni arquitectura visual de BeMadBox ni de ningún competidor.** Referencia conceptual únicamente.

## Antes de modificar funcionalidad importante

1. **Inspeccionar arquitectura** — leer `docs/ARCHITECTURE.md`, `docs/MODULE_MAP.md` y el código relacionado.
2. **Localizar dependencias** — qué otros módulos, tablas o componentes usan lo que vas a tocar.
3. **Planificar la implementación** — cambio mínimo y seguro, no reescrituras oportunistas.
4. **Realizar el cambio mínimo seguro.**
5. **Probar** — build, typecheck, y si aplica, flujo manual en navegador.
6. **Revisar regresiones** — ¿algo que funcionaba antes deja de funcionar?
7. **Documentar** — actualizar `docs/CHANGELOG.md` y, si fue una decisión relevante, `docs/DECISIONS.md`.

## Prioridades de ingeniería (en este orden)

Simplicidad → Seguridad → UX/Velocidad percibida → Escalabilidad → Mantenibilidad.

No añadir abstracciones para casos hipotéticos futuros. Tres líneas parecidas son mejores que una abstracción prematura mal encajada.

## Stack

- Frontend: React + TypeScript + Vite (SPA; Next.js pendiente de confirmación del propietario, ver DECISIONS)
- Estilos: Tailwind CSS + design tokens propios (ver `docs/DESIGN_SYSTEM.md`)
- Backend/DB: Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- Pagos: Stripe
- Control de versiones: GitHub, commits pequeños y descriptivos, ramas cuando aporte valor

## Estado actual (ver docs/CHANGELOG.md para detalle)

MVP funcional en **modo local** (IndexedDB, mismo modelo que el SQL) + esquema Supabase escrito y probado en Postgres. Supabase/Stripe **no** están conectados todavía. Estado por módulo (PLANNED → PRODUCTION READY) en `docs/PROJECT_MASTER.md §16`: nunca marcar como terminado algo que solo tiene UI.

## Verificación obligatoria

`npm run lint && npm run typecheck && npm test && npm run build` y, si se tocan migraciones, `npm run db:test`. Los cálculos de dinero viven en `src/domain` (con tests); las escrituras pasan por `src/data/repos` (permisos + auditoría). Datos demo solo en la empresa demo (`isDemo`), nunca mezclados con datos reales. Nunca subir los Excel reales del cliente al repositorio.

## Convenciones de trabajo autónomo

Se puede avanzar sin preguntar en decisiones de detalle (nombres de campos, estructura de componentes, copy de UI, elección de librería auxiliar menor). Se debe **detener y preguntar** ante decisiones que afecten: modelo de negocio, arquitectura principal, seguridad, facturación, riesgo de pérdida de datos, o costes económicos significativos (ej. servicios de pago de terceros). Toda decisión relevante tomada de forma autónoma se documenta en `docs/DECISIONS.md` con el motivo.

## Este directorio es un proyecto aislado

`prfmn-club/` vive dentro de una carpeta de trabajo más amplia que contiene un prototipo previo no relacionado (`PRFMN_TRACK_B_WORKING.html` y variantes, en la raíz de `../`). Ese prototipo es solo referencia funcional futura para el módulo de Workouts — **no se modifica ni se depende de él** desde este proyecto.
