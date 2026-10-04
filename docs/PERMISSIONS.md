# Permisos, roles y datos sensibles

Fuente de verdad del modelo de permisos de Business OS. Código: `src/domain/permissions.ts` (cliente) y `supabase/migrations` (servidor: 0100 catálogo y roles, 0500 RLS, 0920 aplicación en servidor). Los tests (`permissions.test.ts`, `security.test.ts`, `navigation.security.test.ts`, `rls_isolation.sql`) bloquean que cliente y servidor diverjan.

## 1. Modelo

```
permiso efectivo = (permisos del ROL ∪ grant individual) \ revoke individual
```

- **Rol base** (`roles` + `role_permissions`): owner, admin, manager (encargado), employee (empleado), accountant (contable), read_only (solo lectura). `owner` y `admin` tienen el comodín `*`.
- **Excepciones individuales** (`organization_members.permission_overrides = {"grant":[…],"revoke":[…]}`): permitir o denegar permisos concretos a una persona sin cambiarle el rol. **Denegar siempre gana**, incluso sobre el comodín del propietario.
- La misma regla se aplica en: `app.has_permission` (servidor: RLS, triggers, RPC), `can()` de `permissions.ts` (cliente), `Ctx.overrides` → `assertCan` (repositorios), `session.can` (interfaz), rutas, menú y ⌘K. Un test recorre todas las combinaciones y exige que cliente y servidor coincidan.
- Nombres «de producto» → rol: OWNER=owner · ADMIN=admin · MANAGER=manager · STAFF=employee · FINANCE=accountant · VIEWER=read_only.

### Quién puede dar permisos
- Hace falta `team.manage` (efectivo, también por excepción).
- **El owner no se toca desde la API** (rol, estado, centros, excepciones) y solo hay uno por empresa. Nadie cambia su propio rol, estado, centros ni permisos.
- Solo se concede lo que se tiene: ni un rol con más permisos que los propios, ni un permiso (`grant`) que uno no posee, ni un rol propio con permisos ajenos. Denegar (`revoke`) no tiene esa restricción.
- Todo cambio de rol (`role_change`) y de excepciones (`permission_change`, con de/a) queda en la auditoría.

## 2. Matriz por rol, área y acción

`V` ver · `C` crear · `U` modificar · `X` anular/revertir · `M` gestionar. «✔» = permitido. Permiso real entre paréntesis.

| Área | Acción (permiso) | OWNER | ADMIN | MANAGER | STAFF | FINANCE | VIEWER |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard | V (`dashboard.view`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Customers | V (`customers.view`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| | C/U/M (`customers.manage`) | ✔ | ✔ | ✔ | ✔ | – | – |
| Customers sensitive | V/C/U (`customers.sensitive`) | ✔ | ✔ | – | – | ✔ | – |
| Sales | V (`sales.view`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| | C (`pos.sell`) | ✔ | ✔ | ✔ | ✔ | – | – |
| | X (`sales.void`) | ✔ | ✔ | ✔ | – | – | – |
| Cash | V (`sales.view`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| | C/U: abrir, cerrar, movimientos (`cash.operate`) | ✔ | ✔ | ✔ | ✔ | – | – |
| | X: reabrir cierres (`cash.reopen`) | ✔ | ✔ | ✔ | – | – | – |
| Payments | V (`finance.view`) | ✔ | ✔ | ✔ | – | ✔ | ✔ |
| | C/U/X/M: cobrar facturas y cuotas, devolver (`payments.manage`) | ✔ | ✔ | ✔ | – | ✔ | – |
| Invoices | V (`finance.view`) | ✔ | ✔ | ✔ | – | ✔ | ✔ |
| | C/U/X: emitir, editar borradores, anular (`invoices.manage`) | ✔ | ✔ | – | – | ✔ | – |
| Expenses | V (`finance.view`) | ✔ | ✔ | ✔ | – | ✔ | ✔ |
| | C/U/X (`expenses.manage`) | ✔ | ✔ | – | – | ✔ | – |
| Memberships | V (`customers.view`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| | C/U/X: altas, pausas, bajas, **cobrar cuotas** (`memberships.manage`) | ✔ | ✔ | ✔ | – | – | – |
| Tasks | V (`customers.view`) · C/U (`customers.manage`) | ✔ | ✔ | ✔ | ✔ (C/U) | V | V |
| Imports | V/C (`imports.run`) | ✔ | ✔ | ✔ | – | – | – |
| | X: revertir (`imports.revert`) | ✔ | ✔ | – | – | – | – |
| Reports | V (`analytics.view`) | ✔ | ✔ | ✔ | – | ✔ | ✔ |
| | C: **exportar** CSV/Excel/PDF (`reports.export`) | ✔ | ✔ | – | – | ✔ | – |
| Team | V/C/U/X/M (`team.manage`) | ✔ | ✔ | – | – | – | – |
| Locations | C/U/X (`settings.manage`) | ✔ | ✔ | – | – | – | – |
| Settings | C/U (`settings.manage`) | ✔ | ✔ | – | – | – | – |
| Audit | V (`audit.view`) | ✔ | ✔ | – | – | ✔ | – |

Otros permisos (no son un área de la matriz): `catalog.view/manage/prices`, `attendance.manage`, `communications.send`, `templates.manage`, `documents.manage`.

**Cobro de cuotas y facturas** (decisión de producto 2026-10-04): OWNER, ADMIN, MANAGER y FINANCE sí; STAFF y VIEWER no. Se resuelve por el permiso `payments.manage`, no por nombre de rol. Cobrar una cuota es una operación de **membresías** (`memberships.manage`, que genera su factura de cuota) más el cobro en sí (`payments.manage`); no exige `invoices.manage`. FINANCE cobra facturas pero no gestiona membresías.

**Exportar**: es un permiso propio (`reports.export`) aplicado en un único sitio (`ExportAllowedContext` en `AppShell`): ninguna tabla, presente o futura, ofrece exportar por su cuenta. El MANAGER no exporta salvo excepción individual.

## 3. Datos sensibles de clientes (`customers.sensitive`)

El permiso estaba definido como «ver datos fiscales y de pago de clientes». No se inventan categorías: se aplica a columnas que ya existen.

| Dato | ¿Sensible? | Motivo |
|---|:-:|---|
| NIF/DNI/NIE (`tax_id`, normalizado, validez) | **Sí** | identificación fiscal |
| Dirección, código postal, ciudad (`address`, `postal_code`, `city`) | **Sí** | dato personal / fiscal |
| Razón social (`company_name`) | **Sí** | dato fiscal |
| Fecha de nacimiento (`birth_date`) | **Sí** | dato personal |
| Copia fiscal en la factura (`customer_tax_id`, `customer_address`) | **Sí en la interfaz y exportaciones**; en el servidor, ver §5 | es el NIF/dirección del cliente |
| Nombre, email, teléfono, estado, etiquetas | No | contacto operativo: avisos, cobros y seguimiento los necesitan |
| Notas del cliente | No (sin marca de sensibilidad en el modelo) | sin cambio |
| Documentos | Los gobierna `documents.manage` | sin cambio |

Capas, de fuera adentro:
1. **Servidor (0920)**: las columnas sensibles no se entregan por la API (`customers` sin SELECT de esas columnas; vista `customers_safe` y RPC `customers_sensitive`, que solo devuelve datos con el permiso). Escribirlas exige el permiso (trigger). La auditoría de clientes que contiene esos valores solo la ve quien tiene el permiso. La copia fiscal de la factura la completa el servidor, así quien emite una cuota sin ver el NIF no deja la factura incompleta.
2. **Cliente**: el dispositivo no descarga lo sensible sin permiso (`pullWorkspace`); `workspaceFor()` es la única vista del workspace que leen pantallas, ⌘K, informes y exportaciones, y lo quita igualmente (modo local, defensa en profundidad). Los repositorios impiden guardar datos fiscales sin el permiso y **no borran** los existentes cuando un formulario sin esos campos guarda otros cambios.
3. **Interfaz**: formulario de cliente sin campos fiscales, ficha 360 «Restringidos a tu rol», sin columna NIF en listas, filtros ni «datos fiscales a revisar», ⌘K sin buscar por NIF.
4. **Exportaciones**: salen del workspace ya filtrado; la copia JSON de seguridad también (`exportWorkspaceJson({ canSensitive })`).

## 4. Navegación y acciones

- Una sola tabla de rutas (`src/app/routePermissions.ts`) alimenta los guards de `App.tsx`; un test exige que coincida con el permiso del menú. Escribir la URL de un módulo sin permiso muestra «Sin acceso» (también `/facturas/nueva`, `/facturas/:id/editar`, `/bienvenida`, módulos planificados). Las pestañas de Ajustes se limitan por `?tab=` a las permitidas.
- ⌘K (`src/app/commandSearch.ts`, función pura probada): cada categoría de resultado se construye solo con el permiso de ver esos datos; el NIF no busca sin `customers.sensitive`; un usuario de un centro no encuentra ventas, facturas ni gastos de otro.
- Cliente 360: «Editar ficha», nota y tarea → `customers.manage`; «Factura» → `invoices.manage`; «Cobro» y «Cobrar cuota» → `payments.manage`; membresías → `memberships.manage`; venta → `pos.sell`; datos fiscales → `customers.sensitive`.

## 5. Aplicación en el servidor (migración 0920)

Resumen; detalle en la cabecera de `20261006000920_permissions_enforcement.sql` y pruebas en `supabase/tests/rls_isolation.sql` (sección 0920).

| Riesgo | Antes | Con 0920 |
|---|---|---|
| Un empleado registra cobros de factura/cuota o devoluciones (`sync_push` o PostgREST) | **permitido** (política: `pos.sell` o `payments.manage`) | solo `payments.manage`; el cobro de caja (venta) sigue siendo de quien vende; devolver al anular una venta, de `sales.void` |
| Marcar una factura como cobrada o cobro parcial | solo `invoices.manage` (sin exigir cobros) | cobro/estado de cobro = `payments.manage`; emitir/editar/anular = `invoices.manage` (trigger por campo) |
| Marcar una cuota como cobrada | `memberships.manage` | además `payments.manage` |
| Un ADMIN degrada al owner o se hace owner por PostgREST directo | **permitido** | denegado; nadie cambia lo suyo; un solo owner; no se concede lo que no se tiene |
| `permission_overrides` | sin validar, sin RPC, sin auditoría | validado, RPC `set_member_overrides`, auditado |
| Columnas fiscales de clientes por la API | legibles por todo el que ve clientes | solo vía RPC con `customers.sensitive` |
| MANAGER cobra cuotas | no podía (sin `payments.manage`) | `payments.manage` + emite su factura de cuota (política `source = 'membership'`) |

**Residual conocido**: la copia fiscal impresa en la factura (`invoices.customer_tax_id/address`) la sigue entregando la API a quien tiene `finance.view`: es el contenido del documento fiscal. La interfaz y las exportaciones la ocultan sin `customers.sensitive`. Cerrarlo del todo exige una vista `invoices_safe` análoga (propuesta, no incluida en 0920).
