> **Nota (2026-10-01)**: documento de la fase anterior (modelo `gym_id`, frontend mock). Se conserva como referencia histórica; la fuente de verdad actual es [PROJECT_MASTER.md](PROJECT_MASTER.md).

# User Roles & Permissions

## Roles

| Rol | Alcance | Descripción |
|---|---|---|
| `superadmin` | Plataforma (todos los tenants) | Equipo PRFMN. Gestiona gimnasios (tenants), planes de suscripción de la plataforma, soporte, salud del sistema. No opera el día a día de ningún gimnasio salvo modo "soporte" auditado. |
| `owner` | Un tenant (gym) | Dueño/administrador del gimnasio. Acceso total a su tenant: finanzas, configuración, todos los módulos. |
| `manager` | Un tenant | Operación diaria amplia. Configurable por el owner: por defecto ve casi todo salvo configuración de facturación/Stripe y borrado de datos financieros. |
| `coach` | Un tenant | Imparte clases, gestiona atletas asignados, workouts y resultados. Sin acceso a datos financieros de clientes ni configuración global. |
| `reception` (staff) | Un tenant | Check-in, POS, gestión de reservas y clientes básicos. Sin acceso a informes financieros agregados ni configuración. |
| `athlete` | Un tenant (su propio perfil) | Cliente final. Solo ve y gestiona su propia información: reservas, pagos propios, compras, perfil. |

## Matriz de permisos (resumen funcional)

Los permisos reales se implementan como capacidades (`capabilities`) por rol, no como roles hardcodeados en cada pantalla — ver `docs/ARCHITECTURE.md#autorización`.

| Módulo | superadmin | owner | manager | coach | reception | athlete |
|---|---|---|---|---|---|---|
| Dashboard financiero | — (por tenant, on-demand) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Dashboard operativo (ocupación, alertas no financieras) | — | ✅ | ✅ | ✅ (parcial) | ✅ (parcial) | ❌ |
| Clientes / Cliente 360 | — | ✅ | ✅ | ✅ (lectura + notas de entreno) | ✅ (lectura + datos básicos) | Solo su propia ficha |
| Leads / CRM | — | ✅ | ✅ | ❌ | ✅ (crear/editar) | ❌ |
| Reservas / Calendario | — | ✅ | ✅ | ✅ (sus clases) | ✅ | Reservar/cancelar propio |
| Check-in | — | ✅ | ✅ | ✅ | ✅ | Autocheck-in propio |
| POS / Tienda | — | ✅ | ✅ | ✅ (venta rápida) | ✅ | Comprar (app) |
| Inventario | — | ✅ | ✅ | ❌ | Lectura | ❌ |
| Facturación / Pagos / Impagados | — | ✅ | ✅ (config. limitada) | ❌ | Lectura de estado de cliente | Solo sus propias facturas/pagos |
| Comunicaciones | — | ✅ | ✅ | Envío a sus atletas | Envío básico | Recibir |
| Automatizaciones | — | ✅ | ✅ (activar/desactivar) | ❌ | ❌ | ❌ |
| Workouts / Resultados | — | ✅ | ✅ | ✅ (crear/editar) | Lectura | Su propio historial |
| Configuración del gimnasio | — | ✅ | Parcial (sin billing/Stripe) | ❌ | ❌ | ❌ |
| Gestión de tenants (alta/baja gimnasios, planes plataforma) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

## Reglas de diseño

- Un **coach no tiene por qué ver información financiera** de los clientes (facturas, pagos, tarifas exactas) salvo que el owner se lo habilite explícitamente.
- Un **manager puede tener casi todos los permisos del owner**, configurable, salvo acciones irreversibles de alto riesgo (borrar el tenant, cambiar la cuenta de Stripe, exportar datos masivos) que quedan reservadas al owner.
- El **owner tiene acceso completo** a su gimnasio, sin excepciones, y es el único rol que puede modificar quién es manager.
- **PRFMN Superadmin** nunca accede a datos de un tenant en el día a día; solo en modo soporte explícito, auditado y con log visible para el owner del tenant afectado.

## Implementación técnica (adelanto, ver ARCHITECTURE.md)

- Tabla `memberships_staff` (o `gym_users`): relaciona `user_id` ↔ `gym_id` ↔ `role` ↔ `permissions_overrides` (JSON de capacidades específicas activadas/desactivadas sobre la base del rol).
- Un mismo `user_id` (persona) podría en el futuro tener roles en más de un gimnasio (ej. un coach freelance), por eso el rol se asocia a la relación usuario-gimnasio, nunca al usuario global.
- RLS de Postgres valida `gym_id` + rol en cada política, nunca solo en el frontend.
