> **Nota (2026-10-01)**: documento de la fase anterior (modelo `gym_id`, frontend mock). Se conserva como referencia histórica; la fuente de verdad actual es [PROJECT_MASTER.md](PROJECT_MASTER.md).

# POS System

## Objetivo

Una venta de producto frecuente (agua, café, barrita) completada por un coach mientras dirige una clase debe tardar **menos de 5 segundos** desde abrir el POS hasta la confirmación.

## Diseño de interacción

```
+ VENTA
  → Grid de productos frecuentes (botones grandes, tap-friendly): Agua · Café · Barrita · Shake
  → (si no es frecuente) categorías secundarias: Ropa · Accesorios · Otros
  → Selección de cliente: buscador con autocompletado por nombre/nº o "Venta anónima"
  → Modo de cobro: Cobrar ahora · A cuenta del cliente · A próxima factura
  → Confirmado
```

- Botones de producto grande (mínimo 88×88px táctil), con imagen + nombre + precio.
- Buscador de cliente con resultados instantáneos (mock: filtrado en memoria; real: búsqueda indexada).
- Confirmación visual inmediata (toast + vuelta automática al grid para la siguiente venta).

## Reglas

- Toda venta descuenta stock del producto en tiempo real (ver `DATABASE_SCHEMA.md#products`).
- Toda venta genera una línea de factura/ticket, nunca se pierde información de una venta (trazabilidad, ver `BILLING_SYSTEM.md`).
- "A cuenta del cliente" y "A próxima factura" son formas de diferir el cobro, no de omitir el registro de la venta.
- El POS debe funcionar en tablet y en desktop; es el módulo con mayor prioridad de rendimiento percibido junto al Dashboard.
