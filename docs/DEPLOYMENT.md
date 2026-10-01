# Despliegue

## Frontend
SPA estática: `npm run build` → `dist/`. Cualquier hosting estático con fallback a `index.html` (Vercel, Netlify, Cloudflare Pages). Cabeceras recomendadas: CSP estricta, `X-Frame-Options: DENY`, HSTS.

## Base de datos (Supabase) — Fase 5
1. Crear proyectos `prfmn-staging` y `prfmn-production` (región UE).
2. `supabase link --project-ref <staging>` y `supabase db push` (aplica `supabase/migrations` en orden).
3. Ejecutar los tests de aislamiento contra staging antes de cada release (adaptar `supabase/tests/rls_isolation.sql` con usuarios de prueba reales o pgTAP).
4. Activar backups diarios + PITR en producción.
5. Repetir en producción solo tras validar staging.

Reglas: migraciones nuevas hacia delante; nunca editar una aplicada; nunca `DROP` sin `IF EXISTS` y revisión.

## Checklist de release
- [ ] lint, typecheck, test, build en verde
- [ ] `npm run db:test` si hay migraciones
- [ ] CHANGELOG actualizado
- [ ] Probado en desktop, iPad y móvil
