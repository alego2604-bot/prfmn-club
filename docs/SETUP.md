# Setup

## Requisitos
- Node.js 20+ (probado con 22) y npm 10+.
- Opcional, para `npm run db:test`: binarios de PostgreSQL 15+ (`initdb`, `pg_ctl`, `psql`). En macOS: `brew install postgresql@16`.

## Desarrollo local
```bash
npm install
npm run dev
```
Abre http://localhost:5173. Sin servidor configurado la app funciona en **modo local**: cuentas, empresas y datos se guardan en IndexedDB de ese navegador. Cada empresa es un documento separado (la demo nunca se mezcla con la real).

**Copia de seguridad**: Ajustes → Datos → «Descargar copia (.json)». Hazlo con regularidad mientras no haya servidor.

## Verificación antes de cada commit
```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run db:test   # si tocas supabase/migrations
```

## Primer uso con The Gravity Room
1. Crear cuenta y empresa «The Gravity Room» (tipo Fitness, centro Calonge).
2. Importaciones → Nueva → `CAJA GIMNASIO PRO - ANUAL 2026.xlsx` → revisar avisos (fechas de enero, fila sin producto, duplicados TPV) → Importar.
3. Importaciones → Nueva → `BeMadBox_Q3_2026.xlsx` → Importar (crea clientes y facturas, deduplicados por NIF).
4. Catálogo → revisar el IVA propuesto (10 % bebidas/suplementación) con la gestoría.
5. Caja → abrir caja → vender.

## Conectar Supabase (Fase 5, pendiente)
Ver [ENVIRONMENT.md](ENVIRONMENT.md) y [DEPLOYMENT.md](DEPLOYMENT.md).
