# Billing System

## Entidades

- `rate_plans` — tarifas que el gimnasio vende a sus clientes (Unlimited, 3x/semana, Drop-in...).
- `memberships` — instancia de una tarifa asignada a un cliente, con fechas de inicio/fin/renovación y estado.
- `invoices` + `invoice_lines` — facturas emitidas, con líneas (cuota, producto, bono, ajuste).
- `payments` — intentos de cobro (éxito, fallo, reembolso), vinculados a Stripe PaymentIntents.
- `refunds` — devoluciones, siempre vinculadas a un `payment` original, nunca un borrado.

## Principios

1. **Nunca se borra un movimiento financiero.** Un cobro erróneo se anula/revierte con un `refund` o un `credit_note`, ambos registros nuevos que referencian al original.
2. **Toda factura tiene numeración secuencial por gimnasio** (preparado para normativa española: serie + número + fecha inmutables una vez emitida).
3. **Impuestos como campo explícito** en cada línea (`tax_rate`, `tax_amount`), no calculado ad-hoc en el frontend.
4. **Estados de pago explícitos**: `pending`, `paid`, `failed`, `refunded`, `partially_refunded` — nunca se infiere el estado combinando otros campos.
5. **Stripe es la fuente de verdad para el estado del cobro**; los webhooks actualizan `payments`, la app nunca marca un pago como `paid` solo desde el cliente.

## Flujos

- **Cuota recurrente**: `memberships` genera una factura por ciclo (cron/Stripe Billing) → intento de cobro automático → webhook actualiza estado.
- **Venta puntual (POS/Tienda)**: genera `invoice` (o se agrega a la próxima factura del ciclo si el cliente elige "a cuenta") + `invoice_line` + afecta stock.
- **Impago**: `payment.status = failed` → automatización (ver `AUTOMATIONS.md`) → reintento manual o automático según configuración del gimnasio.

## Preparado para normativa española (a validar con asesoría fiscal antes de producción)

- Serie de facturación por gimnasio.
- NIF/CIF del gimnasio y, si aplica, del cliente en factura.
- Desglose de IVA por línea.
- Conservación de histórico de facturas (no editable tras emisión; correcciones vía factura rectificativa).

> Nota: este documento define el modelo de datos y principios. La validación legal/fiscal definitiva se hace con un asesor antes de emitir facturas reales — se registra como pendiente en `DECISIONS.md`.
