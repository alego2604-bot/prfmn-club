# Database Schema

Fuente de verdad: `supabase/migrations/*.sql` (probadas con `npm run db:test`). Este documento resume.

## Convenciones
- `organization_id uuid not null` en toda tabla de negocio; `location_id` en lo que ocurre en un centro.
- **FK compuestas** `(organization_id, x_id) → x(organization_id, id)`: imposible enlazar registros de dos empresas aunque se conozca el id.
- Dinero en céntimos `bigint`; IVA en puntos básicos (`2100` = 21 %). Precios de venta con IVA incluido; cada línea guarda base, cuota y total (`total = base + iva` por CHECK).
- Sin borrado físico en finanzas (trigger `app.forbid_mutation`); catálogo, clientes y configuración se archivan.
- `audit_logs` append-only, alimentada por trigger genérico `app.audit_row()` con diff por campo y acción inferida (`price_change`, `void`, `archive`…).

## Tablas
| Grupo | Tablas |
|---|---|
| Plataforma | `platform_plans`, `organizations`, `organization_subscriptions`, `organization_modules`, `organization_settings`, `organization_counters` |
| Identidad | `profiles`, `permissions`, `roles`, `role_permissions`, `organization_members` (rol + `location_ids` + overrides) |
| Configuración | `locations`, `tax_rates`, `payment_methods` (`affects_cash_drawer`), `document_series` |
| Catálogo | `product_categories`, `products`, `product_prices` (vigencias, trigger de versionado), `membership_plans`, `membership_plan_versions` |
| Clientes | `customers` (NIF normalizado único), `customer_memberships` (→ versión de tarifa), `attendance`, `customer_notes` (`suppress_alerts_until`), `tasks` |
| Comunicación | `message_templates`, `communications` |
| Operaciones | `cash_sessions` (1 abierta por centro), `cash_movements`, `cash_closings` (versionados, diferencia y estado calculados), `sales`, `sale_items` (snapshot), `stock_movements` |
| Finanzas | `invoices` (emisión ≠ periodo de servicio, numeración sin huecos), `invoice_items`, `membership_charges`, `payments` (cargos y devoluciones), `suppliers`, `expense_categories`, `expenses`, `bank_transactions` |
| Datos | `documents`, `document_links`, `imports`, `import_records`, `notifications`, `audit_logs` |

## Relaciones clave
- `sales 1—n sale_items`, `sales 1—n payments` (pago dividido), `invoices 0..1 → sales`.
- `customer_memberships → membership_plan_versions` (el precio histórico nunca cambia) → `membership_charges` → factura/venta → pagos.
- Todo lo importable lleva `import_id` → `imports`; `import_records` enlaza cada fila de origen con la entidad creada.

## Seguridad (RLS)
- Funciones `SECURITY DEFINER`: `app.is_member(org)`, `app.has_permission(org, perm)`, `app.can_access_location(org, loc)`.
- Lectura: permiso de lectura del módulo (+ centro). Escritura: permiso de escritura. Sin políticas DELETE en tablas de negocio.
- Ventas: anular requiere `sales.void`; cierres: reabrir requiere `cash.reopen`; cambiar precio requiere `catalog.prices` (trigger).
- Alta de empresa solo por RPC `public.create_organization()` (crea centro, owner, IVA, métodos de pago, series, módulos por vertical).

## Integridad comprobada por tests (`supabase/tests/rls_isolation.sql`)
Aislamiento entre empresas (lectura/escritura/actualización), FK compuestas, histórico de precios, ventas/pagos/cierres/facturas inmutables, numeración correlativa, auditoría con autor, append-only incluso para el owner de la BD, y permisos de employee (por centro) y accountant.
