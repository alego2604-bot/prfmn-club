# Business OS — PROJECT MASTER (Source of Truth)

> **Business OS is an independent product and has no runtime dependency on PRFMN.**
> **The Gravity Room is the first tenant, not the product itself.**
> «Business OS» es el nombre interno provisional; el nombre comercial está por decidir.

> Documento vivo. **Se actualiza con cada decisión relevante.** Si algo aquí contradice a otro documento, manda este (y se corrige el otro).
> Última actualización: 2026-10-01.

Índice
1. Interpretación del producto
2. Arquitectura
3. Módulos
4. Sitemap y navegación
5. Modelo de datos
6. Diseño conceptual
7. MVP
8. Funciones posteriores
9. Riesgos
10. Decisiones importantes
11. Orden de construcción
12. Análisis de los Excel → [`EXCEL_ANALYSIS.md`](EXCEL_ANALYSIS.md)
13. Qué se reutiliza
14. Qué estructura cambia
15. Plan de importación de los datos actuales
16. Estado de cada módulo (PLANNED → PRODUCTION READY)
17. Pendientes, errores conocidos y siguientes pasos

---

## 1. Interpretación del producto

**Business OS es un software de gestión empresarial** (Business Management / CRM / Finance / Operations): la única fuente de verdad operativa y económica de cualquier negocio. Empieza con un módulo vertical para centros de entrenamiento porque su primera empresa cliente es un box, pero el núcleo es generalista.

No es una caja, ni un CRM, ni un programa de facturación. Es el sitio donde:

- **pasa** la operativa diaria (vender en segundos, cerrar caja, registrar asistencia),
- **se ordena** la economía (ventas, pagos, facturas, gastos, IVA, documentos) de forma conciliada y lista para la gestoría,
- **se entiende** el negocio (cualquier periodo, comparativas, tendencias, sin hojas por mes),
- y **se actúa** sobre las personas (con quién hablar hoy y por qué, con trazabilidad de cada contacto).

Tres ideas lo distinguen de "un Excel bonito":

1. **Una base de datos, no hojas.** Cada operación tiene fecha y propiedades; un mes, un trimestre o "del 3 al 17" son filtros, no pestañas.
2. **Entidades separadas y relacionadas.** Venta (qué), pago (cómo), factura (documento fiscal), membresía (servicio recurrente), gasto (salida), documento (archivo), cliente (persona). Nunca se mezclan.
3. **Importar → interpretar → proponer → validar → guardar.** El sistema hace el trabajo pesado, el humano decide. Nada económico, fiscal o de comunicación se guarda o envía a ciegas.

The Gravity Room es la primera organización (tenant) y el banco de pruebas, no la identidad del software: sus productos, tarifas y datos son registros de su empresa, nunca código. La arquitectura es multiempresa, multicentro y multisector desde el primer commit.

### 1.1 Independencia respecto a PRFMN (decisión 2026-10-01)

| | PRFMN | Business OS |
|---|---|---|
| Ámbito | Sports / performance: programación, workouts, atletas, resultados, leaderboards | Business management: operaciones, clientes, finanzas, comunicaciones, datos, analytics, empresa |
| Repositorio, BD, Supabase, Auth, Storage, Functions, logs, deploy, dominio | propios | propios |
| Requiere cuenta del otro | no | no |
| Si el otro desaparece | sigue al 100 % | sigue al 100 % |
| Conexión | opcional, solo por API/webhook firmados → [INTEGRATIONS.md](INTEGRATIONS.md) | ← |

Un cliente puede contratar A) solo PRFMN, B) solo Business OS o C) ambos (con integración opcional). La asistencia llega hoy por Excel/CSV; en el futuro PRFMN (u otro sistema) podrá ser una **fuente de datos más**, nunca una dependencia.

**Decisión permanente (aprobada por el propietario, 2026-10-01)**: PRFMN = producto deportivo; BUSINESS OS = producto empresarial independiente; The Gravity Room = primer tenant; Fitness = módulo opcional del CORE; integraciones opcionales y desacopladas (API/webhooks/capa de integraciones), nunca base de datos compartida ni dependencia obligatoria.

### 1.2 Privacidad: código de producto ≠ datos de clientes
El repositorio (privado, `business-os`) contiene solo código, documentación técnica, fixtures ficticios y ejemplos anonimizados. Los datos reales viven en la BD/Storage autorizados y en las importaciones del usuario. Regla, guardia automática (`npm run check:privacy`) y registro de la limpieza del historial en [SECURITY.md](SECURITY.md).

## 2. Arquitectura

```
┌────────────────────────────────────────────────────────────┐
│ Cliente web (React + TS + Vite, SPA/PWA)                    │
│  · Desktop / tablet (Caja táctil) / móvil                   │
│  · Capa de dominio pura (cálculos: IVA, totales, caja, KPI) │
│  · Capa de datos con adaptadores:                           │
│      LocalAdapter (IndexedDB)  ← hoy                        │
│      SupabaseAdapter            ← Fase 5                    │
└───────────────┬────────────────────────────────────────────┘
                │ supabase-js (anon key + JWT de usuario)
┌───────────────▼────────────────────────────────────────────┐
│ Supabase                                                    │
│  · Postgres 15+ con RLS en el 100 % de tablas de negocio    │
│  · Auth (email/password, magic link; SSO futuro)            │
│  · Storage (documentos, originales de importación, logos)   │
│  · Edge Functions (secretos, PDF servidor, OCR, IA,         │
│    WhatsApp Cloud API, Stripe/Redsys webhooks, cron)        │
└───────────────┬────────────────────────────────────────────┘
                │
   WhatsApp Business Platform · Email (Resend/Postmark) · Stripe · Redsys
   · Bancos (PSD2 agregador) · LLM (Claude) · OCR
```

Principios:

- **Multitenancy por fila**: `organization_id` en toda tabla de negocio + RLS. `location_id` en todo lo que ocurre en un centro (ventas, caja, stock, asistencia, gastos). Ver [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md).
- **Core vs verticales**: el core (clientes, ventas, catálogo, finanzas, documentos, comunicaciones, analytics, usuarios) no sabe nada de gimnasios. El vertical *fitness* añade membresías con créditos, asistencia, clases y drop-ins, activado por `organizations.vertical` + `organization_modules`.
- **Dinero en céntimos enteros** (`bigint`), nunca `float`. Precios de venta con IVA incluido (B2C), base e IVA derivados y guardados en cada línea.
- **Inmutabilidad financiera**: ventas, pagos, facturas y cierres no se borran; se anulan (estado + motivo + autor) o se corrigen con un registro nuevo. `audit_logs` append-only por trigger.
- **Histórico de precios**: el precio vigente vive en una tabla con vigencia; cada línea de venta/factura guarda una *foto* (nombre, categoría, precio, IVA). Cambiar un precio nunca altera el pasado.
- **Lógica de dominio pura y testeada** (`src/domain`): la misma función calcula el total en la caja, en la importación y en el informe.
- **Entornos**: development (local), staging (proyecto Supabase propio), production (proyecto Supabase propio). Nunca pruebas destructivas en producción. Ver [`ENVIRONMENT.md`](ENVIRONMENT.md).

## 3. Módulos (5 pilares + plataforma)

| Pilar | Módulo | Propósito |
|---|---|---|
| **OPERATIONS** | Caja (TPV) | Venta en segundos, táctil, multi-pago |
| | Ventas | Histórico, búsqueda, anulación trazable |
| | Cierres | Apertura/cierre, cuadre por método, descuadres |
| | Catálogo | Productos, servicios, tarifas, bonos, categorías, precios con vigencia |
| **FINANCE** | Resumen financiero | Ingresos, gastos, margen, IVA, pendiente de cobro |
| | Facturas emitidas | Series, numeración, estados, cobro |
| | Gastos / facturas recibidas | Proveedor, categoría, IVA soportado, documento |
| | Pagos y cobros | Todo movimiento de dinero, por método |
| | Proveedores | Ficha, histórico, evolución de precios |
| | Conciliación | Extracto bancario ↔ pagos/gastos (posterior) |
| **CUSTOMERS** | Clientes | Ficha 360, timeline |
| | Membresías | Altas, renovaciones, bajas, MRR |
| | Asistencia | Importada o registrada; métricas de frecuencia |
| | Seguimiento | Con quién hablar hoy y por qué (alertas explicadas) |
| | Leads | Pipeline Lead → Visita → Drop-in → Prueba → Interesado → Miembro / Perdido |
| | Tareas y notas | Acción y contexto que evita falsos avisos |
| **COMMUNICATIONS** | Inbox | WhatsApp (API oficial) + email, un hilo por cliente |
| | Plantillas | Editables, con variables; IA propone, humano envía |
| **INTELLIGENCE** | Dashboard | Hoy / Mes / Año, alertas |
| | Analytics | Negocio, clientes, finanzas |
| | Informes | Gestoría trimestral en 1 clic (XLSX/PDF/CSV) |
| | Copilot | Preguntas en lenguaje natural con trazabilidad a datos |
| **DATA** | Importaciones | Asistente de 6 pasos, historial, reversión |
| | Documentos | Gestor documental con metadatos y vínculos |
| **PLATFORM** | Empresa / Centros / Equipo / Roles / Ajustes / Auditoría | Configuración sin tocar código |

## 4. Sitemap y navegación

Mejoras sobre la propuesta inicial (motivo en cada una):

1. **Catálogo dentro de Operaciones** y no como sección propia: se toca a diario desde la caja; las tarifas de membresía son también catálogo (lo que se vende), las *membresías de clientes* viven en Clientes.
2. **WhatsApp y Email no son páginas**: son canales dentro de un único Inbox (filtro por canal). Evita duplicar listas de conversaciones.
3. **Reports + Exportaciones + Gestoría = "Informes"**, con "Paquete gestoría" como plantilla destacada: una sola respuesta a "mandar Q3 al gestor".
4. **Configuración no ocupa el menú principal**: métodos de pago, IVA, categorías, reglas de inactividad, series, centros, equipo → todo bajo Ajustes.
5. **Selector de centro global** en la barra superior ("Todos los centros" = consolidado). Cada pantalla respeta ese contexto.
6. **Cmd+K** como navegación primaria para usuarios avanzados; **acciones rápidas** (Nueva venta, Importar, Nuevo cliente) siempre a un atajo.

```
Inicio                          /
Copilot                         ⌘J (panel, Fase IA)
OPERACIONES
  Caja                          /caja            (modo táctil, pantalla completa en tablet)
  Ventas                        /ventas
  Cierres de caja               /cierres
  Catálogo                      /catalogo        (Productos · Tarifas · Categorías)
CLIENTES
  Clientes                      /clientes  →  /clientes/:id (Overview · Actividad · Asistencia · Membresía · Pagos · Facturas · Comunicaciones · Documentos · Notas)
  Seguimiento                   /seguimiento
  Membresías                    /membresias
  Asistencia                    /asistencia
  Leads                         /leads
COMUNICACIÓN
  Inbox                         /inbox
  Plantillas                    /plantillas
FINANZAS
  Resumen                       /finanzas
  Facturas emitidas             /facturas
  Gastos                        /gastos
  Pagos y cobros                /pagos
  Proveedores                   /proveedores
  Conciliación                  /conciliacion
INTELIGENCIA
  Analytics                     /analytics       (Negocio · Clientes · Finanzas)
  Informes                      /informes        (Gestoría · Exportaciones)
DATOS
  Importaciones                 /importaciones  →  /importaciones/nueva  →  /importaciones/:id
  Documentos                    /documentos
AJUSTES                         /ajustes         (Empresa · Centros · Equipo y roles · Métodos de pago · Impuestos · Facturación · Reglas de actividad · Integraciones · Auditoría · Plan)
```

Móvil: barra inferior (Inicio · Caja · Clientes · Seguimiento · Más). Tablet en Caja: navegación colapsada, objetivos táctiles ≥ 56 px.

## 5. Modelo de datos (resumen)

Detalle completo, constraints y RLS en [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) y `supabase/migrations/`.

```
organizations ─┬─ locations
               ├─ organization_members (user ↔ org, role, location scope) ── profiles (auth.users)
               ├─ roles / role_permissions (granulares, sobreescribibles por org)
               ├─ settings, tax_rates, payment_methods, document_series
               │
 CATÁLOGO      ├─ product_categories ── products ── product_prices (vigencias)
               ├─ membership_plans ── membership_plan_versions (precio/créditos con vigencia)
               │
 CLIENTES      ├─ customers ─┬─ customer_memberships (→ plan_version) ── membership_charges
               │             ├─ attendance
               │             ├─ customer_notes, tasks
               │             ├─ communications ── message_templates
               │             └─ leads (pipeline) / customer_status_rules
               │
 OPERACIONES   ├─ sales ─┬─ sale_items (snapshot de producto/precio/IVA)
               │         └─ payments (1..n por venta; también cobros de facturas/membresías)
               ├─ cash_sessions ── cash_closings (versionados) ── cash_movements (entradas/salidas manuales)
               ├─ stock_movements
               │
 FINANZAS      ├─ invoices ── invoice_items  (→ sale / customer_membership opcionales)
               ├─ expenses ── expense_categories, suppliers
               ├─ bank_transactions (conciliación, posterior)
               │
 DATOS         ├─ documents ── document_links (polimórfico: invoice, expense, import…)
               ├─ imports ── import_records (cada fila: estado, confianza, entidad creada)
               └─ audit_logs (append-only), notifications
```

Relaciones clave pedidas:
- Una **venta** tiene 1..n `sale_items` y 0..n `payments` (pago dividido, pendiente).
- Una **factura** puede referenciar una venta (`invoices.sale_id`) o una membresía; una venta puede no tener factura (ticket).
- Una **membresía** referencia la *versión* de tarifa vigente al contratar → el precio histórico nunca cambia; genera `membership_charges` (cargos recurrentes) que se convierten en ventas/facturas.
- Un **gasto** referencia proveedor, categoría y 0..n documentos.
- Todo registro importado guarda `import_id` → la importación sabe qué creó y puede revertirse.

## 6. Diseño conceptual

Identidad: **"Instrumento de precisión"**. Un software que se siente como un buen cronómetro: neutro, exacto, rápido, con un único color de acento con energía (azul eléctrico "Gravity", con un verde-señal para estados positivos). Light mode por defecto, dark mode por tokens.

- Tipografía: **Inter** (UI) con cifras tabulares; **JetBrains Mono** solo para referencias (nº factura, SKU, IDs).
- Densidad: aire en dashboards, densidad controlada en tablas (filas de 44 px, cabecera sticky).
- Jerarquía: un KPI protagonista por bloque; comparativas como *chips* de variación (+12,4 % vs mes anterior) con color semántico y tooltip con el cálculo.
- Gráficos: una serie principal en color de acento, comparativa en gris; nunca arcoíris.
- Microinteracciones: 120–180 ms, `ease-out`; feedback inmediato (toast + contador animado) al guardar una venta.
- Estados vacíos que enseñan el siguiente paso ("Aún no hay ventas hoy → Abrir caja").
- Skeletons en cargas > 150 ms.

Detalle: [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

## 7. MVP (lo que The Gravity Room necesita para dejar los Excel)

Orden del usuario, agrupado en circuitos verticales:

| Circuito | Incluye | Criterio de "hecho" |
|---|---|---|
| **A. Acceso** | Login, crear empresa (tipo de negocio, datos fiscales, centro), roles | Un usuario solo ve su empresa |
| **B. Vender** | Catálogo, Caja, Ventas, Cierre de caja, Dashboard | Una venta en caja aparece en ventas, en el cierre y en el dashboard al instante |
| **C. Migrar** | Importación caja (XLSX/CSV) + facturas (XLSX/CSV), historial, reversión | Los dos Excel reales se importan con informe de calidad y cuadran al céntimo |
| **D. Facturar** | Facturas emitidas, gastos, pagos | IVA repercutido/soportado por trimestre por fecha de emisión |
| **E. Reportar** | Informe gestoría XLSX/PDF/CSV por periodo | "Q3 al gestor" en un clic |
| **F. Cuidar clientes** | Clientes, membresías, asistencia (import), seguimiento con motivos, tareas, notas, timeline | "Quién lleva 14 días sin venir" en segundos |
| **G. Comunicar** | Plantillas + botón WhatsApp (enlace `wa.me` registrado) → API oficial después | Cada contacto queda en el timeline |
| **H. Entender** | Analytics, documentos | — |

## 8. Funciones posteriores

Inventario avanzado y pedidos a proveedor · conciliación bancaria (PSD2) · OCR/IA de facturas en servidor · automatizaciones (con aprobación humana) · TPV físico · Stripe (cobro de cuotas) · Redsys · WhatsApp Cloud API con plantillas aprobadas · Copilot IA · API pública y webhooks · app del cliente final · clases y reservas propias (sustituir BeMadBox) · billing SaaS (planes Starter/Pro/Business) · Verifactu/TicketBAI.

## 9. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fuga de datos entre empresas | Crítico | RLS en todas las tablas + tests automáticos de aislamiento (`supabase/tests`) + `organization_id` en claves foráneas compuestas |
| Normativa fiscal (Verifactu, numeración, rectificativas) | Alto | Las facturas emitidas por el sistema quedan en *borrador* hasta validar con gestoría; numeración por serie con secuencia sin huecos en transacción; anulación ≠ borrado |
| IVA mal asignado en productos (10 % vs 21 %) | Alto | Tipos de IVA configurables, propuestos por categoría y marcados "a validar"; informe de IVA muestra el desglose |
| Importaciones sucias contaminan la base | Alto | Preview obligatorio, niveles de confianza, duplicados, `import_records`, reversión |
| Mezclar datos demo con reales | Alto | Organización demo separada (`is_demo`), banner permanente, imposible importar/exportar gestoría desde demo |
| Dependencia de BeMadBox para clases/asistencia | Medio | Importadores de asistencia; reservas propias en roadmap |
| WhatsApp no oficial → baneo del número | Medio | Solo API oficial (Cloud API / BSP); hasta entonces, enlace `wa.me` manual y registrado |
| IA que inventa cifras | Alto | Copilot solo vía herramientas SQL de solo lectura bajo RLS; toda cifra lleva su consulta/filtro de origen |
| Sobreingeniería | Medio | Desarrollo vertical, 5 módulos excelentes antes que 25 simulados |
| Datos solo en el navegador (fase local) | Medio | Exportación/backup JSON del workspace; migración a Supabase en Fase 5 (mismo esquema) |

## 10. Decisiones importantes

Registro completo con motivos en [`DECISIONS.md`](DECISIONS.md). Resumen:

1. **Vite SPA en vez de Next.js** (pendiente de confirmación del propietario) — app 100 % autenticada, sin SEO; la caja en tablet se beneficia de SPA/PWA; el servidor ya es Supabase (Edge Functions). Reversible: la capa de dominio y datos no depende del framework.
2. **`organization_id` + `location_id`** sustituyen a `gym_id` (el producto deja de ser solo para gimnasios).
3. **Dinero en céntimos enteros**, precios con IVA incluido, IVA guardado por línea.
4. **Versionado de precios** en tablas de vigencia + snapshot en líneas.
5. **Nada financiero se borra**: anulación con motivo; `audit_logs` append-only.
6. **Adaptador local (IndexedDB) hasta conectar Supabase**: todo lo marcado FUNCTIONAL funciona de verdad y persiste, con el mismo modelo que el SQL.
7. **Workspace demo separado** del workspace real; el real arranca vacío y se llena importando.
8. **Ene–Mar importados como agregados mensuales**, excluidos de métricas por operación.
9. **Fecha de emisión ≠ periodo de servicio** en facturas.
10. **Frontend mock anterior retirado** (sustituido por módulos con datos reales; queda en el historial git, commit `bc7c5b5`).
11. **Navegación** reorganizada según §4.

## 11. Orden de construcción

1. ✅ Product definition (este documento) + análisis de Excel.
2. ✅ Esquema SQL multi-tenant con RLS, auditoría e inmutabilidad, **probado en Postgres 16** con tests de aislamiento.
3. ✅ Design system + shell (navegación, ⌘K, selector de centro, toasts, light/dark).
4. ✅ Circuito B: Catálogo → Caja → Ventas → Cierre → Dashboard (funcional, persistente).
5. ✅ Circuito C: Importación (caja + facturas BeMadBox) con calidad de datos y reversión.
6. ✅ Circuito E: Informe gestoría XLSX/CSV/PDF.
7. ⏭ Conectar Supabase (auth real + SupabaseAdapter) — requiere crear proyecto.
8. ⏭ Circuito D: Gastos, Facturas manuales, Pagos.
9. ⏭ Circuito F: Membresías, Asistencia, Seguimiento, Tareas, Timeline.
10. ⏭ Circuito G/H: Plantillas + WhatsApp, Analytics, Documentos, Copilot.

## 12. Análisis de los Excel

Ver [`EXCEL_ANALYSIS.md`](EXCEL_ANALYSIS.md) (cifras reales, 12 problemas de calidad en caja, 7 en facturas, hallazgo fiscal del periodo vs fecha de emisión).

## 13. Qué se reutiliza

Catálogo y categorías, precios, histórico de ventas, facturas emitidas, clientes, tarifas (con sus créditos clase/open box), métodos de pago, y todos los KPIs que hoy se miran (total, media, mejor día/mes, pico, mix, top, acumulado) reconstruidos como consultas.

## 14. Qué estructura cambia

Hojas por mes → tabla única con fecha. Filas sueltas → venta/líneas/pagos. Texto repetido → entidades referenciadas. Precio copiado → precio con vigencia + snapshot. Totales en celdas → cálculos. Hoja = periodo → fecha de emisión y periodo de servicio separados. Fundador en el nombre → tarifa propia. Sin trazabilidad → cada registro conoce su fichero, hoja y fila de origen.

## 15. Plan de importación de los datos actuales

```
1 Subir      XLSX/CSV (PDF/imagen → Fase OCR). Se guarda el original y su hash SHA-256
             (detecta "este fichero ya se importó").
2 Analizar   Hojas, filas de cabecera, columnas, tipos (fecha/importe/texto), filas no-dato,
             pies de totales. Detección del tipo: "Caja" o "Facturas emitidas".
3 Mapear     Sinónimos (es/en): "Forma de pago"/"Método de Pago" → payment_method,
             "Importe"/"Total (€)" → total, "Producto" → product, "Fecha Factura" → issue_date…
             Editable por el usuario.
4 Preview    Registros resultantes tal como se guardarán (con producto/cliente emparejado).
5 Validar    Por fila: ALTA CONFIANZA / MEDIA / REQUIERE REVISIÓN / ERROR / DUPLICADO,
             siempre con el motivo. Control de cuadre contra los totales del propio fichero.
             Decisiones: asociar · ignorar · crear nuevo · revisar.
6 Importar   Transacción única. Crea registros con import_id. Resultado: creados,
             modificados, duplicados, ignorados, errores.
→ Historial  Fecha, usuario, tipo, fichero, resultados. Revertir si es seguro
             (ningún registro creado ha sido usado después: p. ej. facturas cobradas
             a posteriori o ventas incluidas en un cierre de caja → bloquea la reversión
             y explica por qué).
```

Orden recomendado para The Gravity Room:
1. Catálogo (desde la hoja `Catálogo`) → revisar IVA por categoría.
2. Ventas ene–sep (hojas mensuales; `TPV` detectada como duplicado).
3. Facturas Q3 BeMadBox → crea clientes y tarifas.
4. Asistencia (cuando se exporte de BeMadBox) → activa Seguimiento.

## 16. Estado de cada módulo

Escala: `PLANNED` → `DESIGNED` → `FRONTEND ONLY` → `FUNCTIONAL` (funciona y persiste en el adaptador local) → `TESTED` (tests automáticos de su lógica + verificación en navegador) → `PRODUCTION READY` (conectado a Supabase, con RLS probado y validado en uso real).

**Nada está PRODUCTION READY hasta conectar Supabase.** Ver tabla viva en §16.1.

### 16.1 Tabla de estado

| Módulo | Estado | Notas |
|---|---|---|
| Esquema SQL + RLS | TESTED | Migraciones aplicadas en Postgres 16 local + 27 comprobaciones de aislamiento, permisos e integridad |
| Capa de integraciones (conexiones, identidades externas, eventos) | DESIGNED | Tablas + RLS probadas; conectores aún no implementados |
| Módulos verticales (core / fitness) | FUNCTIONAL | Activables por empresa en Ajustes; el core no contiene reglas de sector |
| Acceso (login local, crear empresa, workspace demo) | FUNCTIONAL | Auth real Supabase en Fase 5 |
| Shell, navegación, ⌘K, selector de centro, tema | FUNCTIONAL | |
| Catálogo (productos, categorías, precios con vigencia) | TESTED | |
| Caja (TPV táctil, multi-pago) | TESTED | |
| Ventas (listado, filtros, anulación, export) | TESTED | |
| Cierres de caja | TESTED | |
| Dashboard Hoy/Mes/Año | TESTED | |
| Importación caja XLSX/CSV | TESTED | Probado con el Excel real |
| Importación facturas XLSX/CSV | TESTED | Probado con el Excel real |
| Historial y reversión de importaciones | TESTED | |
| Facturas emitidas (listado, KPIs, filtros, export) | FUNCTIONAL | Emisión manual: PLANNED |
| Clientes (listado, ficha, notas, timeline) | FUNCTIONAL | |
| Informe gestoría XLSX/CSV/PDF | TESTED | |
| Ajustes (empresa, centros, métodos de pago, IVA, categorías, equipo) | FUNCTIONAL | |
| Auditoría | FUNCTIONAL | |
| Gastos | PLANNED | |
| Membresías de clientes | DESIGNED | Tablas listas; UI pendiente |
| Asistencia / Seguimiento / Tareas | DESIGNED | Tablas listas; UI pendiente |
| Inbox / Plantillas / WhatsApp | DESIGNED | |
| Documentos | DESIGNED | |
| Analytics avanzados | PLANNED | |
| Copilot IA | PLANNED | |
| Conciliación bancaria | PLANNED | |

## 17. Pendientes, errores conocidos y siguientes pasos

Ver [`CHANGELOG.md`](CHANGELOG.md) (última entrada) para el informe de fase: HECHO · QUÉ FUNCIONA · QUÉ NO ESTÁ CONECTADO · PROBLEMAS · DECISIONES · SIGUIENTE ETAPA.

Preguntas abiertas para el propietario:
1. ¿Confirmas Vite SPA (recomendado) o prefieres migrar a Next.js?
2. ¿Creamos ya los proyectos Supabase (staging + production, plan gratuito para empezar)?
3. Tipos de IVA por categoría (bebidas, suplementación, merchandising, drop-in): validar con la gestoría.
4. Series de factura propias (¿continuar la numeración de BeMadBox o serie nueva?).
5. ¿Las tarifas *Fundador* siguen abiertas a nuevas altas o están cerradas?
