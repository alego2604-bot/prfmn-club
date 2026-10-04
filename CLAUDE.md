# CLAUDE.md — Business OS

Este archivo son las instrucciones permanentes para cualquier agente (Claude u otro) que trabaje en este repositorio.

## Qué es este proyecto

**Business OS** (nombre interno provisional) es un **software de gestión empresarial SaaS multi-tenant** (multiempresa, multicentro, multisector): un núcleo empresarial común + módulos verticales. El primer módulo vertical es Fitness (boxes, gimnasios, centros de entrenamiento); después retail, restauración, estética, clínicas y servicios.

**Business OS is an independent product and has no runtime dependency on PRFMN.** PRFMN es otro producto (software de training/performance) con su propio repositorio, Supabase, Auth y deploy. Este repositorio no importa, consulta ni comparte nada con él; cualquier conexión futura será opcional y solo por API/webhook (`docs/INTEGRATIONS.md`). No es un prototipo: se construye desde el día uno para producción real, con datos reales, dinero real y múltiples empresas (tenants) aislados entre sí.

**The Gravity Room is the first tenant, not the product itself.** Ningún código puede contener reglas, productos, categorías, tarifas o textos de una empresa concreta (nada de `if (empresa === …)`): todo son datos de cada organización.

Documentación completa en [`/docs`](docs/). Empieza siempre por [`docs/PROJECT_MASTER.md`](docs/PROJECT_MASTER.md) (source of truth, se actualiza con cada decisión relevante) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Reglas no negociables

1. **Nunca romper el aislamiento multi-tenant.** Toda tabla con datos de negocio lleva `organization_id` (y `location_id` si ocurre en un centro), con FK compuestas `(organization_id, id)`. Toda query, política RLS y repositorio filtra por la empresa del usuario autenticado. Una empresa JAMÁS puede leer o escribir datos de otra. Los tests de `supabase/tests/rls_isolation.sql` deben seguir pasando.
2. **Nunca exponer secretos.** Claves de servicio (`service_role`), secretos de Stripe, etc. viven solo en el backend/edge functions. El frontend solo usa claves públicas (`anon key`, `publishable key`).
3. **Nunca introducir claves API sensibles en el frontend.** Si una integración necesita una clave secreta, se hace desde una Supabase Edge Function o backend, nunca desde el cliente.
4. **Nunca hacer cambios destructivos en base de datos sin migración.** Todo cambio de esquema es una migración versionada y reversible (ver `supabase/migrations`). Nunca `DROP` sin `IF EXISTS` + revisión, nunca editar una migración ya aplicada en producción: se crea una nueva.
5. **Toda operación financiera requiere trazabilidad.** Facturas, pagos, devoluciones, ajustes de stock con impacto económico: nunca se hace `DELETE` físico, se anula/versiona manteniendo el histórico (soft-delete o tabla de eventos).
6. **Nunca eliminar funcionalidad estable sin causa justificada y documentada en `docs/DECISIONS.md`.**
7. **No copiar la interfaz ni arquitectura visual de BeMadBox ni de ningún competidor.** Referencia conceptual únicamente.
8. **Independencia de producto.** Nunca usar la base de datos, el Supabase, la autenticación, las tablas, la lógica o los nombres internos de PRFMN ni de otro producto. Si Business OS o PRFMN desaparecieran, el otro debe seguir funcionando al 100 %.
9. **Core sin sector.** Lo específico de un sector va en un módulo vertical (`src/domain/modules.ts`, `organization_modules`), nunca en el núcleo.
10. **Privacidad: código de producto ≠ datos de clientes.** NUNCA introducir en Git datos reales de clientes, DNI/NIF, teléfonos, emails, direcciones, números de factura reales, documentos, información bancaria ni datos financieros detallados de clientes o del negocio de un tenant. Tests: exclusivamente fixtures sintéticos, datos ficticios o anonimizados. Los datos reales existen solo en la base de datos autorizada, el Storage autorizado, las importaciones del usuario y entornos seguros, nunca en el código fuente. Los Excel/CSV/PDF del cliente nunca se versionan. Ver `docs/SECURITY.md`.
11. **Integraciones nunca obligatorias.** Ninguna integración externa (PRFMN incluido) puede ser dependencia obligatoria; los datos de un proveedor se transforman al modelo interno y el histórico importado sigue funcionando si la conexión desaparece. Nunca base de datos compartida.

## Antes de modificar funcionalidad importante

1. **Inspeccionar arquitectura** — leer `docs/ARCHITECTURE.md`, `docs/PROJECT_MASTER.md` y el código relacionado.
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

Supabase es la fuente de verdad (Auth + PostgreSQL + RLS) mediante sincronización transaccional (`src/data/cloud`, `sync_push`); IndexedDB solo como caché/cola offline. Validado contra un stack local equivalente y contra `business-os-staging` (clave pública: `test:cloud`, `e2e`, `e2e:multi`; ver `docs/DEPLOYMENT.md`). Las escrituras grandes se envían por lotes (`splitBatch`); la empresa activa es por pestaña. Migración 0900 (gastos, membresías, tareas, series sincronizables) aplicada y validada en `business-os-staging` (`test:cloud`, `e2e/full.e2e.mjs`); la app detecta servidores sin ella con `server_capabilities()`. Migración 0910 (auditoría de equipo y configuración) versionada y probada en local, pendiente de aplicar en staging. Staging público: GitHub Pages (`docs/DEPLOYMENT.md`). Stripe **no** está conectado. Estado por módulo (PLANNED → PRODUCTION READY) en `docs/PROJECT_MASTER.md §16`: nunca marcar como terminado algo que solo tiene UI.

## Verificación obligatoria

`npm run check:privacy && npm run lint && npm run typecheck && npm test && npm run build` y, si se tocan migraciones, `npm run db:test`. Si se toca persistencia: `npm run test:cloud` y `npm run e2e` contra el stack local o staging. Los cálculos de dinero viven en `src/domain` (con tests); las escrituras pasan por `src/data/repos` (permisos + auditoría). Datos demo solo en la empresa demo (`isDemo`), nunca mezclados con datos reales. Nunca subir los Excel reales del cliente al repositorio (`.gitignore` los bloquea).

## Convenciones de trabajo autónomo

Se puede avanzar sin preguntar en decisiones de detalle (nombres de campos, estructura de componentes, copy de UI, elección de librería auxiliar menor). Se debe **detener y preguntar** ante decisiones que afecten: modelo de negocio, arquitectura principal, seguridad, facturación, riesgo de pérdida de datos, o costes económicos significativos (ej. servicios de pago de terceros). Toda decisión relevante tomada de forma autónoma se documenta en `docs/DECISIONS.md` con el motivo.

## Este repositorio es un producto aislado

Business OS vive en su propio repositorio. En la máquina del propietario puede convivir en una carpeta junto a otros proyectos (por ejemplo prototipos de PRFMN): **no se modifican, no se importan y no se depende de ellos**. Los documentos de la fase en que este repositorio se llamaba «PRFMN Club» están en `docs/archive/` solo como histórico.
