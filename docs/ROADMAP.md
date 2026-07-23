# Roadmap

Ver también `MVP_SCOPE.md` para el corte funcional del MVP.

- **Fase 1 — Producto y documentación**: visión, PRD, arquitectura, módulos, roles, flujos, MVP. ✅
- **Fase 2 — Frontend navegable con mock data**: design system, navegación completa, Dashboard/Clientes/Cliente 360/Reservas/Calendario/POS construidos a fondo; resto de módulos con estructura navegable. ⏳ En curso.
- **Fase 3 — Revisión UX**: reducción de clics, mobile, validación de navegación.
- **Fase 4 — Base de datos real**: schema Supabase, migraciones, RLS multi-tenant.
- **Fase 5 — Conexión frontend↔backend real** (sustituye mocks por Supabase).
- **Fase 6 — Autenticación y roles reales.**
- **Fase 7 — Reservas reales** (persistencia, concurrencia de aforo, lista de espera real).
- **Fase 8 — Clientes y membresías reales.**
- **Fase 9 — POS / Tienda / Inventario reales.**
- **Fase 10 — Stripe y facturación real.**
- **Fase 11 — CRM y automatizaciones reales** (motor de cron + webhooks).
- **Fase 12 — Analytics.**
- **Fase 13 — Testing, security review y preparación para producción.**

## Fuera del roadmap inmediato

- Integración/migración del prototipo de Workouts existente (`../PRFMN_TRACK_B_WORKING.html`) — se evalúa como entrada al módulo Workouts en una fase futura, sin fecha fijada.
- Expansión comercial a otros gimnasios más allá de The Gravity Room (la arquitectura ya lo soporta; la decisión de negocio de vender la plataforma es independiente de este roadmap técnico).
