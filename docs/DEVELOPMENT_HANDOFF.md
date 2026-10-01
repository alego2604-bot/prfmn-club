> **Nota (2026-10-01)**: documento de la fase anterior (modelo `gym_id`, frontend mock). Se conserva como referencia histórica; la fuente de verdad actual es [PROJECT_MASTER.md](PROJECT_MASTER.md).

# Development Handoff

Documento vivo. Actualízalo cada vez que cambie de máquina o de fase de forma significativa, para no perder contexto entre sesiones.

## Estado actual (2026-07-23)

**Fase 2/3: frontend navegable con datos mock, revisado y mejorado en profundidad de UX.** Sin backend real conectado (ni Supabase ni Stripe). Sin ejecución real todavía — ver "Qué sigue sin validar" más abajo, es la limitación más importante de este documento.

## Último commit estable

```
ba432ee feat: make Impagados retry/contact and Inventario reponer interactive
```

Historial completo desde el inicio del proyecto (`git log --oneline`):

```
ba432ee feat: make Impagados retry/contact and Inventario reponer interactive
dcd8340 feat: make Leads/CRM interactive and fix mobile kanban layout
6d5228d feat: make daily class management in Reservas actually interactive
c935630 feat: redesign POS around the "+Venta -> Agua -> Marta -> confirmado" flow
5a4a9aa feat: make Cliente 360 answer "is this client OK" in one glance
a520723 feat: rework Clientes list around what a receptionist scans daily
5818d98 feat: redesign Dashboard as a Gym Operating System view
e85d642 fix: mobile navigation and responsive tabs
9d9374b feat: bootstrap PRFMN Club (Fase 1 + Fase 2 frontend mock)
```

Todos los commits son incrementales y reversibles (`git revert <hash>` si algo necesita deshacerse).

## Remoto de GitHub

**No existe todavía.** El repositorio es solo local (`git remote -v` no devuelve nada). Para conectarlo cuando se decida:

1. Crear un repositorio vacío en GitHub (privado, recomendado, dado que aún no hay revisión legal/de seguridad completa — ver `MVP_SCOPE.md`).
2. Desde `prfmn-club/`:
   ```bash
   git remote add origin <URL_SSH_O_HTTPS_DEL_REPO>
   git branch -M main
   git push -u origin main
   ```
3. Confirmar que `.gitignore` sigue excluyendo `node_modules`, `dist`, `.env`, `.env.local` antes del primer push (ya está configurado así, revisar si cambia).

No se ha hecho esto automáticamente porque crear/publicar en un repositorio remoto es una acción visible y con consecuencias (queda fuera del alcance de "solo trabajar en local" de esta fase) — requiere confirmación explícita del usuario.

## Funcionalidades terminadas (navegables, con datos mock, revisadas de UX)

- **Dashboard**: quick actions, "Necesita tu atención" (ordenado por severidad), "Operativa de hoy" (clases de hoy + reservas/ocupación), "Estado del negocio" agrupado (Ingresos/Clientes/Riesgo).
- **Clientes**: filtros rápidos derivados (Todos/Activos/Riesgo/Impagados/Nuevos/Inactivos), columna de alertas, badge de estado de pago.
- **Cliente 360**: info crítica (estado, pago, health score) visible en el header; 5 acciones rápidas funcionales con estado local (Contactar, Añadir venta, Crear reserva, Añadir nota, Gestionar membresía).
- **Reservas/Calendario**: añadir atleta, añadir invitado, pasar asistencia, gestionar lista de espera — todo con estado local reactivo y feedback visual (toast).
- **POS**: flujo de 3 toques (producto → cliente → confirmación automática), selector de modo de cobro, clientes recientes, integración con Cliente 360 vía `?clientId=`.
- **Leads/CRM**: kanban con avance de etapa de un toque, alta de nuevo lead, grid responsive.
- **Impagados**: reintentar cobro y contactar, con estado de carga/confirmación.
- **Inventario**: reposición rápida de stock con confirmación visual.
- **Navegación móvil**: menú hamburguesa + drawer para pantallas <1024px (antes no existía ninguna forma de navegar en móvil/tablet pequeña).

## Funcionalidades básicas (navegables, sin las mejoras de UX de la lista anterior)

Tienda, Productos, Facturas, Pagos, Comunicaciones, Automatizaciones (toggle de reglas), Configuración.

## Placeholders (sin funcionalidad real, fuera del MVP inmediato)

Workouts, Informes.

## Qué sigue siendo 100% mock (no confundir con "funciona de verdad")

- **No hay backend.** Todo dato vive en arrays de TypeScript en `src/mocks/`. Recargar la página resetea cualquier cambio hecho en la sesión (añadir un cliente a una clase, marcar un pago como cobrado, etc.).
- **No hay autenticación real.** El rol activo está fijado en `src/lib/permissions.ts` (`CURRENT_ROLE = "owner"`).
- **No hay Stripe.** Los "cobros" del POS y de Impagados solo cambian estado en memoria.
- **No hay envío real de mensajes** en Comunicaciones ni en los modales de "Contactar" de Cliente 360.
- **El motor de automatizaciones no ejecuta nada** — la pantalla solo activa/desactiva reglas visualmente, no hay cron ni evaluación real de condiciones.

## Qué sigue sin validar (la limitación más importante ahora mismo)

Todo el código de este handoff **se ha escrito y revisado manualmente (lectura de código, grep de imports, verificación cruzada de tipos a mano)**, pero **nunca se ha ejecutado `npm install`, `npm run build`, `npm run dev` ni `npm run lint`** porque la máquina donde se desarrolló no tenía Node.js instalado. Esto significa:

- No hay garantía de que `npm run build` compile sin errores de TypeScript — la revisión manual reduce el riesgo pero no lo elimina.
- El alias `@/` usado en todos los imports depende de una configuración en `vite.config.ts` (`resolve.alias`) que nunca se ha probado contra un Vite real — ver `docs/MAC_MINI_SETUP.md` sección 10-11.
- Ningún flujo de UI (POS, Reservas, modales) se ha probado en un navegador real — solo se ha razonado sobre el código.
- Las versiones exactas de dependencias en `package.json` (React 18.3, Vite 5.4, Tailwind 3.4, etc.) no se han resuelto nunca con `npm install`; podría haber incompatibilidades menores de versión que solo aparecen al instalar.

**La primera tarea real en el Mac mini es `npm install && npm run build && npm run dev` y corregir lo que aparezca** — ver `docs/MAC_MINI_SETUP.md`.

## Dependencias del proyecto

Runtime: `react`, `react-dom`, `react-router-dom`, `clsx`, `lucide-react`.
Desarrollo: `vite`, `@vitejs/plugin-react`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`, `eslint` + plugins.
Ninguna depende de Supabase o Stripe todavía — se añadirán en Fase 4 (`@supabase/supabase-js`) y Fase 10 (`@stripe/stripe-js` o SDK de servidor en Edge Functions), respectivamente, no antes.

## Próximos pasos (en orden)

1. En el Mac mini: instalar Node/Git, clonar/copiar el proyecto, `npm install`, `npm run build`, `npm run dev` — corregir cualquier error real que aparezca (ver `MAC_MINI_SETUP.md`).
2. Probar manualmente en navegador todos los flujos descritos en este documento y en el mensaje de revisión de Fase 3.
3. Decidir si se conecta un repositorio remoto de GitHub (ver sección de arriba) — requiere tu confirmación explícita.
4. Solo tras tu aprobación explícita del producto visual/funcional: continuar con Fase 4 (`docs/ROADMAP.md`) — diseño de schema Supabase real y migraciones. **No se debe iniciar esta fase sin luz verde expresa**, según se acordó.

## Cómo retomar el contexto en una nueva sesión

Lee, en este orden: este documento → `docs/CHANGELOG.md` → `docs/DECISIONS.md` → `docs/MVP_SCOPE.md`/`ROADMAP.md` si necesitas el panorama completo. `CLAUDE.md` en la raíz tiene las reglas permanentes de trabajo (multi-tenant, seguridad, nunca romper funcionalidad estable, etc.) que aplican en cualquier máquina.
