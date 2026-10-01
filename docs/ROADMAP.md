# Roadmap

Desarrollo vertical: pocos módulos excelentes y funcionales antes que muchos simulados. Estado detallado en [PROJECT_MASTER §16](PROJECT_MASTER.md#16-estado-de-cada-módulo).

| Fase | Contenido | Estado |
|---|---|---|
| 1 · Product definition | PROJECT_MASTER, análisis de Excel, sitemap, flujos, riesgos | ✅ |
| 2 · Data architecture | Migraciones SQL, RLS, auditoría, inmutabilidad, tests de aislamiento | ✅ probado en Postgres 16 |
| 3 · Design system | Tokens light/dark, componentes, gráficas, shell, ⌘K | ✅ |
| 4 · Prototype → 5 · MVP funcional (local) | Caja, ventas, cierres, catálogo, dashboard, clientes, facturas, pagos, informes, ajustes, auditoría | ✅ en modo local |
| 6 · Importación | Caja + facturas BeMadBox, validación, duplicados, reversión | ✅ con los Excel reales |
| 7 · QA | Desktop / tablet / móvil, datos, permisos, errores | 🟡 E2E automatizado en navegador; falta QA en iPad físico |
| **8 · Servidor** | Proyectos Supabase staging/prod, Auth real, SupabaseAdapter, Storage de originales | ⏭ siguiente |
| 9 · Clientes | Membresías (tarifas versionadas desde facturas), asistencia (import BeMadBox), Seguimiento con motivos, tareas | ⏭ |
| 10 · Finanzas | Gastos + proveedores, emisión de facturas propias (tras validar con gestoría), conciliación | ⏭ |
| 11 · Comunicación | Plantillas, WhatsApp Business Platform oficial, timeline | ⏭ |
| 12 · Inteligencia | Analytics (retención, churn, LTV, margen), Copilot con trazabilidad, OCR | ⏭ |
| 13 · Producto SaaS | Billing Starter/Pro/Business, Stripe/Redsys, API pública, onboarding self-service | ⏭ |
