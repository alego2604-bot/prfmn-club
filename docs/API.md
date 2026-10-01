# API

## Hoy (modo local)
La "API" son los repositorios de `src/data/repos/*`. Contrato común:
- Reciben un `Ctx` (usuario, rol, centros permitidos). Sin `Ctx` no se escribe nada.
- Comprueban permiso (`assertCan`) y centro (`assertLocation`) — misma semántica que las políticas RLS.
- Escriben de forma atómica (`store.update`) y añaden su entrada en `auditLogs`.
- No existen operaciones de borrado de registros financieros: `voidSale`, `voidInvoice`, `reopenCashSession`, `revertImport` anulan/versionan.

| Repositorio | Funciones |
|---|---|
| `catalog` | createCategory, updateCategory, createProduct, updateProduct (versiona precio), duplicateProduct, setProductStatus |
| `sales` | createSale (multi-pago, stock), voidSale (devoluciones compensatorias) |
| `cash` | openCashSession, addCashMovement, closeCashSession, reopenCashSession, sessionSummary |
| `customers` | createCustomer, updateCustomer, addCustomerNote |
| `invoices` | markInvoicePaid, voidInvoice |
| `settings` | updateOrganization, addLocation, setLocationStatus, payment methods, tax rates, activity rules |
| `auth` | registerAccount, login, createOrganization, addTeamMember, updateMember |
| `imports/engine/commit` | commitPlan, revertImport, revertBlockers |

## Fase 5 (Supabase)
- Lecturas/escrituras vía PostgREST (`supabase-js`) bajo RLS, mismo modelo (`snake_case`).
- RPC: `public.create_organization(...)` (ya en la migración 0400).
- Operaciones multi-tabla (venta + líneas + pagos, importación, cierre) → funciones `SECURITY INVOKER` transaccionales o Edge Functions.
- Webhooks (Stripe/Redsys/WhatsApp) → Edge Functions con verificación de firma.
- API pública (plan Business): tokens por organización con scopes, rate limiting y auditoría.
