# Module Map

Mapa funcional de todos los módulos de PRFMN Club, su estado en el MVP de frontend (Fase 2, mock data) y su dependencia principal de datos.

| Módulo | Descripción | Estado Fase 2 | Entidades principales |
|---|---|---|---|
| Dashboard | Briefing diario, KPIs, "Necesita tu atención" | ✅ Completo (mock) | kpis, attention_items |
| Clientes | Listado, filtros, búsqueda | ✅ Completo (mock) | clients |
| Cliente 360 | Ficha completa de cliente | ✅ Completo (mock) | clients, bookings, payments, invoices, notes, health_score |
| Leads / CRM | Pipeline comercial | ✅ Completo (mock) | leads |
| Tarifas | Catálogo de tarifas/planes | ✅ Básico (mock) | rate_plans |
| Membresías | Estado de membresía por cliente | ✅ Integrado en Cliente 360 | memberships |
| Reservas | Reservar/cancelar/lista de espera | ✅ Completo (mock) | bookings, waitlist |
| Calendario | Vista día/semana de clases | ✅ Completo (mock) | classes, class_sessions |
| Clases | Definición de clases y aforos | ✅ Integrado en Calendario | classes |
| Check-in | Manual / QR / tablet (arquitectura) | ⚙️ Preparado, UI básica | checkins |
| Coaches / Staff | Gestión de equipo | ✅ Básico (mock) | staff |
| TPV / POS | Venta rápida | ✅ Completo (mock) | pos_sales, products |
| Tienda | Catálogo completo, categorías | ✅ Básico (mock) | products, categories |
| Productos | Alta/edición de producto | ✅ Básico (mock) | products |
| Inventario / Stock | Stock y alertas de mínimos | ✅ Básico (mock) | products (stock fields) |
| Facturación | Facturas, líneas, estados | ✅ Básico (mock) | invoices, invoice_lines |
| Pagos | Cobros, métodos | ✅ Básico (mock) | payments |
| Impagados | Gestión de pagos rechazados | ✅ Básico (mock) | payments (status=failed) |
| Comunicaciones | Push/Email/WhatsApp, segmentación | ✅ Básico (mock) | messages, segments |
| Automatizaciones | Motor de reglas | ✅ Básico (mock, catálogo de reglas) | automation_rules, automation_events |
| Informes | Reportes tabulares | ⚙️ Placeholder | — |
| Analytics | Analítica avanzada | ⚙️ Placeholder | — |
| Workouts | Programación de entrenamientos | ⚙️ Placeholder (referencia futura a prototipo existente) | — |
| Resultados deportivos | PRs, resultados de WOD | ⚙️ Placeholder | — |
| Configuración | Ajustes del gimnasio, roles, tarifas base | ✅ Básico (mock) | gym_settings |

Leyenda: ✅ Completo/Básico funcional con mock data y navegación real · ⚙️ Placeholder con estructura preparada, sin funcionalidad completa aún.

## Navegación Admin (desktop/tablet-first)

```
Dashboard
Clientes
  └ Cliente 360 (detalle)
Leads (CRM)
Reservas
  └ Calendario (día/semana)
POS
Tienda
  ├ Productos
  └ Inventario
Facturación
  ├ Facturas
  ├ Pagos
  └ Impagados
Comunicaciones
Automatizaciones
Informes (placeholder)
Configuración
  ├ General
  ├ Tarifas
  ├ Equipo / Roles
  └ Integraciones
```

## Navegación Athlete App (mobile-first, referencia — no se construye en Fase 2)

```
Inicio
Reservar
Training
Shop
Perfil
```
