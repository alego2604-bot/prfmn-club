# Changelog

Formato: fecha, fase, resumen. Más reciente arriba.

## 2026-10-02 — Validación completa contra business-os-staging (schema 900)

### HECHO
- `server_capabilities()` en staging → `{schema: 900, features: [expenses, suppliers, memberships, tasks, invoice_editor, onboarding]}` (anónimo: denegado 42501).
- `test:cloud` contra staging sin omisiones (incluida la prueba de finanzas que antes se saltaba) y prueba nueva `staging900.integration.test.ts`: protecciones de facturas emitidas (líneas ni se borran ni se editan), gastos sin borrado, ciclo completo de membresías (PENDING / ACTIVE / PAST_DUE / PAUSED / CANCELLED / EXPIRED, cambio de tarifa, cuotas con factura), MRR, multicentro (gastos generales solo en el consolidado), empleado sin acceso a gastos (ni por RPC ni por PostgREST), aislamiento entre empresas.
- E2E de navegador completo (`e2e/full.e2e.mjs`, 39 pasos) contra staging: puesta en marcha de 10 pasos, gastos, facturación, membresías con ficha 360, tareas, caja por centro, finanzas, logout/login, multiempresa por pestaña, segundo navegador (iPad) en ambos sentidos, móvil e iPad vertical sin desbordamiento.
- Demo completa sembrada en staging con la 0900 (cuenta sintética `demo-900@empresa.test`): 2 centros, 64 clientes, 4.277 ventas, 477 facturas, 4.747 cobros, 91 cierres, 10 proveedores, 124 gastos, 60 membresías, 475 cuotas, 10 tareas. Repetir la siembra no duplica nada.
- Staging público preparado en GitHub Pages (workflow + ruta base). El build pasa en Actions; falta activar Pages en el repositorio.

### FALLOS ENCONTRADOS Y CORREGIDOS
1. Cambiar el precio de una tarifa (o el IVA por defecto) enviaba la fila nueva antes de cerrar la vigente: el índice «solo una vigente» rechazaba el lote y las membresías con la versión nueva fallaban por FK.
2. Una descarga del servidor podía pisar un cambio confirmado durante la propia descarga (el paso «Centros» de la puesta en marcha se perdía al invitar a alguien justo después).
3. Botones sin `type` dentro de formularios actuaban como *submit*: pulsar «Pendiente de pago» registraba el gasto a medias (55 botones corregidos + regla de lint).
4. La puesta en marcha daba por hechos los datos fiscales con los campos obligatorios vacíos (facturas con «NIF pendiente»).
5. «Cuotas vencidas» mostraba 0,00 € cuando la cuota vencida aún no se había emitido.
6. Menús sin `role=menu/menuitem` y casillas de fila sin etiqueta (lectores de pantalla).
7. CI: la ruta base de Pages se aplicaba también a los tests.

### LIMITACIONES
- `sync_push` ignora en silencio (sin error) un `delete` de líneas de una factura ya emitida: los datos quedan protegidos, pero el cliente no recibe aviso. Mejorable con una migración futura.
- La batería SQL `rls_isolation.sql` no se puede ejecutar contra staging sin credencial de base de datos; se cubre con pruebas por API real.

## 2026-10-02 — Sprint: finanzas completas, gastos, facturación, membresías, Customer 360 y diseño V3

### HECHO
- **Migración 0900** (forward-only, no destructiva, con rollback): gastos, proveedores, categorías, membresías, cargos de cuota, tareas y series sincronizables; borrado de líneas solo en facturas en borrador; `server_capabilities()`. El cliente detecta servidores sin 0900 y desactiva esas escrituras con aviso.
- **Finanzas** como hub (Resumen · Flujo de caja · Gastos · Proveedores · Facturas · Cobros · Impuestos): resultado = ingresos netos − gastos netos, tesorería, pendiente de cobro/pago, IVA repercutido/soportado orientativo por trimestre.
- **Gastos y proveedores**: alta/edición, pendiente/pagado/vencido, pago en lote, anulación con motivo (nunca borrado), aviso de factura de proveedor duplicada, filtros, export XLSX/CSV, panel de evolución y categorías; ficha de proveedor.
- **Facturación**: editor con líneas, descuentos y vista previa; estados borrador / pendiente / parcial / vencida / cobrada / anulada; número del servidor por serie; duplicar; cobro parcial; PDF e impresión; series en Ajustes.
- **Membresías**: tarifas versionadas, alta con primera cuota, pausa/reanudación, baja, reactivación, cambio de tarifa, cobro de cuota con factura; estados ACTIVE / PAUSED / CANCELLED / EXPIRED / PENDING / PAST_DUE; MRR y evolución.
- **Customer 360**: 9 pestañas, acción siguiente, acciones rápidas; listado con filtros por membresía y saldo. **Seguimiento** con tareas.
- **Informes**: hub de 10 informes con filtros y comparación honesta; paquete gestoría con gastos e IVA soportado.
- **Dashboard V3**, puesta en marcha guiada (10 pasos), ⌘K ampliado, navegación por grupos, Design System V3 (patrones, tokens categóricos, modo oscuro), `RouteErrorBoundary`.

### FALLOS ENCONTRADOS Y CORREGIDOS
1. Proveedores se enviaban antes que sus categorías de gasto (violación de FK al subir la demo).
2. Demo con bajas anteriores al alta (`customer_memberships_check`); la baja ahora acota la fecha de fin.
3. Flujo de caja infravalorado: facturas cobradas sin filas de cobro (importadas) no contaban.
4. Periodos de membresía calculados con el día 1 del mes (`addMonths`) en vez de conservar el día.
5. Comparaciones engañosas: +1.519 % en gastos sin histórico, −85 % en un trimestre en curso, +974 % de ingresos YTD sin ingresos el año anterior.
6. El buscador de listas colisionaba con las etiquetas «Nombre»/«Email» de formularios (accesibilidad y E2E).
7. Desbordamiento horizontal en la puesta en marcha (iPad vertical y móvil) y en Ajustes › Facturación (móvil); «4 de 9 pasos» frente a «Paso 2 de 10».
8. El test de integración de finanzas consultaba capacidades antes de iniciar sesión y se omitía en falso.

### TESTS
- Unitarios: 94 en verde. SQL: 41 comprobaciones (sección 11 nueva).
- Stack local con 0900: `test:cloud` 21/21, E2E negocio 16/16, persistencia 22/22, multiempresa 7/7, 0 errores de consola.
- business-os-staging (sin 0900): demo completa por lotes sin errores; el test de finanzas se omite correctamente.

### MIGRACIONES
- `20261002000900_finance_memberships_sync.sql` — validada en local; **pendiente de aplicar en staging** (requiere `SUPABASE_ACCESS_TOKEN`).

### PENDIENTE
- Aplicar 0900 en staging y repetir `test:cloud` + E2E de negocio allí.
- Validación fiscal por asesoría antes de emitir facturas reales; Stripe sin conectar (cobro automático de cuotas).

## 2026-10-02 — Sprint: lotes, pipeline de importación, multiempresa por pestaña, responsive y analítica honesta

### HECHO
- **Sincronización por lotes** (`data/cloud/sync.ts`): troceo FK-ordenado (≤ 300 filas / 300 KB), reintento idempotente (23505 → comprobar ids), división ante `statement_timeout` (57014), grupos con progreso/espera/cancelación, cola por empresa **y pestaña** con adopción de colas huérfanas (Web Locks). Cambio de empresa instantáneo: lo pendiente se sigue enviando en segundo plano.
- **Pipeline de importación**: IMPORTING → COMPLETED / PARTIAL / FAILED / CANCELLED / REVERTED con traza de fases (UPLOADING, ANALYZING, MAPPING, VALIDATING). Datos ocultos hasta completar, cancelar (anula lo que entró), limpiar parciales, reanudar al volver a abrir. Estado en `imports.options` (sin migración).
- **Demo fiable**: 2 centros, ~14 meses de caja, sesiones y cierres diarios (con descuadres justificados), cuotas con línea, bajas con fecha, notas, importación histórica. Siembra por lotes; `npm run seed:demo` reintentable e idempotente en staging.
- **Multiempresa**: empresa y centro activos por pestaña (`app/tabContext.ts`), `?empresa=` para abrir otra empresa en una pestaña nueva, selector con búsqueda / crear / abrir en pestaña nueva / gestionar centros, título de pestaña con la empresa, demo accesible desde «Elige empresa».
- **Navegación**: grupos Operaciones, Clientes, Finanzas, Datos, Análisis, Empresa (Equipo, Centros, Ajustes); módulos diseñados marcados «Pronto»; carril de iconos en iPad; sin título duplicado en la barra superior.
- **Responsive**: DataTable con tarjetas en móvil, prioridad de columnas en tablet, cabecera fija, densidad; KpiStrip sin huérfanos; `ScrollFade` en pestañas/filtros; Caja sin desbordamiento en iPad vertical (carrito como hoja < 1024 px).
- **Dashboard**: tendencia Caja/Todo (el día 1 de cuotas ya no aplasta la escala), «hoy» vs mismo día de la semana anterior a la misma hora, operativa (caja, pendiente, facturado del mes), recurrente vs puntual (12 meses), nuevos vs recurrentes, comparativa de centros, layout de 2 columnas en tablet.
- **Finanzas**: extracto con una sola cifra protagonista; Ingresos / Caja / Facturación / Impuestos; gastos y neto «con el módulo de Gastos» (nunca estimados).
- **Customer 360**: bajas coherentes, renovación vencida explícita, orígenes traducidos, acciones rápidas, cronología con altas/bajas/cambios de estado.
- **Gráficas**: histórico sólido y solo el periodo en curso atenuado; `StackedColumnChart`.

### FALLOS ENCONTRADOS Y CORREGIDOS
1. Demo de 4,5 MB en un único `sync_push` → `statement_timeout` → la app restauraba la empresa vacía (también afectaba a Excel grandes).
2. Cambiar de empresa esperaba a enviar toda la cola pendiente (≈ 1 min con la demo) y la pestaña quedaba en «Cambiando…».
3. Dos pestañas con la misma empresa compartían la clave `outbox:<org>` y podían sobrescribirse la cola (pérdida de cambios pendientes).
4. Carrera en `open()`: un envío en curso podía guardar la cola de la empresa anterior bajo la clave de la nueva.
5. Caja con 235 px de desbordamiento horizontal en iPad vertical.
6. «Hoy −100 %» frente a «ayer» cuando ayer fue día de cuotas; «Pendiente de cobro» listado como método de pago.
7. Cliente de baja con «Próxima renovación … hace 62 días»; origen `walk_in` sin traducir.
8. «Elige empresa» no ofrecía la demo a quien ya tenía empresas.
9. (Introducido y corregido en el sprint) la vista móvil de tablas duplicaba texto en el DOM; ahora se renderiza solo una vista.

### TESTS
- Unitarios: 72 en verde (chunking 9, pipeline 7, demo 5, contexto por pestaña 4, comparaciones 5, …).
- Contra business-os-staging (clave pública): `test:cloud` 18/18 (4 de integración real, incluida una importación de 1.500 ventas por lotes en 19 s), E2E persistencia 22/22, E2E multiempresa 7/7, demo sembrada (52 lotes, 0 errores, máx. 2,3 s por lote).

### MIGRACIONES
- Ninguna nueva. Todo es compatible con 0100–0810 tal como están en staging (ver DECISIONS 2026-10-02).

### PENDIENTE
- Con credencial admin: `apply.mjs --status`, batería SQL contra staging, limpieza de cuentas `@empresa.test` (salvo `demo-seed@empresa.test`).
- Migración 0900 opcional (CHECK con `partial`/`cancelled`, `import_batches`) si se quiere trazabilidad por lote en servidor.
- Revisión de teclado y lector de pantalla en Caja; estados de error por pantalla (hoy: arranque, sincronización e importación).

## 2026-10-02 — Validación contra business-os-staging + corrección de sincronización

### HECHO
- **Conexión real con business-os-staging** usando solo la clave pública: Auth (solo email, «Confirm email» desactivado), las 50 tablas accesibles por PostgREST y ocultas por RLS sin sesión, escritura anónima bloqueada, RPC (`create_organization`, `sync_push`, `add_member_by_email`, `update_member`) denegadas sin sesión.
- **`npm run test:cloud` contra staging: 8/8** (CORE en dos dispositivos, aislamiento entre empresas, permisos, importación/reversión).
- **`npm run e2e` contra staging: 22/22**, tres ejecuciones seguidas, sin errores de consola (registro → empresa → producto → cliente → venta → cierre → logout → reentrada → segundo navegador).
- **Bug corregido en `CloudSync.pull`** (solo aparecía con la latencia real de staging): una descarga iniciada antes de una escritura sustituía el estado local por esa foto vieja si la escritura ya se había enviado. Ejemplo: al abrir caja justo al entrar en Caja, la caja volvía a verse cerrada aunque estaba guardada en el servidor. Ahora, si hubo escrituras durante la descarga, se descarta la foto y se vuelve a descargar. Test de regresión en `sync.test.ts` (falla sin la corrección).

### PENDIENTE
- Con `SUPABASE_ACCESS_TOKEN`: `scripts/staging/apply.mjs --status` (registro 0100–0810 + RLS) y `rls_isolation.sql` contra staging.
- Limpieza de las cuentas y empresas sintéticas de prueba en staging (requiere credencial administrativa).

## 2026-10-01 — Staging: endurecimiento de seguridad versionado (0800 + 0810)

### HECHO
- **Migración 0800 `security_hardening` versionada en Git** (ya estaba aplicada en business-os-staging por un conector externo sin escritura en GitHub): `create_organization` sin ejecución anónima, `search_path` fijo en 10 helpers internos, sin ejecución directa de esos helpers desde clientes. Idempotente.
- **Bug encontrado en 0800 y corregido con 0810**: revocar EXECUTE de `app.normalize_tax_id` rompe el alta/edición de clientes y proveedores **con NIF** (`permission denied for function normalize_tax_id`): esa función alimenta las columnas generadas `tax_id_normalized`, y PostgreSQL sí comprueba EXECUTE al evaluarlas (no en triggers). 0810 la concede solo a `authenticated` y `service_role`. **Staging tiene el bug activo hasta aplicar 0810.**
- **SQL**: 3 comprobaciones nuevas (sección 10): `create_organization` solo `authenticated`, helpers con `search_path` fijo y sin EXECUTE de clientes, y alta de cliente con NIF vía `sync_push` + triggers tras el endurecimiento. Total **37** (la tabla de estado decía 32; la batería real ya tenía 34 antes de esta sesión).
- `scripts/staging/apply.mjs`: no reaplica nada si el registro `schema_migrations` de staging no coincide con los ficheros (migraciones aplicadas por otra vía con otro identificador de versión).
- Revisión de las funciones SECURITY DEFINER y de `organization_counters` (ver SECURITY §4).

### PENDIENTE
- Aplicar **0810** en staging y repetir SQL / `test:cloud` / `e2e` / capturas contra staging: esta sesión sigue sin red a `api.supabase.com` ni `*.supabase.co` y sin credenciales.

## 2026-10-01 — Supabase + Design System V2

### HECHO
- **Persistencia en Supabase** (`src/data/cloud`): Auth real, organizaciones/centros/miembros/roles desde el servidor, sincronización transaccional (`sync_push`), cola offline, caché IndexedDB, indicador «Guardado / Guardando / Sin conexión».
- **Migración 0700**: `sync_push`, auditoría con contexto de la app, stock en servidor, perfiles al registrarse, gestión de equipo por RPC, columnas que faltaban.
- **Stack local equivalente a Supabase** (`npm run supabase:local`) y script de staging (`scripts/staging/apply.mjs`).
- **Tests**: 4 unitarios del motor de diferencias, 3 de integración contra Supabase Auth + PostgREST (dos dispositivos, aislamiento, permisos, importación/reversión), 5 SQL nuevos de `sync_push` (32 en total), E2E de persistencia en Chromium 22/22, 3 de la lectura automática.
- **Design System V2** y rediseño de Resumen, Resumen financiero (nuevo), Caja, Customer 360, Clientes, tablas, Importaciones, Informes, navegación, ⌘K y acceso. Revisión visual en desktop / tablet / móvil, claro y oscuro (`e2e/screens.mjs`).

### PENDIENTE
- Aplicar las migraciones y repetir `test:cloud` + `e2e` **contra business-os-staging** (esta sesión no tenía red a Supabase; ver DEPLOYMENT).
- Desactivar «Confirm email» en staging para los tests automáticos (decisión del propietario).

## 2026-10-01 — Privacidad del repositorio: secretos, historial y datos de clientes

### HECHO
- **Revisión de secretos** de todo el historial (gitleaks + patrones): ningún secreto real; nada que rotar.
- **Backup** completo (bundle + mirror) fuera del repositorio antes de reescribir.
- **Historial reescrito** en todas las ramas para eliminar identificadores fiscales, nombres, números de factura, emails de personal con dominio real y cifras económicas del primer tenant; verificado que no aparecen en ningún commit ni blob. Detalle sin datos en [SECURITY.md](SECURITY.md).
- `EXCEL_ANALYSIS.md` anonimizado (conclusiones técnicas intactas, ejemplos ficticios). CHANGELOG, PROJECT_MASTER, DECISIONS, SETUP y USER_FLOWS sin cifras reales.
- Tests de ficheros reales: cifras esperadas movidas a un JSON local fuera del repositorio (`BOS_REAL_EXPECT`); sin él solo se comprueban invariantes. Tenants y centros de los tests SQL/TS ficticios.
- Regla permanente de privacidad (CLAUDE.md regla 10, `docs/SECURITY.md`), `.gitignore` que bloquea Excel/CSV/PDF y carpetas de datos reales, y guardia `npm run check:privacy` en la verificación obligatoria.
- Decisión permanente de arquitectura PRFMN / Business OS / tenant / módulo Fitness / integraciones registrada en DECISIONS.

### PENDIENTE DEL PROPIETARIO (en GitHub, sin permisos para hacerlo desde aquí)
- Cambiar visibilidad a **privado** y renombrar `prfmn-club` → `business-os`.
- Borrar y volver a clonar los clones locales anteriores a la reescritura.
- (Opcional, recomendado) Pedir a GitHub Support la purga de los commits antiguos en caché (ver SECURITY).
- Para Supabase staging: crear el proyecto `business-os-staging` (región UE), permitir `*.supabase.co` y `api.supabase.com` en la red del entorno y añadir sus credenciales como variables de entorno (nunca en Git ni en el chat).

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
- ~~Renombrar el repositorio y hacerlo privado~~ · ~~reescribir el historial~~ → decididos (entrada superior).
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
