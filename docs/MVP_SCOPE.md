> **Nota (2026-10-01)**: documento de la fase anterior (modelo `gym_id`, frontend mock). Se conserva como referencia histórica; la fuente de verdad actual es [PROJECT_MASTER.md](PROJECT_MASTER.md).

# MVP Scope

## Objetivo del MVP

Sustituir BeMadBox en The Gravity Room con una plataforma multi-tenant real, cubriendo las operaciones diarias críticas: altas, reservas, check-in, ventas, facturación básica y visibilidad de qué necesita atención.

## Dentro del MVP (Fases 1-10 de este documento de trabajo)

- Autenticación y roles (owner, manager, coach, reception, athlete).
- Multi-tenancy real con RLS desde el primer schema.
- Dashboard con KPIs clave + "Necesita tu atención" (reglas básicas del motor de automatizaciones).
- Clientes + Cliente 360 (con Health Score v1, algoritmo simple y documentado).
- Alta de cliente self-service con aprobación admin.
- Reservas + Calendario + lista de espera + check-in manual (QR/tablet: arquitectura lista, no obligatorio en el MVP).
- POS de venta rápida + Tienda básica + Inventario con alertas de stock mínimo.
- Facturación básica + Pagos vía Stripe + gestión de impagados.
- CRM de leads básico.
- Automatizaciones: catálogo inicial de reglas (ver `AUTOMATIONS.md`), motor simple basado en eventos + cron.
- Comunicaciones: al menos un canal funcional real (Email) con segmentación básica; WhatsApp/Push preparados en arquitectura.
- Configuración del gimnasio (tarifas, equipo/roles, datos fiscales básicos).

## Fuera del MVP (roadmap posterior)

- Workouts / Resultados deportivos completos (se apoya en el prototipo existente como referencia, no se reconstruye en el MVP).
- Analytics avanzado / informes exportables complejos.
- WhatsApp y Push en producción (requiere proveedor y aprobación de plantillas).
- App nativa (se mantiene web app responsive).
- Multi-idioma.
- Stripe Connect multi-gimnasio (en el MVP, un único gimnasio real; el modelo de datos ya soporta más).

## Criterio de éxito del MVP

- The Gravity Room opera un mes completo sin depender de BeMadBox para: altas, reservas, check-in, ventas de tienda, facturación y cobro.
- Cero incidentes de fuga de datos entre tenants (validado con tests de RLS antes de producción).
- Tiempo medio de venta en POS por debajo de 5 segundos en el uso real.
