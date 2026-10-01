# Changelog

Formato: fecha, fase, resumen. Más reciente arriba.

## 2026-10-01 — Separación total de PRFMN · Business OS como producto independiente

### HECHO
- Auditoría de dependencias con PRFMN: **ninguna técnica** (sin código, tablas, Supabase, Auth, variables ni servicios compartidos). Solo restos de nombre, ya renombrados.
- Rebranding interno a **Business OS** (UI, paquete, título, exportaciones, PDF, migraciones). Migración automática y segura de datos locales: base IndexedDB `prfmn-club` → `business-os`, claves `prfmn.*` → `bos.*`, contraseñas locales aceptadas y re-cifradas al nuevo formato.
- Core vs vertical: `src/domain/modules.ts`, interruptor del módulo Fitness en Ajustes → Empresa, navegación/dashboard/catálogo/importación condicionados al módulo. Eliminadas las categorías escritas a mano en el dashboard.
- Migración `0600_integrations` (capa opcional de integraciones) + 3 tests nuevos de aislamiento (27 en total). Documentación en `docs/INTEGRATIONS.md`.
- Datos personales reales (DNI/NIF, nº de factura) sustituidos por datos sintéticos en tests y documentación.
- Documentos de la fase «PRFMN Club» movidos a `docs/archive/`. README, PROJECT_MASTER, ARCHITECTURE, DECISIONS, CLAUDE.md, DEPLOYMENT y ENVIRONMENT actualizados con la independencia explícita.
- 30 tests unitarios/integración + 27 comprobaciones SQL + lint + typecheck + build en verde.

### PENDIENTE DEL PROPIETARIO
- Renombrar el repositorio de GitHub (`prfmn-club` → p. ej. `business-os`) y decidir si debe ser **privado** (hoy es público y contiene el análisis económico de la empresa).
- Decidir si se reescribe el historial de git para eliminar los DNI reales de commits antiguos.
- Crear los proyectos Supabase nuevos `business-os-staging` / `business-os-production`.

## 2026-10-01 — Re-alcance a Business OS: definición, esquema SQL probado y MVP funcional (modo local)

### HECHO
- **Producto**: `PROJECT_MASTER.md` (las 15 respuestas pedidas: interpretación, arquitectura, módulos, sitemap, modelo de datos, diseño, MVP, posteriores, riesgos, decisiones, orden, análisis de Excel, reutilización, reestructuración, plan de importación) + `EXCEL_ANALYSIS.md` (fila a fila: 19 problemas de calidad documentados; anonimizado el 2026-10-01).
- **Base de datos**: 5 migraciones (`supabase/migrations`) con ~45 tablas, RLS en todas, FK compuestas por empresa, auditoría append-only por trigger, versionado de precios, numeración de facturas sin huecos, inmutabilidad financiera y RPC de alta de empresa. **24 comprobaciones de aislamiento/permisos/integridad pasan** en PostgreSQL 16 (`npm run db:test`).
- **Design system** nuevo (light + dark), shell por pilares, ⌘K, selector de empresa y centro, notificaciones calculadas, barra móvil.
- **Módulos funcionales**: Acceso (cuenta, empresa, demo separada), Dashboard (Hoy / periodo con comparativas / Año), Caja táctil, Ventas, Cierres, Catálogo, Clientes + ficha, Facturas, Pagos, Importaciones (asistente 6 pasos + historial + reversión), Informes gestoría (XLSX 10 hojas, PDF, CSV), Ajustes (empresa, centros, equipo y roles, métodos de pago, IVA, reglas, auditoría, copia JSON).
- **Tests**: 27 unitarios/integración (Vitest) + 2 con los Excel reales en local + E2E en Chromium (registro → importar ambos Excel → venta → recarga → cierre → informe → desktop/tablet/móvil/dark) sin errores de consola.
- Lint (0 warnings), typecheck y build de producción en verde. Configuración ESLint añadida (el script existía sin config) y script `typecheck` corregido.

### QUÉ FUNCIONA (verificado)
- Importar el Excel de caja real (solo en local): todos los controles de cuadre mensuales ✓, duplicados TPV detectados, fechas de enero corregidas, fila sin producto con candidatos, importe ≠ precio×uds detectado; total importado = total del Excel − filas pendientes de decidir.
- Importar el export de facturas real (solo en local): clientes sin duplicar, IVA y pies de hoja cuadrados, aviso de facturas del trimestre anterior y de huecos de numeración.
- Informe trimestral para gestoría (`Q<n>_<año>_<Empresa>.xlsx` / `.pdf`): facturas por fecha de emisión + caja, IVA por tipo.
- Caja → venta multi-pago → dashboard al instante → cierre cuadrado/descuadre → reapertura versionada.

### QUÉ NO ESTÁ CONECTADO
- Supabase (auth, base de datos, storage): los datos viven en el navegador. Esquema listo y probado.
- Emisión de facturas propias, gastos, membresías, asistencia, seguimiento, inbox/WhatsApp, documentos, analytics avanzados, Copilot, OCR (estados en PROJECT_MASTER §16, marcados «Pronto» en la app, sin botones falsos).

### PROBLEMAS ENCONTRADOS Y CORREGIDOS
- Venta perdida al recargar inmediatamente (debounce de guardado) → escritura inmediata.
- Carrito de Caja cortado en tablet 1024 px → barra lateral oculta en Caja hasta 1280 px.
- «Mejor día» tomaba un resumen mensual importado → solo ventas individuales.
- Etiquetas de formulario no asociadas a su campo → `Field` las asocia automáticamente.

### DECISIONES
Ver `DECISIONS.md` (2026-10-01): organization/location, Vite vs Next.js (pendiente de confirmar), modo local, céntimos/IVA, histórico de precios, no borrar, tratamiento de los Excel, retirada del mock, navegación, gráficas.

### SIGUIENTE ETAPA
1. Crear proyectos Supabase (staging/prod) y SupabaseAdapter + Auth real.
2. Membresías desde las facturas importadas (tarifas detectadas) + importación de asistencia → Seguimiento.
3. Gastos y proveedores; validar IVA y series con la gestoría antes de emitir facturas.

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
