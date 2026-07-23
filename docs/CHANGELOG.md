# Changelog

Formato: fecha, fase, resumen. Más reciente arriba.

## 2026-07-23 — Fase 1 + inicio Fase 2

- Creado el proyecto `prfmn-club/` como carpeta aislada dentro del directorio de trabajo existente (que contiene un prototipo previo no relacionado, `PRFMN_TRACK_B_WORKING.html` y variantes, dejado intacto).
- Git inicializado en `prfmn-club/`.
- Documentación completa creada en `/docs`: visión, PRD, arquitectura, roles, flujos, mapa de módulos, MVP, roadmap, automatizaciones, facturación, POS, decisiones.
- `CLAUDE.md` creado con reglas permanentes de trabajo.
- Detectado que el entorno no tiene Node.js/npm ni Homebrew instalados; requiere instalación manual del usuario en terminal interactivo (no automatizable desde este agente). Ver `DECISIONS.md`.
- Frontend completo escrito a mano (Vite + React 18 + TypeScript + Tailwind), navegable con datos mock, sin ejecutar aún por falta de Node en el entorno:
  - Design system: tokens de color/tipografía + componentes (Button, Card/StatTile, Badge, DataTable, Modal, Drawer, EmptyState, Avatar, Tabs, SearchInput, AttentionCard, HealthScoreRing).
  - Layout admin: Sidebar + Topbar + AdminLayout, navegación completa por router.
  - Módulos construidos a fondo: Dashboard (KPIs + "Necesita tu atención"), Clientes (listado + filtros), Cliente 360 (resumen, health score, reservas, facturación, notas, documentos), Reservas/Calendario (vista día, roster de clase, gestión desde drawer), POS (flujo de venta en 3 pasos: producto → cliente → cobro).
  - Módulos básicos navegables: Leads/CRM (kanban por estado), Tienda, Productos, Inventario (alertas de stock mínimo), Facturas, Pagos, Impagados (con acción de reintento), Comunicaciones (canales + segmentación), Automatizaciones (catálogo de reglas con toggle), Configuración (general, tarifas, equipo, integraciones).
  - Placeholders preparados para Workouts e Informes (fuera del MVP inmediato).
  - Verificación de tipos/build pendiente de que el usuario instale Node.js — ver `DECISIONS.md`.
