# PRFMN Club

Gym Operating System — plataforma SaaS multi-tenant para gestión de boxes de CrossFit, gimnasios funcionales/híbridos y performance gyms.

Ver documentación completa en [`/docs`](docs/) y reglas de trabajo en [`CLAUDE.md`](CLAUDE.md).

## Estado actual

Fase 2: frontend navegable con datos mock (sin backend real conectado). Primer tenant objetivo: **The Gravity Room**.

## Requisitos

- Node.js 20+ y npm 10+ (no incluidos en este entorno; instalar desde [nodejs.org](https://nodejs.org) o vía Homebrew: `brew install node`).

## Arrancar en local

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.

## Scripts

- `npm run dev` — servidor de desarrollo Vite.
- `npm run build` — typecheck + build de producción.
- `npm run typecheck` — solo comprobación de tipos.
- `npm run lint` — ESLint.
