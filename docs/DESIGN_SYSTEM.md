# Design System

## Dirección estética

Premium, deportivo, minimalista, tecnológico. Referencias conceptuales: SaaS moderno (Linear, Stripe, Notion), fintech, apps de fitness premium. **Nunca** copiar literalmente ninguna de estas ni la interfaz de BeMadBox.

Principios: mucho espacio, jerarquía tipográfica clara, navegación sencilla, acciones rápidas accesibles, sobriedad, velocidad percibida, componentes reutilizables. Evitar: interfaces saturadas, exceso de bordes/sombras, tablas gigantes cuando no son necesarias, navegación confusa, look de "software administrativo antiguo".

## Modo

Dark-first (estética deportiva/tecnológica), con superficie clara disponible. El admin puede vivir principalmente en dark; la app del atleta puede admitir claro/oscuro según preferencia del sistema.

## Tokens de color (ver `src/design-system/tokens.css`)

- `--bg-canvas`: fondo base de la aplicación (casi negro, no negro puro).
- `--bg-surface`: superficie de tarjetas/paneles, un escalón por encima del canvas.
- `--bg-surface-raised`: superficie elevada (modales, dropdowns).
- `--border-subtle` / `--border-default`: bordes de bajo contraste, uso mínimo.
- `--text-primary` / `--text-secondary` / `--text-tertiary`: jerarquía tipográfica.
- `--accent`: verde-lima energético (acento de marca, deportivo, alto contraste sobre fondo oscuro) — uso reservado a acciones primarias y estados positivos.
- `--accent-contrast`: color de texto sobre `--accent`.
- `--danger`, `--warning`, `--success`, `--info`: estados semánticos.
- Escala neutra `--gray-50..900` para superficies/tipografía en modo claro.

## Tipografía

- Fuente principal: `Inter` (system fallback a `-apple-system, Segoe UI, Roboto`), variable, con soporte de pesos 400/500/600/700.
- Escala: `text-xs` (12px) a `text-4xl` (36px) siguiendo la escala por defecto de Tailwind, con `tracking-tight` en títulos grandes para sensación premium.
- Números (KPIs, precios) en `tabular-nums` para alineación consistente.

## Espaciado y layout

- Grid de 8px como unidad base.
- Contenedores de página con padding generoso (`p-6`/`p-8` en desktop), nunca contenido pegado al borde.
- Sidebar de navegación fija en desktop (72-80px colapsada / 240px expandida), contenido en área central con ancho máximo cómodo para lectura de tablas.

## Componentes base (`src/design-system/components`)

- `Button` (primary/secondary/ghost/destructive, tamaños sm/md/lg)
- `Card` / `StatTile` (KPI con label, valor, delta opcional)
- `Badge` (estado: success/warning/danger/info/neutral)
- `DataTable` (cabecera sticky, densidad cómoda, sin rejillas pesadas)
- `Modal` / `Drawer`
- `EmptyState`
- `Avatar`
- `Tabs`
- `SearchInput`
- `AttentionCard` (tarjeta de "Necesita tu atención": icono de severidad, texto, acción directa)
- `HealthScoreRing` (anillo de progreso con color según riesgo)

## Interacción

- Transiciones cortas (150-200ms), sin animaciones decorativas gratuitas.
- Feedback inmediato en acciones (toast, cambio de estado visual) especialmente en POS y reservas.
- Objetivos táctiles ≥44px en cualquier vista usable desde tablet/móvil (POS, check-in, reservas).
