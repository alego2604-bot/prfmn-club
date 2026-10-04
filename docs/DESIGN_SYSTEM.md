# Design System V2 — «Graphite & Cobalt»

> Business OS es un instrumento financiero de precisión: neutro, exacto, rápido.
> Prioridad: velocidad → claridad → usabilidad → estética. Bonito nunca significa complicado.
> Referencias de **nivel** (no de copia): Linear (precisión), Stripe/Ramp (datos financieros), Attio (tablas), Vercel (simplicidad).

Código: `src/design-system/tokens.css` (tokens), `tailwind.config.ts` (escala), `src/design-system/components/*`.

## 1. Principios

1. **Jerarquía por tamaño, peso, espacio y posición** — el color es el último recurso. Una cifra protagonista por vista.
2. **Un solo acento.** Cobalto solo para: serie principal de datos, selección y la acción de cobrar. Lo demás es grafito.
3. **Colores semánticos reservados** (éxito, aviso, error) para estados reales, siempre con icono o texto (nunca solo color).
4. **Nada de tarjetas iguales en fila.** Indicadores secundarios en una sola pieza con divisores (`StatStrip`, `KpiStrip`).
5. **Honestidad**: lo que no existe se muestra como «Próximamente», nunca con cifras estimadas.

## 2. Color

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--canvas` | `#f6f6f3` off-white cálido | `#0c0c0b` | Fondo de la app y barra lateral |
| `--surface` | `#ffffff` | `#151514` | Tarjetas, tablas, paneles |
| `--surface-2` / `--surface-sunken` | `#fafaf8` / `#f0efeb` | `#1a1a19` / `#10100f` | Hover, pistas de barras, inputs secundarios |
| `--border` / `--border-strong` | `#e7e6e1` / `#d6d5cf` | `#252523` / `#33332f` | Separadores hairline |
| `--text` / `-2` / `-3` | `#121211` / `#4f4e49` / `#8a8983` | `#ededea` / `#a7a6a0` / `#73726c` | Texto principal, secundario, terciario |
| `--ink` | `#121211` | `#ededea` | Acción primaria (botones de tinta) |
| `--accent` | `#3646f5` cobalto | `#7c89ff` | Serie principal, selección, «Cobrar» |
| `--success` / `--warning` / `--danger` | `#16884f` / `#d98a0a` / `#d93a3a` | `#3cbf7b` / `#f0a830` / `#f05a5a` | Solo estados |

Dark mode está **diseñado**, no invertido: superficies grafito con elevación por luminosidad (no por sombra), acento aclarado para mantener contraste.

## 3. Tipografía

- **Inter Variable con tamaño óptico** (`opsz`): titulares y cifras grandes usan automáticamente el corte Display.
- Escala: 11 · 12 · 13 · 14 (base) · 15 · 17 · 20 · 24 · 30 · 38 · 48 · 60 px. Tracking negativo creciente con el tamaño (−0,01 → −0,04 em).
- **Cifras**: `.figure` (proporcional, tracking −0,035 em, semibold) para cifras protagonistas; `.num` (tabulares) solo en columnas y ejes.
- Importes con separador de miles siempre (`4.177,90 €`, `1.369`) — `formatMoney`, `formatNumber`, `NUM`.

## 4. Espaciado, radio, bordes y sombras

- Rejilla de 4 px. Padding de tarjeta 20–24 px; gap entre bloques 16 px; página 32 px (desktop) / 16 px (móvil).
- Radio: 6 (controles pequeños) · 8 (inputs, botones) · 12 (tarjetas) · 16 (tiles de Caja, modales).
- Bordes hairline de 1 px; tarjetas con `surface-card` (borde + sombra mínima + brillo interior).
- Sombras muy suaves (`--shadow-xs…lg`); solo los elementos flotantes (menús, toasts, ⌘K, tooltips) usan `lg`.

## 5. Componentes

| Componente | Notas |
|---|---|
| `Button` | `primary` (tinta), `accent` (solo cobrar/confirmación principal), `secondary`, `ghost`, `danger`. Alturas 32/36/44/56. Pressed: `scale(.98)`. |
| `Input` / `Select` / `MoneyInput` | 36 px, radio 8, foco con anillo cobalto suave. Etiqueta 13 px secundaria encima. |
| `DataTable` | Cabecera fija limpia, filas de 44 px, hover sutil, orden con indicador al pasar, búsqueda, columnas configurables (persistentes), exportación XLSX/CSV, selección con **barra flotante de acciones**, paginación con miles. *Vistas guardadas: futuro.* |
| `HeroMetric` | Una por vista. 48–60 px, variación con chip y periodo comparado. |
| `StatStrip` / `KpiStrip` | Indicadores secundarios en una pieza; celdas con variación y sparkline opcionales; clicables para profundizar. |
| `RangeSelector` | 7D · 30D · 90D · YTD · 1A + personalizado (panel). Todo el dashboard responde al mismo periodo. |
| `InsightList` | Lectura automática (`domain/insights.ts`): frases con cifras reales, solo si hay base de comparación. |
| `Modal` / `Drawer` | Fondo `--overlay`, entrada `pop-in`/`slide-in` ≤ 200 ms. |
| `Menu` / ⌘K | ⌘K: acciones contextuales (nueva venta, abrir caja, informe, pendientes, tema), recientes, navegación y búsqueda de clientes/productos/facturas/`#venta`. Módulos no construidos solo aparecen al buscarlos. |
| Navegación | Grupos plegables (estado persistente). Módulos PLANNED/DESIGNED en un único «Próximamente». |
| Toasts | Esquina inferior, `aria-live`, éxito 3,8 s / error 6 s. Errores de sincronización: qué ha pasado + estado restaurado. |
| `EmptyState` | Contexto + acción (CTA). Nunca «No data». |
| `ErrorState` | «No hemos podido cargar…» + Reintentar + detalles técnicos plegados. |
| Carga | Esqueletos con la forma real (`DashboardSkeleton`, `PageFallback`), sin spinners grandes. |
| Iconos | Lucide, 16 px, trazo 1.75; solo cuando aportan significado. |
| Avatar | Iniciales sobre superficie neutra (sin colores aleatorios). |

## 6. Gráficas (skill dataviz)

- Serie principal = acento, línea 2 px + velo 10–14 %; comparación = gris recesivo (discontinuo en líneas, barra clara en columnas). **Nunca doble eje ni arcoíris.**
- Rejilla hairline casi invisible, sin ejes dibujados, 4 marcas en Y con formato compacto (`2,7 k€`).
- Barras ≤ 24 px, extremo redondeado 4 px, 2 px de aire entre barras. **Histórico en sólido; solo el periodo en curso (incompleto) atenuado** (`partialLast`, tooltip «· en curso»). Nunca un histórico pálido que parezca desactivado.
- Dos partes de un mismo total (recurrente / puntual): `StackedColumnChart` con acento + acento medio (`--chart-1-mid`), leyenda obligatoria y tooltip con total y partes.
- Una serie con picos estructurales (cuotas el día 1) no se deforma ni se recorta: se ofrece la vista que se lee (caja diaria) con conmutador explícito a «Todo».
- Tooltip: valor grande primero, variación coloreada frente al punto comparado («+7,2 % vs septiembre 2025»), serie de comparación debajo con clave de línea.
- Leyenda con ≥ 2 series; el texto nunca usa el color de la serie.
- Validación de paleta: `validate_palette.js` → acento vs gris ΔE 27–38 (también en protanopía/deuteranopía/tritanopía). El gris es neutral a propósito (no categórico) y siempre va acompañado de leyenda y tooltip.
- Ranking por categoría / método de pago: barras horizontales de un solo tono (sin paleta categórica).
- Animación ≤ 500 ms, desactivada con `prefers-reduced-motion`.

## 7. Movimiento

`ease-out` `cubic-bezier(.2,.8,.2,1)`, 120–320 ms. Entrada escalonada sutil de bloques (`.stagger`), confirmación de venta con `check-pop`, contador de cantidad con `bump`. Nada se anima en bucle salvo el indicador «Guardando…».

## 8. Responsive (revisión 2026-10-02)

| Ancho | Navegación | Contenido |
|---|---|---|
| ≥ 1280 px | Barra lateral completa (248 px) con selector de empresa | Rejilla de 12 columnas |
| 768–1279 px (iPad) | **Carril de iconos** (68 px) con la empresa activa arriba | Rejilla de 12 columnas con 2 columnas reales (nunca «móvil estirado»); tablas con columnas por prioridad |
| < 768 px | Cabecera con empresa + cajón lateral + barra inferior (5 accesos) | Tarjetas, listas compactas |

- **Caja**: carril hasta 1536 px para dar ancho al TPV; carrito lateral desde 1024 px (iPad horizontal), hoja inferior por debajo (iPad vertical y móvil). Tiles de 112 px, métodos de pago de 56 px.
- **DataTable**: en móvil, filas-tarjeta (título, valor, estado, segunda línea, chevron) renderizadas en lugar de la tabla (una sola vista en el DOM); `priority: "medium"` oculta la columna < 1024 px y `"low"` < 1280 px; cabecera fija con scroll interno; densidad cómoda/compacta persistida.
- **KpiStrip**: sin huérfanos — móvil 2 columnas (impar → el primero ocupa la fila), tablet ≤ 4 / 2+3 / 3+3, escritorio una fila. Máximo 5; el resto como texto secundario.
- **Pestañas, filtros y segmentos** con `ScrollFade`: borde difuminado por donde queda contenido y elemento activo a la vista.
- Revisión obligatoria en 1440 / 1180 / 820 / 390 px, claro y oscuro, sin scroll horizontal.

## 8b. V3 (2026-10-02) — patrones de producto

- Tokens: `chart-out` (salidas/gastos), paleta categórica `cat-1…8` (también en oscuro), estados `hover / pressed / selected`, `text-3` oscuro `#8b8a84` (contraste AA sobre superficie).
- Patrones (`design-system/components/patterns.tsx`): `SubNav` (secciones de un hub), `FilterBar` + `SearchField` + `FilterSelect`, `Combobox`, `Amount` (signo y tono coherentes), `Ledger` (extracto de líneas), `ProgressBar`, `Section`, `EntityCell`.
- Gráficas: `FlowChart` (entradas/salidas/neto), `CountTrend`, `tone="out"` en barras.
- Estados: vacío con acción, cargando, error por ruta (`RouteErrorBoundary`) y servidor sin capacidad (`ServerNotice`).

## 8c. Sprint de producto (2026-10-04)

- **Jerarquía de cifras**: hay como mucho tres cifras principales por pantalla (Resumen: Facturación, Gastos y Resultado). El resto son secundarias, de menor tamaño, o tablas. Se evita el muro de tarjetas: cuando dos tarjetas responden la misma pregunta, se fusionan en una con `Segmented` (por ejemplo, «Mix de ingresos»).
- **Fechas relativas** cuando importan: vencimientos («Vence en 3 días», en rojo si ha vencido) en facturas y gastos.
- **Cronologías** de actividad ordenadas por día, con rango de evento cuando coinciden (creación → emisión → cobro → devolución → vencimiento → anulación).
- **Acceso**: el panel oscuro muestra una vista previa del producto con cifras de ejemplo (`aria-hidden` y decorativa), solo desde 1280 px.
- **Caja**: desde 768 px el carrito es un panel lateral fijo de 320 a 360 px; por debajo, una hoja inferior.

## 9. Preparado para el futuro (sin construir aún)

Widgets reordenables y preferencias de dashboard: las secciones del Inicio son bloques independientes en una rejilla de 12 columnas; añadir orden/visibilidad por usuario será configuración, no rediseño.
