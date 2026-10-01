# Decisions Log

Registro de decisiones técnicas/producto relevantes tomadas de forma autónoma, con motivo. Formato: fecha — decisión — motivo — alternativas consideradas.


## 2026-10-01 — Arquitectura de producto permanente (aprobada por el propietario)

**Decisión permanente**:
- **PRFMN** = producto deportivo (training / performance). **BUSINESS OS** = producto empresarial independiente.
- The Gravity Room es únicamente el **primer tenant/organization**.
- **Fitness** es un módulo vertical **opcional** sobre el CORE. Con Fitness desactivado no aparecen membresías, asistencia, créditos, drop-ins ni tipos de producto fitness, y el CORE no contiene reglas sectoriales. Futuros módulos (Retail, Services, Restaurant…) se añaden sin modificar el núcleo.
- Integraciones (PRFMN incluido): opcionales y desacopladas por API/webhooks/capa de integraciones, **nunca** compartiendo base de datos. Ninguna integración externa puede convertirse en dependencia obligatoria; los datos recibidos se transforman al modelo interno de Business OS y el histórico importado sigue funcionando si la conexión desaparece.

## 2026-10-01 — Repositorio privado, renombrado y con historial saneado

**Decisión** (del propietario): repositorio **privado**, renombrado de `prfmn-club` a `business-os` (sin PRFMN, The Gravity Room ni Fitness en la identidad estructural) e historial reescrito para eliminar datos personales y cifras reales. Separación estricta **código de producto ≠ datos de clientes/negocio**. Procedimiento, verificación y riesgos residuales en [SECURITY.md](SECURITY.md) (sin reproducir los datos eliminados).
**Motivo**: el repositorio contendrá arquitectura, lógica financiera, esquemas, importadores e integraciones; nunca debe contener datos reales.

## 2026-10-01 — Business OS es un producto independiente de PRFMN

**Decisión** (del propietario): este repositorio es **Business OS**, software de gestión empresarial, totalmente separado de PRFMN (software de training/performance). Repositorio, base de datos, proyecto Supabase (Auth, PostgreSQL, RLS, Storage, Functions, logs), deploy y dominio propios. **Business OS is an independent product and has no runtime dependency on PRFMN.** Cualquier conexión futura será opcional y solo por API/webhook ([INTEGRATIONS.md](INTEGRATIONS.md)).

**Auditoría realizada**:
- Sin dependencias técnicas con PRFMN: ningún import, tabla, variable, servicio, Supabase ni Auth compartidos. El prototipo de workouts mencionado en decisiones de julio nunca formó parte de este repositorio y tenía su propio Supabase.
- Restos de nombre (no funcionales) de la fase «PRFMN Club»: marca en la UI, nombre del paquete, base IndexedDB `prfmn-club`, claves `prfmn.*`, sal del hash local, comentarios de migraciones, variables de test. **Renombrados a Business OS** con migración automática de los datos locales existentes (se copian antes de retirar el nombre antiguo; nunca se borra nada sin copiar). Las únicas cadenas `prfmn` que quedan en el código son esos identificadores *legacy* de migración.
- Comentarios de cabecera de las migraciones SQL cambiados: estas migraciones **no se han aplicado en ningún entorno**, así que no se viola la regla de no editar migraciones aplicadas.
- Documentos de la fase anterior movidos a `docs/archive/` (no borrados).
- El nombre del repositorio en GitHub era `prfmn-club`: se renombra a `business-os` (decisión posterior del mismo día).

## 2026-10-01 — The Gravity Room es el primer tenant, no el producto

Ninguna regla, producto, categoría, tarifa ni texto de una empresa concreta en el código. Auditoría: no había `if (empresa === …)`; sí había dos KPIs del dashboard que buscaban categorías por nombre («Suplementación», «Retail/merchandising») → sustituidos por métricas genéricas (categoría principal, unidades, clientes con compra). Placeholders de alta neutrales. The Gravity Room solo aparece como organización en los datos y como nombre de tenant en tests.

## 2026-10-01 — Core empresarial + módulos verticales

`src/domain/modules.ts` (espejo de `organization_modules`). El módulo **Fitness** (membresías, créditos, drop-ins, asistencia) se activa por sector o desde Ajustes. Sin él, desaparecen de la navegación, del dashboard, de los tipos de producto y de las propuestas de la importación. Nuevos sectores (retail, restauración, estética…) se añadirán como módulos sin tocar el core.

## 2026-10-01 — Capa de integraciones genérica (migración 0600)

`integration_connections` (solo referencia a secretos en Vault), `external_identities`, `integration_events` (idempotentes, solo escritura de servidor). Proveedor genérico: PRFMN sería un proveedor más, igual que un software de reservas o una pasarela de pago. Los datos recibidos se guardan como datos propios (p. ej. `attendance.source = 'integration'`), así que nada se rompe si la integración se apaga.

## 2026-10-01 — Datos personales reales retirados del repositorio público

Tests y `EXCEL_ANALYSIS.md` contenían identificadores fiscales y números de factura reales como ejemplos. Sustituidos por valores sintéticos y, con autorización del propietario, eliminados también del historial (ver entrada «Repositorio privado…» y [SECURITY.md](SECURITY.md)).

## 2026-10-01 — Re-alcance a Business Operating System (organization_id + location_id)

**Decisión**: el modelo pasa de `gym_id` a `organization_id` (empresa/tenant) + `location_id` (centro). Toda tabla de negocio lleva `organization_id`; lo que ocurre en un centro lleva `location_id`. FK compuestas `(organization_id, id)` para que sea imposible enlazar registros de dos empresas.
**Motivo**: el propietario pide un producto multiempresa, multicentro y multisector (gimnasios hoy; retail, restauración, estética mañana). `gym_id` acoplaba el core al vertical.
**Alternativas**: mantener `gym_id` y renombrar después (descartada: migración costosa con datos reales).

## 2026-10-01 — Mantener Vite SPA en vez de migrar a Next.js (PENDIENTE DE CONFIRMAR)

**Decisión**: seguir con React + TypeScript + Vite (SPA/PWA) + Supabase.
**Motivo**: app 100 % autenticada (sin SEO), la Caja en tablet se beneficia de una SPA rápida y apta para offline, el servidor ya lo cubre Supabase (Postgres/RLS/Auth/Storage/Edge Functions) y el repositorio ya era Vite. Next.js añadiría SSR + gestión de cookies de sesión sin beneficio funcional ahora.
**Reversible**: `domain/` y `data/` no dependen del framework; migrar sería mover `features/` a rutas de Next.
**Pregunta abierta** al propietario: confirmar o pedir Next.js.

## 2026-10-01 — Modo local (IndexedDB) con el mismo modelo que el SQL hasta conectar Supabase

**Decisión**: la app funciona y persiste de verdad en el navegador mediante un store por empresa con repositorios que aplican permisos, validación, atomicidad y auditoría. El esquema SQL está escrito y probado aparte.
**Motivo**: no hay proyecto Supabase creado (requiere alta y posibles costes → decisión del propietario). La regla «nada de botones falsos» exige que lo marcado como funcional funcione: con el adaptador local, crear producto guarda, vender afecta al dashboard, importar crea registros, cerrar caja guarda el cierre.
**Limitaciones conocidas**: datos solo en ese navegador (copia JSON en Ajustes → Datos); la contraseña local (SHA-256) no es seguridad de servidor; un único usuario a la vez por dispositivo.
**Siguiente paso**: SupabaseAdapter con el mismo contrato de repositorios.

## 2026-10-01 — Escritura inmediata a IndexedDB (sin debounce)

**Decisión**: cada `store.update` dispara el guardado; si hay uno en curso se coalesce y se guarda el último estado al terminar.
**Motivo**: el test E2E detectó que una venta hecha justo antes de recargar se perdía con el debounce de 120 ms. En una caja eso es inaceptable.

## 2026-10-01 — Dinero en céntimos enteros, precios con IVA incluido, IVA en puntos básicos

**Motivo**: evita errores de coma flotante; el negocio vende a consumidor final con PVP con IVA; base = round(total / (1+tipo)) y la cuota absorbe el céntimo de redondeo (base + IVA = total siempre, probado con 700 importes).

## 2026-10-01 — Histórico de precios por vigencias + snapshot en líneas

`product_prices` / `membership_plan_versions` con `valid_from/valid_to`; `sale_items` e `invoice_items` copian nombre, categoría, precio e IVA. Cambiar un precio nunca reescribe el pasado (requisito: p. ej. 50 € en enero, 55 € en octubre).

## 2026-10-01 — Nada financiero se borra

Ventas, pagos, facturas, cierres y movimientos: sin DELETE (trigger incluso para el owner de la BD). Corrección = anulación con motivo + devoluciones compensatorias, o nueva versión (cierres). Reversión de importaciones = anular lo creado y archivar productos/clientes sin uso.

## 2026-10-01 — Tratamiento de los Excel actuales

- Ene–Mar (resúmenes mensuales) → `granularity = 'aggregate'`: cuentan en facturación y unidades, no en nº de operaciones ni ticket medio.
- Hora fija 17:00 en el 84 % de filas → `time_precision = 'day'`; se excluyen de la analítica por hora.
- Hoja `TPV` = duplicado de septiembre → marcada como posible duplicado e ignorada por defecto.
- Fechas fuera del mes de la hoja (enero con 31/12/2025) → decisión masiva, por defecto «mes de la hoja».
- Sin método de pago → ventas «Desconocido (importado)», sin registro de pago inventado y fuera de cualquier cierre.
- Cada fila = una venta (no se inventan agrupaciones en tickets).
- Facturas: fecha de emisión (IVA) separada del periodo de servicio (MRR). Parte de las facturas de la hoja de un mes son del trimestre anterior.
- IVA por categoría propuesto (10 % bebidas/suplementación, 21 % resto) y marcado «a validar con la gestoría».

## 2026-10-01 — Retirada del frontend mock anterior

**Decisión**: se eliminan del árbol las pantallas mock de la Fase 2/3 (datos en memoria, reservas, leads, automatizaciones…). Siguen en el historial git (commit `bc7c5b5`).
**Motivo**: mezclaban datos ficticios con la app (prohibido por el propietario), su modelo (`gym_id`) ya no aplica y ninguna funcionalidad era real. Las ideas valiosas (briefing «necesita tu atención», ficha 360, caja en 3 toques) se conservan en el nuevo diseño. Los módulos no reconstruidos aparecen en la navegación como «Pronto» con su estado honesto.

## 2026-10-01 — Navegación por pilares (mejora sobre la propuesta)

Catálogo dentro de Operaciones; WhatsApp/Email como canales del Inbox (no páginas); Informes + Exportaciones + Gestoría unificados; configuración bajo Ajustes; selector de centro global. Motivo y sitemap en PROJECT_MASTER §4.

## 2026-10-01 — Gráficas: un solo color + gris de comparación

La paleta de 8 colores de categoría no supera la validación de daltonismo (skill dataviz). Mix y métodos de pago se muestran como barras de un único color con etiqueta; los colores de categoría solo identifican productos en la Caja.


## 2026-07-23 — Máquina de desarrollo principal será un Mac mini dedicado, no esta máquina

**Decisión**: se detiene todo intento de instalar Node.js/Homebrew en la máquina actual. El usuario indicó que un Mac mini dedicado a IA/desarrollo será la máquina principal en el futuro. Hasta entonces, el trabajo continúa exclusivamente en código, documentación y arquitectura, sin ninguna ejecución local (`npm install`, `npm run build`, `npm run dev`).

**Motivo**: evitar instalar herramientas de sistema en una máquina que no será la de desarrollo definitiva, y evitar que un agente automatizado tome decisiones de instalación de software sobre una máquina ajena sin supervisión directa del usuario en cada paso.

**Consecuencia importante**: ninguna parte del frontend (~9 commits de mejoras de UX) ha sido compilada, ejecutada en un navegador real, ni pasada por `tsc`/ESLint. Toda la verificación de esta fase ha sido manual (lectura de código, grep cruzado de imports/exports, revisión de tipos "a mano"). Ver `docs/DEVELOPMENT_HANDOFF.md` para el detalle exacto de qué queda sin validar y `docs/MAC_MINI_SETUP.md` para el procedimiento de arranque en la máquina definitiva.

## 2026-07-23 — Alias `@/` resuelto también en Vite, no solo en tsconfig

**Decisión**: añadir `resolve.alias` en `vite.config.ts` (mapeando `@` → `src/`) usando `fileURLToPath(new URL("./src", import.meta.url))`, sin añadir la dependencia `vite-tsconfig-paths`.

**Motivo**: todo el código usa imports `@/lib/...`, `@/mocks/...`, etc. `tsconfig.json` ya resolvía el alias para el chequeo de tipos, pero Vite (el bundler/dev server real) no lee `tsconfig.json` para esto por defecto — sin este cambio, `npm run dev`/`npm run build` habrían fallado con errores de "módulo no encontrado" en prácticamente cualquier archivo del proyecto. Se detectó y corrigió de forma preventiva mientras se documentaba el procedimiento de arranque para el Mac mini, en vez de dejarlo como un problema a descubrir en la primera ejecución real.

**Alternativa considerada**: instalar `vite-tsconfig-paths` (más automático si se añaden más paths en el futuro, pero es una dependencia extra que no se ha podido probar con `npm install` en este entorno). Se prefirió la solución sin dependencias nuevas por ser más fácil de verificar por lectura de código y no arriesgar un `npm install` que no se puede ejecutar aquí.

## 2026-07-23 — Proyecto aislado en subcarpeta `prfmn-club/`

**Decisión**: crear el nuevo proyecto en `prfmn-club/`, dejando intactos todos los archivos y carpetas `PRFMN_*` existentes en el directorio padre.

**Motivo**: el directorio de trabajo ya contenía un prototipo funcional previo (app de workouts en un solo archivo HTML, con Supabase real conectado, múltiples iteraciones/pilotos). No es el mismo producto que "PRFMN Club" (SaaS de gestión multi-tenant), pero destruirlo o mezclarlo habría violado la regla explícita de no destruir funcionalidad existente. Confirmado con el usuario antes de proceder.

**Alternativas consideradas**: reorganizar todo el directorio moviendo lo existente a `legacy/` (descartada por el usuario, se prefirió la opción menos invasiva).

## 2026-07-23 — Nuevo proyecto Supabase dedicado

**Decisión**: PRFMN Club usará un proyecto Supabase nuevo y propio, no el que ya usa el prototipo de workouts existente.

**Motivo**: el proyecto Supabase existente ya tiene usuarios/datos reales de auth y resultados deportivos; reutilizarlo para una arquitectura multi-tenant desde cero habría arriesgado esos datos y mezclado modelos de datos incompatibles (el existente no es multi-tenant). Confirmado con el usuario.

**Pendiente**: crear el proyecto Supabase real ocurre en Fase 4; hasta entonces el frontend usa exclusivamente mock data en memoria.

## 2026-07-23 — Multi-tenancy por fila (RLS) en lugar de schema-per-tenant

**Decisión**: un único schema Postgres compartido, aislamiento vía `gym_id` + Row Level Security, en lugar de un schema (o base de datos) por gimnasio.

**Motivo**: con la escala esperada (decenas/cientos de gimnasios, no miles), este modelo es más simple de migrar, mantener y sobre el que reportar de forma agregada para el superadmin, sin sacrificar aislamiento real si las políticas RLS están bien diseñadas y testeadas. Se revisará si el volumen real lo justifica (ver `ARCHITECTURE.md#escalabilidad-prevista`).

**Alternativas consideradas**: schema-per-tenant (más aislamiento físico pero mucha más complejidad operativa de migraciones); base de datos separada por tenant (descartada, coste operativo desproporcionado en este estadio).

## 2026-07-23 — Entorno sin Node.js/npm/Homebrew

**Decisión/hallazgo**: el entorno de ejecución de este agente no tiene Node.js, npm ni Homebrew instalados, y la instalación de Homebrew requiere una contraseña de administrador de macOS que no puede introducirse de forma no interactiva.

**Motivo**: limitación del entorno, no una decisión de producto. Se documenta porque bloquea la ejecución (`npm install`, `npm run dev`) hasta que el usuario instale Node manualmente. Todo el código fuente se escribe igualmente, listo para ejecutar en cuanto exista el runtime.

## Pendiente de validación legal/fiscal

**Nota**: el modelo de facturación (`BILLING_SYSTEM.md`) está preparado conceptualmente para normativa española (series, IVA, NIF/CIF) pero no ha sido validado por un asesor fiscal. No se debe emitir facturas reales en producción sin esa validación.
