# Changelog

Formato: fecha, fase, resumen. Más reciente arriba.

## 2026-07-23 — Fase 3: revisión UX y interactividad del mock (sin ejecución local)

Sesión de trabajo dedicada exclusivamente a mejorar el frontend mock ya existente — sin backend, sin Stripe, sin instalar nada en el sistema. Entorno de trabajo confirmado sin Node.js disponible; se decidió posponer toda ejecución/validación real hasta un Mac mini dedicado (ver `DECISIONS.md`).

- **Navegación móvil**: la Sidebar se ocultaba por completo por debajo de 1024px sin ninguna alternativa — bug crítico de usabilidad. Añadido `MobileNav` (drawer con hamburguesa) compartiendo config con `Sidebar` vía `src/layouts/nav.ts`. `Tabs` ahora hace scroll horizontal en vez de desbordar.
- **Dashboard** rediseñado como Gym OS: acciones rápidas, "Necesita tu atención" ordenado por severidad, "Operativa de hoy" (clases + reservas/ocupación), "Estado del negocio" agrupado por categoría en vez de una rejilla plana de 12 KPIs.
- **Clientes**: filtros derivados (Riesgo/Impagados/Nuevos/Inactivos en vez de solo estado), columna de alertas y estado de pago. Lógica compartida con Cliente 360 vía `src/lib/clientInsights.ts`.
- **Cliente 360**: estado/pago/health score visibles en el header (sin entrar a ninguna pestaña); 5 acciones rápidas ahora funcionan de verdad con estado local (notas, gestión de membresía, contacto).
- **POS**: eliminado el paso de pago independiente del flujo por defecto — seleccionar cliente confirma la venta (3 toques: producto → cliente → confirmación). Añadido selector de modo de cobro, clientes recientes, e integración con Cliente 360 vía `?clientId=`.
- **Reservas**: añadir atleta/invitado, pasar asistencia y gestionar lista de espera pasan de botones decorativos a acciones reales sobre estado local, con confirmación visual.
- **Leads/CRM**: avance de etapa de un toque, alta de nuevo lead, grid responsive corregido (empezaba en 2 columnas incluso en 375px).
- **Impagados/Inventario**: reintentar cobro, contactar y reponer stock pasan de botones inertes a acciones con estado de carga/confirmación.
- **Corrección de build preventiva**: `vite.config.ts` no resolvía el alias `@/` usado en todo el código (solo estaba en `tsconfig.json`, que no afecta al bundler). Añadido `resolve.alias` en Vite antes de que nadie llegara a ejecutar `npm run build` — ver `DECISIONS.md`.
- Creados `docs/MAC_MINI_SETUP.md` y `docs/DEVELOPMENT_HANDOFF.md` para poder cambiar de máquina sin perder contexto.
- 9 commits pequeños e incrementales sobre el commit estable anterior (`9d9374b`), ninguno reescribe historia.

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
