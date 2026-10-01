# Análisis de formatos Excel de origen (anonimizado)

> Conclusiones técnicas del análisis fila a fila de los Excel con los que trabajaba el primer tenant antes de Business OS.
> **Este documento no contiene cifras económicas, recuentos de negocio, nombres, NIF/DNI ni números de factura reales.**
> Los valores que aparecen son **ilustrativos y ficticios**. Los ficheros originales no forman parte del repositorio
> (ver [SECURITY](SECURITY.md)); la verificación con ellos se hace solo en local (`BOS_*_XLSX` + `BOS_REAL_EXPECT`).
>
> Estos formatos son **referencia funcional y fuente de migración**, no la arquitectura del sistema.

---

## 1. Libro de caja anual (venta en mostrador)

### Estructura

| Hoja | Contenido | Observación |
|---|---|---|
| `Dashboard Anual` | Total año, media/mes, mejor mes, pico, unidades, comparativa mensual, mix por categoría, top productos | Todo son fórmulas sobre las hojas mensuales |
| `Catálogo` | `Producto`, `Categoría`, `Precio base` | Sin SKU, sin IVA, sin coste, sin stock, sin estado |
| `Enero` … `Diciembre` | Líneas: `Fecha`, `Producto`, `Categoría`, `Precio`, `Unidades`, `Importe` + bloque resumen del mes | Una hoja por mes = el anti-patrón que el sistema elimina |
| `TPV` | Mismas columnas que las hojas mensuales | Buffer de entrada cuyas líneas **ya están** copiadas en la hoja del mes |

### Problemas de calidad de datos (el importador los trata)

| # | Problema | Tratamiento en la importación |
|---|---|---|
| C1 | **Primeros meses agregados**: una fila por producto y mes (p. ej. «Agua · 30 uds · día 1») en lugar de ventas diarias | Se importan como *resumen mensual* (`granularity = 'aggregate'`): cuentan para facturación y unidades, **no** para nº de operaciones, ticket medio ni ventas por día/hora |
| C2 | **Fecha fuera del mes de la hoja** (p. ej. filas de `Enero` fechadas el 31/12 del año anterior) | `REQUIERE REVISIÓN`: el usuario elige fecha real o mes de la hoja (por defecto, mes de la hoja) |
| C3 | **Sin hora real**: horas fijas por defecto (00:00, 16:00, 17:00) | Se conserva la fecha y la hora se marca como desconocida (`time_precision = 'day'`); las gráficas por hora excluyen esas filas |
| C4 | **Línea sin producto** (solo categoría e importe) | `REQUIERE REVISIÓN` con candidatos por categoría + precio; nunca se asigna sola |
| C5 | **Precio distinto del catálogo** | Válido: se guarda el precio realmente cobrado (snapshot en la línea), con confianza MEDIA |
| C6 | **Importe ≠ precio × unidades** | `REQUIERE REVISIÓN`: el importe manda (es lo cobrado) y se muestra la discrepancia |
| C7 | **Duplicados entre hojas** (`TPV` repite líneas del mes) | `POSIBLE DUPLICADO` (fecha + producto + importe); por defecto se ignoran |
| C8 | Filas de texto/instrucciones dentro del rango de datos | Se descartan como «no son datos» y se listan en el informe |
| C9 | **Sin método de pago, cliente, ticket, usuario ni centro** | Método = `Desconocido (importado)`; centro = el elegido al importar; cada fila = 1 venta de 1 línea (no se inventan tickets) |
| C10 | Fórmulas de resumen rotas (top productos a 0) | Irrelevante: el sistema calcula sus propios rankings |
| C11 | Productos vendidos que no están en el catálogo y productos del catálogo nunca vendidos | El catálogo se importa completo; los productos sin ventas quedan activos |
| C12 | Espacios finales y erratas en nombres | Normalización (trim, sin acentos/mayúsculas); las erratas se proponen, no se corrigen solas |

### Controles de cuadre
El total de cada hoja mensual se recalcula a partir de las líneas importadas y se compara con el resumen del propio Excel; la importación muestra cada control como ✓/✗ antes de confirmar.

### Lo que el Excel no puede responder y el sistema sí
Ticket medio real, mix por método de pago, ventas por hora, ventas por cliente, cuadre de caja, margen (no hay coste) y stock.

---

## 2. Export de facturas de la plataforma de reservas (cuotas)

### Estructura
Una hoja por mes del trimestre, mismas 14 columnas:
`Nº` · `Factura` · `Fecha Factura` · `NIF` · `Cliente` · `Concepto` · `Periodo / Concepto` · `Descripción` · `Base Imp. (€)` · `Total (€)` · `Método de Pago` · `Estado` · `IVA 21% Base` · `IVA 21% Cuota`.
Pie de cada hoja: `TOTAL COBRADO →`, `⚠ PENDIENTE →`, `Total registros: N` (usados como controles de cuadre).

### Hallazgos
- Varias series de numeración (p. ej. `S…` y `C…`) con **huecos** en el rango → se avisa para verificar con la gestoría (otros periodos o rectificativas).
- Estados `Cobrada` / `Pendiente`; métodos tarjeta, efectivo y domiciliación.
- IVA: `Total = Base × 1,21` cuadra en todas las filas (redondeo a céntimo).

### Hallazgo crítico: la hoja es el **periodo de servicio**, no la fecha de factura
La hoja de un mes contiene facturas emitidas **a finales del mes anterior** (cuota cobrada por adelantado). Consecuencias:
1. El IVA se liquida por **fecha de emisión**: esas facturas pertenecen al trimestre anterior.
2. Las cuotas del mes siguiente emitidas al final del trimestre **no están** en el fichero → un informe trimestral hecho solo con él estaría incompleto.
3. El modelo separa `issue_date` (fiscal) de `service_period_start/end` (operativo/MRR). La gestoría usa `issue_date`; el MRR usa el periodo.

### Estructura de tarifas inferida (ejemplo ficticio)

| Tarifa | Precio (ejemplo) | Créditos (clases / open box) |
|---|---:|---|
| 10 CRÉDITOS | 50 € | 8 / 2 |
| 10 CRÉDITOS FUNDADOR | 45 € | 8 / 2 |
| ILIMITADA | 90 € | ilimitado |
| BONO 5 SESIONES | 55 € | 5 sesiones |
| Trimestral 10 CRÉDITOS | 140 € | ×3 meses |

Reglas extraídas: **créditos = clases + open box**; una misma tarifa aparece con **dos precios** en el periodo (→ cambio de precio histórico, `product_prices`/`membership_plan_versions` con vigencias); las tarifas *Fundador* son el mismo producto con precio protegido → **tarifas propias** (no descuentos), para medir cuántos fundadores quedan y qué MRR aportan.

### Problemas de calidad de datos

| # | Problema | Tratamiento |
|---|---|---|
| B1 | NIF vacío | Cliente creado sin NIF, marcado «dato fiscal incompleto» |
| B2 | NIF con formato inválido (caracteres extraños como `@`, solo dígitos, `1`, `…`, pasaportes extranjeros) | `REQUIERE REVISIÓN`; se valida DNI/NIE con letra de control; pasaportes aceptados como «documento extranjero» |
| B3 | NIF/NIE con la letra en minúscula | Normalizar a mayúsculas antes de deduplicar |
| B4 | Concepto con precio incrustado y espacios de relleno (`16 CREDITOS -  (73.00€)`, `Cuota july      16 CREDITOS`) | Parser: tarifa = concepto antes de `-Precio`/`- (`; mes del periodo desde `Cuota <month>` (en inglés) |
| B5 | Fechas como texto `dd/mm/yyyy` | Parser explícito día/mes (nunca `Date.parse`, que invierte día y mes) |
| B6 | Filas de totales/pie mezcladas con los datos | Detectadas y excluidas; sus importes se usan como **control de cuadre** |
| B7 | Mismo cliente en varios meses | Deduplicación por NIF normalizado → nombre normalizado → revisión |

---

## 3. Qué se reutiliza

- **Catálogo** → `products`, `product_categories`, `product_prices`.
- **Tarifas** inferidas de las facturas → `membership_plans` + `membership_plan_versions` (precio con vigencia).
- **Histórico de ventas** → `sales` + `sale_items` (`source = 'import'`, enlazadas a `import_records`).
- **Facturas** → `invoices` + `invoice_items` + `payments` + `customers`.
- **Métodos de pago**: tarjeta, efectivo, domiciliación, Bizum, TPV online, transferencia.
- **KPIs que el usuario ya mira**: total, media diaria/mensual, mejor día/mes, pico, unidades, mix por categoría, top productos, acumulado → consultas sobre la base de datos para *cualquier* periodo.

## 4. Qué estructura cambia

| Excel | Sistema |
|---|---|
| Una hoja por mes | Una tabla `sales` con `occurred_at`; cualquier periodo es un filtro |
| Precio copiado en cada fila | Precio vigente en `product_prices` + snapshot inmutable en `sale_items` |
| Fila = línea suelta | `sale` (operación) → `sale_items` (qué) → `payments` (cómo) |
| Categoría como texto repetido | `product_categories` referenciada |
| Factura = fila con todo | `invoice` + `invoice_items` + `payments`, enlazada a `customer` y opcionalmente a `sale`/`customer_membership` |
| Hoja = periodo de servicio | `issue_date` ≠ `service_period_start/end` |
| Totales al pie | Calculados, nunca almacenados como datos |
| «Fundador» en el nombre | Tarifa propia + versión de precio |
| Sin trazabilidad | `imports` + `import_records`: cada registro sabe de qué fichero, hoja y fila viene |
