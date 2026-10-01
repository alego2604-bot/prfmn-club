> **Nota (2026-10-01)**: documento de la fase anterior (modelo `gym_id`, frontend mock). Se conserva como referencia histórica; la fuente de verdad actual es [PROJECT_MASTER.md](PROJECT_MASTER.md).

# Product Requirements Document (PRD)

## Resumen

PRFMN Club es una plataforma SaaS multi-tenant de gestión integral para gimnasios de entrenamiento funcional/híbrido y afines. Este documento define el alcance funcional completo objetivo (no solo el MVP — ver `MVP_SCOPE.md` para el corte de la primera versión productiva).

## Objetivos de negocio

1. Sustituir la herramienta de gestión actual (BeMadBox) en The Gravity Room sin pérdida de funcionalidad crítica.
2. Reducir el tiempo operativo diario del propietario mediante detección proactiva de problemas (churn, impagados, stock, leads fríos).
3. Ofrecer una experiencia de reserva y compra al atleta significativamente más rápida y agradable que las alternativas del mercado.
4. Preparar la base para vender la plataforma a otros gimnasios (multi-tenant real desde el día 1).

## Requisitos funcionales por módulo

### Registro y alta de clientes
- Alta autoservicio: cuenta → datos personales → tarifa → método de pago → contrato → solicitud enviada.
- Solicitud queda `pending_approval`; el staff puede Aceptar, Modificar tarifa o Rechazar.
- Al aceptar: se activa usuario + membresía + facturación + acceso a reservas + ficha CRM + registro de alta + trigger opcional de automatización de bienvenida.

### Cliente 360
- Ficha única con: datos personales, estado, tarifa, membresía, fecha de alta, antigüedad, última visita, frecuencia, reservas, asistencias, cancelaciones, no-shows, pagos, facturas, compras, productos consumidos, comunicaciones, notas, documentos, alertas, actividad reciente, Client Health Score.

### Client Health Score
- Score 0-100 calculado a partir de: frecuencia actual vs. histórica, caída de asistencia, antigüedad, cancelaciones, no-shows, pagos fallidos, inactividad, interacción, reservas futuras.
- Se muestra con nivel de riesgo de baja (bajo/medio/alto). Arquitectura preparada para recalcular el algoritmo sin cambiar el contrato de datos (`docs/DATABASE_SCHEMA.md#health_score`).

### Automatizaciones
- Motor de reglas evento/condición → acción. Catálogo inicial en `docs/AUTOMATIONS.md`.

### Reservas
- Atleta: ver horario, reservar, cancelar, lista de espera, ver plazas disponibles.
- Admin/staff: vista día/semana, crear/modificar/cancelar clase, cambiar aforo, añadir atleta o invitado, gestionar lista de espera, pasar asistencia.

### Check-in
- Arquitectura preparada para manual, QR y tablet de recepción. No es obligatorio implementar las tres en el MVP.

### POS / Venta rápida
- Objetivo: venta frecuente completada en <5 segundos.
- Botones grandes con productos frecuentes (agua, café, barrita, shake) y categorías secundarias (ropa, accesorios, otros).
- Cobro inmediato, a cuenta del cliente, o a próxima factura.

### Tienda
- Categorías: bebidas, alimentación, ropa, accesorios, merchandising, eventos, bonos.
- Preparado para Apple Pay / Google Pay / tarjeta vía Stripe.
- Accesible desde app del atleta.

### Inventario
- Cada venta afecta stock. Alertas de stock mínimo. Producto: nombre, SKU, categoría, coste, precio, impuestos, stock, stock mínimo, margen, activo/inactivo, imagen.

### Facturación
- Facturas, líneas, membresías, pagos, vencimientos, cobros, devoluciones, pagos rechazados, estados, impuestos, productos, bonos, drop-ins.
- Preparado para normativa española (NIF/CIF, series de facturación, IVA).
- Trazabilidad total: ningún movimiento financiero se borra sin histórico.

### Dashboard
- Responde: ¿qué está pasando hoy?, ¿qué necesita mi atención?, ¿cómo va el negocio?
- KPIs: socios activos, reservas hoy, ocupación, ingresos del mes, MRR, ticket medio, altas, bajas, churn, leads, conversión, ventas tienda, impagados.
- Sección "Necesita tu atención" con acciones directas resolutivas desde el propio dashboard.

### Leads / CRM
- Estados: nuevo, contactado, prueba, oferta, ganado, perdido.
- Campos: nombre, teléfono, email, origen, interés, notas, responsable, última interacción, siguiente acción.
- Fuentes: Instagram, WhatsApp, Web, Google, Referral, Walk-in, Otros.

### Comunicaciones
- Canales: Push, Email, WhatsApp (arquitectura preparada; proveedor concreto se decide en Fase 11).
- Segmentación: todos, activos, inactivos, nuevos, impagados, por tarifa, por clase, por grupo, segmento personalizado.

### App Atleta
- Mobile-first. Navegación: Inicio, Reservar, Training, Shop, Perfil. Sin complejidad administrativa visible.

### Admin
- Desktop/tablet-first, funcional también en móvil.

## Requisitos no funcionales

- Aislamiento multi-tenant verificado con tests de RLS (ningún query cross-tenant posible).
- Tiempo de carga percibido del dashboard y POS priorizado sobre cualquier otra pantalla.
- Accesibilidad básica (contraste, tamaños táctiles ≥44px en POS/reservas móvil).
- Todo dato financiero auditable retroactivamente.

## Fuera de alcance del PRD inicial (posible roadmap)

- Multi-idioma (se diseña el copy en español, arquitectura de i18n preparada pero no poblada).
- Marketplace de gimnasios para el usuario final (descubrir gimnasios PRFMN Club).
- App nativa (se parte de web app responsive/PWA-ready).
