# Design System

Identidad **"instrumento de precisión"**: neutros fríos, tinta casi negra para la acción principal y un único acento eléctrico (`#3B5BFD`). Light por defecto; dark con tokens propios (no inversión automática). Referencias de nivel (no de copia): Linear, Stripe, Attio, Ramp.

## Tokens (`src/design-system/tokens.css`)
| Token | Uso |
|---|---|
| `--canvas`, `--surface`, `--surface-2`, `--surface-sunken` | Fondo, tarjetas, cabeceras de tabla, controles hundidos |
| `--border`, `--border-strong` | Bordes (1 px, bajo contraste) |
| `--text`, `--text-2`, `--text-3` | Jerarquía tipográfica |
| `--ink` | Botón primario, selección fuerte (chips, métodos de pago) |
| `--accent` (+ `-soft`, `-text`) | Foco, enlaces, gráfica principal, estados informativos |
| `--success/warning/danger/info` (+ `-soft`, `-text`) | Estados: solo cuando el color *significa* algo, siempre con icono o texto |
| `--chart-1`, `--chart-2`, `--chart-grid` | Serie actual, serie de comparación, rejilla |

Tailwind expone todo con soporte de opacidad (`bg-accent/20`) vía `color-mix`.

## Tipografía y escala
Inter Variable (`cv11`, `ss01`, `ss03`) + JetBrains Mono para referencias (nº factura, SKU, hash). Cifras siempre `tabular-nums` (`.num`). Escala: 11 / 12 / 13 / 14 (base) / 15 / 17 / 20 / 24 / 30 / 38 px, tracking negativo en titulares.

## Espaciado, radios, sombras
Rejilla de 4/8 px. Radios 6 (controles) · 8 · 12 (tarjetas) · 16 (modales). Sombras `xs` (reposo) → `md` (popovers) → `lg` (modales). Movimiento 140–200 ms `cubic-bezier(.2,.8,.2,1)`; feedback táctil `active:scale(.97)`.

## Componentes (`src/design-system/components`)
Button (primary/accent/secondary/ghost/subtle/danger · sm/md/lg/xl), IconButton, Badge/Dot, Card/CardHeader, Kbd, Avatar, Skeleton, Field/Input/Textarea/Select/MoneyInput/Switch/Checkbox, Modal, Drawer, Menu/MenuItem, ReasonDialog (motivo obligatorio), Toast, EmptyState, Callout, PageHeader/Page, Tabs, Segmented, Kpi + Delta, StatusPill (PLANNED → PRODUCTION READY), DescriptionList, **DataTable** (buscar, ordenar, columnas visibles persistentes, paginar, seleccionar, acciones masivas, exportar XLSX/CSV), charts (CompareArea, CompareBars, BarList, Legend).

## Gráficas (método skill *dataviz*)
- Una serie = acento; comparación = gris recesivo (discontinuo en líneas). Nunca doble eje.
- Mix por categoría y métodos de pago = **barras de un solo color** con etiqueta y %, no arcoíris (la paleta de 8 categorías no supera la validación CVD; los colores de categoría solo identifican en la Caja).
- Tooltip en hover siempre; leyenda con ≥2 series; texto en tokens de texto, nunca del color de la serie.

## Patrones
- KPI protagonista + chips de variación con tooltip que explica el cálculo.
- Estados vacíos que enseñan el siguiente paso; skeletons en cargas.
- Acciones destructivas o financieras → ReasonDialog (motivo queda en auditoría).
- Módulos no construidos → página honesta con estado y lo ya preparado; **sin botones falsos**.

## Responsive
- Desktop ≥1024: barra lateral fija (en Caja, solo ≥1280 para dar sitio al carrito).
- Tablet: Caja en dos columnas, tarjetas de producto de 104 px, botones de pago de 48 px, objetivos táctiles ≥44 px.
- Móvil: barra inferior (Inicio · Caja · Ventas · Clientes · Más), carrito como hoja inferior.
