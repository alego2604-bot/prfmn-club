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

## Primer uso de una empresa real
1. Crear cuenta y empresa (sector y centro de la empresa).
2. Importaciones → Nueva → Excel de caja → revisar avisos (fechas fuera de la hoja, filas sin producto, duplicados) → Importar.
3. Importaciones → Nueva → Excel de facturas → Importar (crea clientes y facturas, deduplicados por NIF).
4. Catálogo → revisar el IVA propuesto con la asesoría fiscal.
5. Caja → abrir caja → vender.

Los ficheros reales del cliente se importan desde la app; **nunca** se copian al repositorio (ver `docs/SECURITY.md`).

## Conectar Supabase (Fase 5, pendiente)
Ver [ENVIRONMENT.md](ENVIRONMENT.md) y [DEPLOYMENT.md](DEPLOYMENT.md).
